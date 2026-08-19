from __future__ import annotations

from datetime import UTC, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import asc, desc, func, or_, select, update

from app.audit import add_audit
from app.db import utcnow
from app.dependencies import (
    AdminUser,
    CopywriterUser,
    EditorUser,
    PublisherUser,
    SessionDep,
    ViewerUser,
)
from app.errors import AppError, forbidden, not_found
from app.idempotency import claim_idempotency, complete_idempotency, request_fingerprint
from app.locks import assert_editable, heartbeat_page_lock, lock_page, lock_view, unlock_page
from app.metrics import PUBLISH_OPERATIONS
from app.models import (
    JobStatus,
    Page,
    PageContentType,
    PageStatus,
    PublishJob,
    ReviewDecision,
    Revision,
    Role,
    Route,
    Site,
)
from app.registry import registry
from app.schemas import (
    SECTION_KEY_PATTERN,
    BatchPublishItemResult,
    BatchPublishRequest,
    BatchPublishResult,
    DraftOut,
    DraftUpdate,
    ListingMeta,
    PageCreate,
    PageDetailOut,
    PageListOut,
    PageLockOut,
    PageLockRequest,
    PageOut,
    PagePatch,
    PreviewTokenOut,
    PublishRequest,
    PublishResult,
    RestoreRequest,
    ReviewRequest,
    RevisionOut,
    ScheduleRequest,
    SiteCreate,
    SiteOut,
    TrashPageOut,
    ValidationReport,
)
from app.security import create_preview_token
from app.services import (
    create_page,
    create_revision,
    get_page,
    invalidate_public_content,
    parse_document,
    publish_page,
    restore_revision_to_draft,
    rollback_page,
    schedule_page,
    unpublish_page,
    update_draft,
    validate_for_publish,
)

router = APIRouter(tags=["pages"])


def _draft_expected_version(request: Request, body_version: int | None) -> int:
    raw = request.headers.get("If-Match")
    if raw is None:
        if body_version is None:
            raise AppError(
                428,
                "version_precondition_required",
                "Необходимо передать baseVersion или If-Match",
            )
        return body_version
    normalized = raw.strip()
    if normalized.startswith("W/"):
        normalized = normalized[2:].strip()
    normalized = normalized.strip('"')
    if normalized.startswith("draft-"):
        normalized = normalized[6:]
    try:
        header_version = int(normalized)
    except ValueError as exc:
        raise AppError(
            400,
            "invalid_if_match",
            "Заголовок If-Match должен содержать версию черновика",
        ) from exc
    if header_version < 1:
        raise AppError(
            400,
            "invalid_if_match",
            "Заголовок If-Match должен содержать версию черновика",
        )
    if body_version is not None and body_version != header_version:
        raise AppError(
            412,
            "version_precondition_failed",
            "Значения If-Match и baseVersion не совпадают",
        )
    return header_version


@router.get("/sites", response_model=list[SiteOut])
async def list_sites(session: SessionDep, _actor: ViewerUser) -> list[Site]:
    return list(
        (
            await session.scalars(select(Site).where(Site.is_active.is_(True)).order_by(Site.name))
        ).all()
    )


@router.post("/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
async def create_site(
    payload: SiteCreate,
    request: Request,
    session: SessionDep,
    actor: AdminUser,
) -> Site:
    configured_locale = request.app.state.settings.default_locale
    if "default_locale" in payload.model_fields_set and payload.default_locale != configured_locale:
        raise AppError(
            422,
            "unsupported_locale",
            f"Поддерживается только локаль '{configured_locale}'",
        )
    site = Site(
        slug=payload.slug,
        name=payload.name.strip(),
        domains=payload.domains,
        default_locale=configured_locale,
        owner_id=actor.id,
    )
    session.add(site)
    await session.flush()
    add_audit(
        session,
        request,
        actor=actor,
        action="site.created",
        resource_type="site",
        resource_id=site.id,
    )
    return site


@router.get("/pages", response_model=PageListOut)
async def list_pages(
    session: SessionDep,
    _actor: ViewerUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 20,
    query: Annotated[str | None, Query(alias="q", max_length=200)] = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    folder_id: Annotated[UUID | None, Query(alias="folderId")] = None,
    site_id: Annotated[UUID | None, Query(alias="siteId")] = None,
    content_type: Annotated[
        PageContentType | None,
        Query(alias="contentType"),
    ] = None,
    section_key: Annotated[
        str | None,
        Query(alias="sectionKey", max_length=100, pattern=SECTION_KEY_PATTERN.pattern),
    ] = None,
    featured: Annotated[bool | None, Query()] = None,
    locale: Annotated[str | None, Query(max_length=20)] = None,
    sort: Annotated[str, Query()] = "-updatedAt",
) -> PageListOut:
    filters = [Page.deleted_at.is_(None)]
    if query:
        term = f"%{query.strip()}%"
        filters.append(or_(Page.title.ilike(term), Page.slug.ilike(term)))
    if status_filter:
        filters.append(Page.status == status_filter)
    if folder_id:
        filters.append(Page.folder_id == folder_id)
    if site_id:
        filters.append(Page.site_id == site_id)
    if content_type:
        filters.append(Page.content_type == content_type.value)
    if section_key:
        filters.append(Page.section_key == section_key)
    if featured is not None:
        filters.append(func.coalesce(Page.listing_meta["featured"].as_boolean(), False) == featured)
    statement = select(Page).where(*filters)
    if locale:
        statement = statement.join(Route, Route.page_id == Page.id).where(Route.locale == locale)
    sort_map = {
        "title": asc(Page.title),
        "-title": desc(Page.title),
        "createdAt": asc(Page.created_at),
        "-createdAt": desc(Page.created_at),
        "updatedAt": asc(Page.updated_at),
        "-updatedAt": desc(Page.updated_at),
    }
    statement = statement.order_by(sort_map.get(sort, desc(Page.updated_at)))
    total = int(
        await session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
        or 0
    )
    items = list(
        (await session.scalars(statement.offset((page - 1) * page_size).limit(page_size))).all()
    )
    return PageListOut(
        items=[PageOut.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/pages/trash")
async def list_trash(
    request: Request,
    session: SessionDep,
    _actor: CopywriterUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 20,
    site_id: Annotated[UUID | None, Query(alias="siteId")] = None,
) -> dict[str, object]:
    filters = [Page.deleted_at.is_not(None)]
    if site_id is not None:
        filters.append(Page.site_id == site_id)
    total = int(await session.scalar(select(func.count(Page.id)).where(*filters)) or 0)
    pages = list(
        (
            await session.scalars(
                select(Page)
                .where(*filters)
                .order_by(Page.deleted_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    )
    retention = timedelta(days=request.app.state.settings.trash_retention_days)
    return {
        "items": [
            TrashPageOut(
                page=PageOut.model_validate(item),
                deleted_at=item.deleted_at,
                purge_at=item.deleted_at + retention,
            )
            for item in pages
            if item.deleted_at is not None
        ],
        "total": total,
        "page": page,
        "pageSize": page_size,
        "retentionDays": request.app.state.settings.trash_retention_days,
    }


@router.post("/pages", response_model=PageOut, status_code=status.HTTP_201_CREATED)
async def add_page(
    payload: PageCreate,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Page:
    page, route = await create_page(
        session,
        payload,
        actor,
        settings=request.app.state.settings,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="page.created",
        resource_type="page",
        resource_id=page.id,
        details={"route": route.path},
    )
    return page


@router.post("/pages/batch/publish", response_model=BatchPublishResult)
async def batch_publish(
    payload: BatchPublishRequest,
    request: Request,
    session: SessionDep,
    actor: PublisherUser,
) -> BatchPublishResult | JSONResponse:
    settings = request.app.state.settings
    if not settings.batch_publish_enabled:
        raise AppError(503, "batch_publish_disabled", "Пакетная публикация отключена")
    if len(payload.items) > settings.batch_publish_max_items:
        raise AppError(
            422,
            "batch_too_large",
            (f"За один раз можно опубликовать не более {settings.batch_publish_max_items} страниц"),
        )
    fingerprint = request_fingerprint(payload.model_dump(mode="json", by_alias=True))
    record, replay = await claim_idempotency(
        session,
        request,
        actor.id,
        "pages.batch.publish",
        fingerprint,
        settings,
    )
    if replay is not None:
        return replay
    results: list[BatchPublishItemResult] = []
    for item in payload.items:
        try:
            async with session.begin_nested():
                page, revision = await publish_page(
                    session,
                    item.page_id,
                    PublishRequest(
                        expected_version=item.expected_version,
                        route_path=item.route_path,
                        message=item.message,
                    ),
                    actor,
                    request.app.state.cache,
                    settings=settings,
                )
                add_audit(
                    session,
                    request,
                    actor=actor,
                    action="page.published",
                    resource_type="page",
                    resource_id=page.id,
                    details={"revisionId": str(revision.id), "batch": True},
                )
                result = PublishResult(page=page, revision=revision)
            results.append(
                BatchPublishItemResult(
                    page_id=item.page_id,
                    success=True,
                    result=result,
                )
            )
            PUBLISH_OPERATIONS.labels("batch_item", "success").inc()
        except AppError as exc:
            results.append(
                BatchPublishItemResult(
                    page_id=item.page_id,
                    success=False,
                    error={
                        "code": exc.code,
                        "message": exc.message,
                        "details": exc.details,
                    },
                )
            )
            PUBLISH_OPERATIONS.labels("batch_item", "failure").inc()
    response = BatchPublishResult(
        items=results,
        succeeded=sum(item.success for item in results),
        failed=sum(not item.success for item in results),
    )
    complete_idempotency(
        record,
        jsonable_encoder(response, by_alias=True),
        status.HTTP_200_OK,
    )
    return response


@router.get("/pages/{page_id}", response_model=PageDetailOut)
async def page_detail(
    page_id: UUID,
    session: SessionDep,
    _actor: ViewerUser,
) -> PageDetailOut:
    page = await get_page(session, page_id)
    route = await session.scalar(
        select(Route).where(Route.page_id == page.id, Route.is_primary.is_(True))
    )
    return PageDetailOut(
        page=PageOut.model_validate(page),
        draft=DraftOut(
            page_id=page.id,
            version=page.draft_version,
            document=parse_document(page.draft_document),
            updated_at=page.updated_at,
        ),
        route_path=route.path if route else None,
    )


@router.get("/pages/{page_id}/lock", response_model=PageLockOut)
async def get_page_lock(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    actor: ViewerUser,
) -> PageLockOut:
    page = await get_page(session, page_id)
    return lock_view(page, actor, request.app.state.settings)


@router.post("/pages/{page_id}/lock", response_model=PageLockOut)
async def acquire_page_lock(
    page_id: UUID,
    payload: PageLockRequest,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> PageLockOut:
    page, result = await lock_page(
        session,
        page_id,
        actor,
        request.app.state.settings,
        force=payload.force,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="page.lock_acquired",
        resource_type="page",
        resource_id=page.id,
        details={"force": payload.force},
    )
    return result


@router.post("/pages/{page_id}/lock/heartbeat", response_model=PageLockOut)
async def heartbeat_lock(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> PageLockOut:
    _page, result = await heartbeat_page_lock(
        session,
        page_id,
        actor,
        request.app.state.settings,
    )
    return result


@router.delete("/pages/{page_id}/lock", response_model=PageLockOut)
async def release_page_lock(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
    force: Annotated[bool, Query()] = False,
) -> PageLockOut:
    page, result = await unlock_page(
        session,
        page_id,
        actor,
        request.app.state.settings,
        force=force,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="page.lock_released",
        resource_type="page",
        resource_id=page.id,
        details={"force": force},
    )
    return result


@router.patch("/pages/{page_id}", response_model=PageOut)
async def patch_page(
    page_id: UUID,
    payload: PagePatch,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Page:
    page = await get_page(session, page_id)
    assert_editable(page, actor, request.app.state.settings)
    before = {
        "title": page.title,
        "slug": page.slug,
        "folderId": page.folder_id,
        "contentType": page.content_type,
        "sectionKey": page.section_key,
        "listingMeta": ListingMeta.model_validate(page.listing_meta or {}).model_dump(
            mode="json",
            by_alias=True,
        ),
    }
    changes = payload.model_dump(exclude_unset=True, exclude={"listing_meta"})
    if "render_mode" in changes and actor.role != Role.ADMIN.value:
        raise forbidden("Изменять режим отображения может только администратор")
    for field, value in changes.items():
        setattr(page, field, value.strip() if isinstance(value, str) else value)
    if "listing_meta" in payload.model_fields_set:
        current_meta = ListingMeta.model_validate(page.listing_meta or {})
        if payload.listing_meta is None:
            listing_meta = ListingMeta()
        else:
            listing_meta = ListingMeta.model_validate(
                {
                    **current_meta.model_dump(mode="python"),
                    **payload.listing_meta.model_dump(mode="python", exclude_unset=True),
                }
            )
        page.listing_meta = listing_meta.model_dump(mode="json", by_alias=True)
        changes["listing_meta"] = page.listing_meta
    page.updated_by = actor.id
    await session.flush()
    public_fields = {
        "title",
        "slug",
        "render_mode",
        "content_type",
        "section_key",
        "listing_meta",
    }
    if public_fields & (set(changes) | payload.model_fields_set):
        await invalidate_public_content(request.app.state.cache, page.site_id)
    add_audit(
        session,
        request,
        actor=actor,
        action="page.updated",
        resource_type="page",
        resource_id=page.id,
        details={
            "before": before,
            "after": jsonable_encoder(changes, by_alias=True),
        },
    )
    return page


@router.delete("/pages/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_page(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
    permanent: bool = False,
) -> None:
    page = await get_page(session, page_id)
    if permanent:
        if actor.role != Role.ADMIN.value:
            raise forbidden("Безвозвратно удалить страницу может только администратор")
        await session.delete(page)
        action = "page.deleted_permanently"
    else:
        from app.db import utcnow

        page.deleted_at = utcnow()
        page.status = PageStatus.ARCHIVED.value
        await session.execute(
            Route.__table__.update().where(Route.page_id == page.id).values(is_active=False)
        )
        await session.execute(
            update(PublishJob)
            .where(
                PublishJob.page_id == page.id,
                PublishJob.status == JobStatus.PENDING.value,
            )
            .values(status=JobStatus.CANCELLED.value)
        )
        action = "page.trashed"
    add_audit(
        session,
        request,
        actor=actor,
        action=action,
        resource_type="page",
        resource_id=page.id,
    )
    await invalidate_public_content(request.app.state.cache, page.site_id)


@router.post("/pages/{page_id}/restore", response_model=PageOut)
async def restore_page_from_trash(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Page:
    page = await get_page(session, page_id, include_deleted=True, for_update=True)
    if page.deleted_at is None:
        raise AppError(409, "page_not_trashed", "Страница не находится в корзине")
    deleted_at = page.deleted_at
    if deleted_at.tzinfo is None:
        deleted_at = deleted_at.replace(tzinfo=UTC)
    if deleted_at + timedelta(days=request.app.state.settings.trash_retention_days) <= utcnow():
        raise AppError(410, "trash_expired", "Срок хранения страницы в корзине истёк")
    page.deleted_at = None
    page.status = PageStatus.DRAFT.value
    page.updated_by = actor.id
    add_audit(
        session,
        request,
        actor=actor,
        action="page.restored_from_trash",
        resource_type="page",
        resource_id=page.id,
    )
    return page


@router.delete("/pages/{page_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_page(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    actor: AdminUser,
) -> None:
    page = await get_page(session, page_id, include_deleted=True, for_update=True)
    site_id = page.site_id
    await session.delete(page)
    add_audit(
        session,
        request,
        actor=actor,
        action="page.deleted_permanently",
        resource_type="page",
        resource_id=page.id,
    )
    await invalidate_public_content(request.app.state.cache, site_id)


@router.post("/pages/{page_id}/duplicate", response_model=PageOut)
async def duplicate_page(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Page:
    source = await get_page(session, page_id)
    suffix = 1
    slug = f"{source.slug}-copy"
    while await session.scalar(
        select(Page.id).where(Page.site_id == source.site_id, Page.slug == slug)
    ):
        suffix += 1
        slug = f"{source.slug}-copy-{suffix}"
    route_candidate = f"/{slug}"
    payload = PageCreate(
        site_id=source.site_id,
        folder_id=source.folder_id,
        title=f"{source.title} (копия)",
        slug=slug,
        route_path=route_candidate,
        content_type=source.content_type,
        section_key=source.section_key,
        listing_meta=source.listing_meta,
        document=parse_document(source.draft_document),
    )
    page, _route = await create_page(
        session,
        payload,
        actor,
        settings=request.app.state.settings,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="page.duplicated",
        resource_type="page",
        resource_id=page.id,
        details={"sourcePageId": str(source.id)},
    )
    return page


@router.get("/pages/{page_id}/draft", response_model=DraftOut)
async def get_draft(
    page_id: UUID,
    session: SessionDep,
    _actor: ViewerUser,
) -> DraftOut:
    page = await get_page(session, page_id)
    return DraftOut(
        page_id=page.id,
        version=page.draft_version,
        document=parse_document(page.draft_document),
        updated_at=page.updated_at,
    )


async def _save_draft(
    page_id: UUID,
    payload: DraftUpdate,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> DraftOut:
    page = await update_draft(
        session,
        page_id,
        _draft_expected_version(request, payload.expected_version),
        payload.document,
        actor,
        settings=request.app.state.settings,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="draft.saved",
        resource_type="page",
        resource_id=page.id,
        details={"version": page.draft_version},
    )
    return DraftOut(
        page_id=page.id,
        version=page.draft_version,
        document=parse_document(page.draft_document),
        updated_at=page.updated_at,
    )


@router.patch("/pages/{page_id}/draft", response_model=DraftOut)
async def save_draft_patch(
    page_id: UUID,
    payload: DraftUpdate,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> DraftOut:
    return await _save_draft(page_id, payload, request, session, actor)


@router.put("/pages/{page_id}/draft", response_model=DraftOut)
async def save_draft_put(
    page_id: UUID,
    payload: DraftUpdate,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> DraftOut:
    return await _save_draft(page_id, payload, request, session, actor)


@router.post(
    "/pages/{page_id}/revisions",
    response_model=RevisionOut,
    status_code=status.HTTP_201_CREATED,
)
async def snapshot_revision(
    page_id: UUID,
    payload: ReviewRequest,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Revision:
    page = await get_page(session, page_id)
    revision = await create_revision(
        session,
        page,
        actor.id,
        kind="manual",
        message=payload.comment,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="revision.created",
        resource_type="revision",
        resource_id=revision.id,
        details={"pageId": str(page.id), "number": revision.number},
    )
    return revision


@router.get("/pages/{page_id}/revisions", response_model=list[RevisionOut])
async def revisions(
    page_id: UUID,
    session: SessionDep,
    _actor: ViewerUser,
) -> list[Revision]:
    await get_page(session, page_id)
    return list(
        (
            await session.scalars(
                select(Revision).where(Revision.page_id == page_id).order_by(Revision.number.desc())
            )
        ).all()
    )


@router.get("/pages/{page_id}/revisions/{revision_id}", response_model=RevisionOut)
async def revision_detail(
    page_id: UUID,
    revision_id: UUID,
    session: SessionDep,
    _actor: ViewerUser,
) -> Revision:
    revision = await session.scalar(
        select(Revision).where(Revision.id == revision_id, Revision.page_id == page_id)
    )
    if revision is None:
        raise not_found("Revision")
    return revision


@router.post(
    "/pages/{page_id}/revisions/{revision_id}/preview-token",
    response_model=PreviewTokenOut,
)
async def issue_revision_preview_token(
    page_id: UUID,
    revision_id: UUID,
    request: Request,
    session: SessionDep,
    actor: ViewerUser,
) -> PreviewTokenOut:
    revision = await session.scalar(
        select(Revision).where(
            Revision.id == revision_id,
            Revision.page_id == page_id,
        )
    )
    if revision is None:
        raise not_found("Revision")
    token, expires_at = create_preview_token(
        actor,
        page_id,
        revision.draft_version or 1,
        request.app.state.settings,
        revision_id=revision.id,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="revision.preview_token_issued",
        resource_type="revision",
        resource_id=revision.id,
        details={"expiresAt": expires_at.isoformat()},
    )
    return PreviewTokenOut(
        token=token,
        expires_at=expires_at,
        preview_url=(
            f"{request.app.state.settings.api_prefix}/preview/pages/{page_id}"
            f"/revisions/{revision.id}?token={token}"
        ),
    )


@router.post("/pages/{page_id}/revisions/{revision_id}/restore", response_model=DraftOut)
async def restore_revision(
    page_id: UUID,
    revision_id: UUID,
    payload: RestoreRequest,
    request: Request,
    session: SessionDep,
    actor: EditorUser,
) -> DraftOut:
    page = await restore_revision_to_draft(
        session,
        page_id,
        revision_id,
        payload.expected_version,
        actor,
        request.app.state.settings,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="revision.restored_to_draft",
        resource_type="page",
        resource_id=page.id,
        details={"revisionId": str(revision_id), "version": page.draft_version},
    )
    return DraftOut(
        page_id=page.id,
        version=page.draft_version,
        document=parse_document(page.draft_document),
        updated_at=page.updated_at,
    )


@router.post("/pages/{page_id}/review", response_model=PageOut)
async def submit_review(
    page_id: UUID,
    payload: ReviewRequest,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Page:
    page = await get_page(session, page_id)
    page.status = PageStatus.IN_REVIEW.value
    page.review_status = ReviewDecision.PENDING.value
    page.review_comment = payload.comment
    page.updated_by = actor.id
    add_audit(
        session,
        request,
        actor=actor,
        action="review.submitted",
        resource_type="page",
        resource_id=page.id,
    )
    return page


@router.post("/pages/{page_id}/review/approve", response_model=PageOut)
async def approve_review(
    page_id: UUID,
    payload: ReviewRequest,
    request: Request,
    session: SessionDep,
    actor: EditorUser,
) -> Page:
    page = await get_page(session, page_id)
    page.status = PageStatus.APPROVED.value
    page.review_status = ReviewDecision.APPROVED.value
    page.review_comment = payload.comment
    page.updated_by = actor.id
    add_audit(
        session,
        request,
        actor=actor,
        action="review.approved",
        resource_type="page",
        resource_id=page.id,
    )
    return page


@router.post("/pages/{page_id}/review/reject", response_model=PageOut)
async def reject_review(
    page_id: UUID,
    payload: ReviewRequest,
    request: Request,
    session: SessionDep,
    actor: EditorUser,
) -> Page:
    if not payload.comment:
        raise AppError(422, "comment_required", "Для отклонения необходимо указать комментарий")
    page = await get_page(session, page_id)
    page.status = PageStatus.DRAFT.value
    page.review_status = ReviewDecision.REJECTED.value
    page.review_comment = payload.comment
    page.updated_by = actor.id
    add_audit(
        session,
        request,
        actor=actor,
        action="review.rejected",
        resource_type="page",
        resource_id=page.id,
        details={"comment": payload.comment},
    )
    return page


@router.post("/pages/{page_id}/validate", response_model=ValidationReport)
async def validate_page(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    _actor: ViewerUser,
) -> ValidationReport:
    page = await get_page(session, page_id)
    issues = await validate_for_publish(
        session,
        page,
        parse_document(page.draft_document),
        registry,
        request.app.state.settings,
    )
    return ValidationReport(valid=not issues, issues=issues)


@router.post("/pages/{page_id}/preview-token", response_model=PreviewTokenOut)
async def issue_preview_token(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    actor: ViewerUser,
) -> PreviewTokenOut:
    page = await get_page(session, page_id)
    token, expires_at = create_preview_token(
        actor,
        page.id,
        page.draft_version,
        request.app.state.settings,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="page.preview_token_issued",
        resource_type="page",
        resource_id=page.id,
        details={"expiresAt": expires_at.isoformat()},
    )
    return PreviewTokenOut(
        token=token,
        expires_at=expires_at,
        preview_url=(
            f"{request.app.state.settings.api_prefix}/preview/pages/{page.id}?token={token}"
        ),
    )


@router.post("/pages/{page_id}/publish", response_model=PublishResult)
async def publish(
    page_id: UUID,
    payload: PublishRequest,
    request: Request,
    session: SessionDep,
    actor: PublisherUser,
) -> PublishResult | JSONResponse:
    fingerprint = request_fingerprint(
        {
            "pageId": page_id,
            "payload": payload.model_dump(mode="json", by_alias=True),
        }
    )
    record, replay = await claim_idempotency(
        session,
        request,
        actor.id,
        f"page.publish:{page_id}",
        fingerprint,
        request.app.state.settings,
    )
    if replay is not None:
        return replay
    page, revision = await publish_page(
        session,
        page_id,
        payload,
        actor,
        request.app.state.cache,
        settings=request.app.state.settings,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="page.published",
        resource_type="page",
        resource_id=page.id,
        details={"revisionId": str(revision.id), "number": revision.number},
    )
    result = PublishResult(page=page, revision=revision)
    PUBLISH_OPERATIONS.labels("publish", "success").inc()
    complete_idempotency(
        record,
        jsonable_encoder(result, by_alias=True),
        status.HTTP_200_OK,
    )
    return result


@router.post("/pages/{page_id}/schedule", response_model=PublishResult)
async def schedule(
    page_id: UUID,
    payload: ScheduleRequest,
    request: Request,
    session: SessionDep,
    actor: PublisherUser,
) -> PublishResult | JSONResponse:
    fingerprint = request_fingerprint(
        {
            "pageId": page_id,
            "payload": payload.model_dump(mode="json", by_alias=True),
        }
    )
    record, replay = await claim_idempotency(
        session,
        request,
        actor.id,
        f"page.schedule:{page_id}",
        fingerprint,
        request.app.state.settings,
    )
    if replay is not None:
        return replay
    page, job, revision = await schedule_page(
        session,
        page_id,
        payload,
        actor,
        request.app.state.cache,
        request.app.state.settings,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="page.scheduled",
        resource_type="page",
        resource_id=page.id,
        details={
            "jobId": str(job.id),
            "revisionId": str(revision.id),
            "runAt": job.run_at.isoformat(),
        },
    )
    result = PublishResult(page=page, revision=revision, job_id=job.id)
    PUBLISH_OPERATIONS.labels("schedule", "success").inc()
    complete_idempotency(
        record,
        jsonable_encoder(result, by_alias=True),
        status.HTTP_200_OK,
    )
    return result


@router.post("/pages/{page_id}/unpublish", response_model=PageOut)
async def unpublish(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    actor: PublisherUser,
) -> Page:
    page = await unpublish_page(session, page_id, actor, request.app.state.cache)
    add_audit(
        session,
        request,
        actor=actor,
        action="page.unpublished",
        resource_type="page",
        resource_id=page.id,
    )
    return page


@router.post("/pages/{page_id}/rollback/{revision_id}", response_model=PublishResult)
async def rollback(
    page_id: UUID,
    revision_id: UUID,
    payload: PublishRequest,
    request: Request,
    session: SessionDep,
    actor: PublisherUser,
) -> PublishResult | JSONResponse:
    fingerprint = request_fingerprint(
        {
            "pageId": page_id,
            "revisionId": revision_id,
            "payload": payload.model_dump(mode="json", by_alias=True),
        }
    )
    record, replay = await claim_idempotency(
        session,
        request,
        actor.id,
        f"page.rollback:{page_id}:{revision_id}",
        fingerprint,
        request.app.state.settings,
    )
    if replay is not None:
        return replay
    page, revision = await rollback_page(
        session,
        page_id,
        revision_id,
        payload,
        actor,
        request.app.state.cache,
        request.app.state.settings,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="page.rolled_back",
        resource_type="page",
        resource_id=page.id,
        details={
            "sourceRevisionId": str(revision_id),
            "newRevisionId": str(revision.id),
        },
    )
    result = PublishResult(page=page, revision=revision)
    PUBLISH_OPERATIONS.labels("rollback", "success").inc()
    complete_idempotency(
        record,
        jsonable_encoder(result, by_alias=True),
        status.HTTP_200_OK,
    )
    return result
