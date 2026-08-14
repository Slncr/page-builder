from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from html.parser import HTMLParser
from typing import Any
from urllib.parse import unquote, urlsplit
from uuid import UUID

from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import ResilientCache
from app.config import Settings
from app.db import utcnow
from app.errors import AppError, conflict, not_found
from app.locks import assert_editable
from app.models import (
    Asset,
    Form,
    JobStatus,
    Page,
    PageStatus,
    PublishJob,
    Redirect,
    ReviewDecision,
    Revision,
    Route,
    Site,
    User,
)
from app.registry import BlockRegistry, registry
from app.sanitizer import sanitize_document
from app.schemas import (
    PageCreate,
    PageDocument,
    PublishRequest,
    ScheduleRequest,
    ValidationIssue,
)

PATH_SLASHES = re.compile(r"/{2,}")
LINK_KEYS = {"link", "redirectUrl", "sourceUrl", "url"}
SAFE_LINK_SCHEMES = {"http", "https", "mailto", "tel"}


async def invalidate_public_content(cache: ResilientCache, site_id: UUID) -> None:
    """Invalidate page payloads, listings, and route-resolution results."""
    await cache.delete_prefix(f"public:{site_id}:")
    await cache.delete_prefix("resolver:")


class _AnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def normalize_path(value: str) -> str:
    split = urlsplit(value.strip())
    if split.scheme or split.netloc or split.query or split.fragment:
        raise AppError(
            422,
            "invalid_path",
            "Путь маршрута должен быть локальным и не содержать параметры запроса",
        )
    path = unquote(split.path or "/")
    path = PATH_SLASHES.sub("/", path)
    if not path.startswith("/"):
        path = f"/{path}"
    if any(part in {".", ".."} for part in path.split("/")):
        raise AppError(422, "invalid_path", "Путь маршрута не может содержать сегменты '.' и '..'")
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return path


def document_json(document: PageDocument) -> dict[str, Any]:
    return document.model_dump(mode="json", by_alias=True)


def document_checksum(document: PageDocument | dict[str, Any]) -> str:
    payload = document_json(document) if isinstance(document, PageDocument) else document
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def parse_document(value: dict[str, Any]) -> PageDocument:
    try:
        return PageDocument.model_validate(value)
    except Exception as exc:
        raise AppError(422, "invalid_document", "Документ страницы некорректен") from exc


def _raise_issues(issues: list[ValidationIssue]) -> None:
    if issues:
        raise AppError(
            422,
            "document_validation_failed",
            "Документ страницы не прошёл проверку",
            details=[issue.model_dump(mode="json") for issue in issues],
        )


def _walk_values(value: Any) -> Iterable[tuple[str | None, Any]]:
    if isinstance(value, dict):
        for key, item in value.items():
            yield key, item
            yield from _walk_values(item)
    elif isinstance(value, list):
        for item in value:
            yield None, item
            yield from _walk_values(item)


def referenced_ids(document: PageDocument) -> tuple[set[UUID], set[UUID], list[ValidationIssue]]:
    asset_ids = set(document.assets_refs)
    if document.page_meta.og_image is not None:
        asset_ids.add(document.page_meta.og_image)
    form_ids: set[UUID] = set()
    issues: list[ValidationIssue] = []
    asset_keys = {
        "assetId",
        "backgroundImage",
        "image",
        "ogImage",
        "posterAssetId",
        "thumbnailAssetId",
    }
    for block_index, block in enumerate(document.blocks):
        for key, value in _walk_values(block.model_dump(mode="python")):
            if key not in asset_keys | {"formId"} or not isinstance(value, str):
                continue
            try:
                parsed = UUID(value)
            except ValueError:
                issues.append(
                    ValidationIssue(
                        path=f"blocks[{block_index}].props.{key}",
                        code="invalid_reference",
                        message=f"Значение {key} должно быть корректным UUID",
                    )
                )
                continue
            if key == "formId":
                form_ids.add(parsed)
            else:
                asset_ids.add(parsed)
        if block.type == "gallery":
            for asset in block.props.get("assets", []):
                raw = asset.get("assetId") if isinstance(asset, dict) else asset
                if not isinstance(raw, str):
                    continue
                try:
                    asset_ids.add(UUID(raw))
                except ValueError:
                    issues.append(
                        ValidationIssue(
                            path=f"blocks[{block_index}].props.assets",
                            code="invalid_reference",
                            message="Ссылки на медиафайлы галереи должны быть корректными UUID",
                        )
                    )
    return asset_ids, form_ids, issues


def referenced_links(document: PageDocument) -> list[str]:
    links: list[str] = []
    if document.page_meta.canonical:
        links.append(document.page_meta.canonical)
    for block in document.blocks:
        for key, value in _walk_values(block.model_dump(mode="python")):
            if key in LINK_KEYS and isinstance(value, str) and value.strip():
                links.append(value.strip())
            if key in {"html", "answer", "content"} and isinstance(value, str):
                parser = _AnchorParser()
                parser.feed(value)
                links.extend(parser.links)
    return links


def _iter_blocks(items: list[Any]) -> Iterable[Any]:
    for block in items:
        yield block
        yield from _iter_blocks([item for item in block.children if not isinstance(item, str)])
        for slot in block.slots.values():
            yield from _iter_blocks([item for item in slot if not isinstance(item, str)])


def _allowed_provider_host(host: str, allowed_hosts: list[str]) -> bool:
    normalized = host.rstrip(".").lower()
    return any(
        normalized == allowed.rstrip(".").lower()
        or normalized.endswith(f".{allowed.rstrip('.').lower()}")
        for allowed in allowed_hosts
    )


async def validate_for_publish(
    session: AsyncSession,
    page: Page,
    document: PageDocument,
    block_registry: BlockRegistry = registry,
    settings: Settings | None = None,
) -> list[ValidationIssue]:
    issues = block_registry.validate(document, prepublish=True)
    if not page.title.strip():
        issues.append(
            ValidationIssue(
                path="title", code="required", message="Необходимо указать заголовок страницы"
            )
        )
    if document.page_meta.seo_title and len(document.page_meta.seo_title) > 60:
        issues.append(
            ValidationIssue(
                path="pageMeta.seoTitle",
                code="seo_title_too_long",
                message="SEO-заголовок не должен превышать 60 символов",
            )
        )
    social_configured = bool(
        document.page_meta.og_title
        or document.page_meta.og_description
        or document.page_meta.og_image
    )
    if social_configured and document.page_meta.og_image is None:
        issues.append(
            ValidationIssue(
                path="pageMeta.ogImage",
                code="missing_social_image",
                message="Для настроенного Open Graph необходимо изображение для соцсетей",
            )
        )
    allowed_hosts = (
        settings.embed_allowed_hosts if settings is not None else Settings().embed_allowed_hosts
    )
    for block in _iter_blocks(document.blocks):
        if block.type not in {"embed", "video"}:
            continue
        provider = block.props.get("provider")
        raw_url = block.props.get("url") or block.props.get("videoUrl")
        if provider == "file" and isinstance(raw_url, str) and raw_url.startswith("/"):
            continue
        if not isinstance(raw_url, str):
            continue
        parsed_provider = urlsplit(raw_url)
        if (
            parsed_provider.scheme.lower() != "https"
            or not parsed_provider.hostname
            or not _allowed_provider_host(parsed_provider.hostname, allowed_hosts)
        ):
            issues.append(
                ValidationIssue(
                    path=f"blocks.{block.id}.props",
                    code="provider_url_not_allowed",
                    message=(
                        f"URL блока '{block.type}' должен использовать HTTPS "
                        "и разрешённый домен поставщика"
                    ),
                )
            )
    asset_ids, form_ids, reference_issues = referenced_ids(document)
    issues.extend(reference_issues)
    if asset_ids:
        found = set(
            (
                await session.scalars(
                    select(Asset.id).where(
                        Asset.id.in_(asset_ids),
                        Asset.site_id == page.site_id,
                        Asset.deleted_at.is_(None),
                        Asset.status == "ready",
                    )
                )
            ).all()
        )
        for missing in sorted(asset_ids - found, key=str):
            issues.append(
                ValidationIssue(
                    path="assetsRefs",
                    code="missing_asset",
                    message=f"Медиафайл {missing} не существует или ещё не готов",
                )
            )
    if form_ids:
        found_forms = set(
            (
                await session.scalars(
                    select(Form.id).where(
                        Form.id.in_(form_ids),
                        Form.site_id == page.site_id,
                        Form.is_active.is_(True),
                    )
                )
            ).all()
        )
        for missing in sorted(form_ids - found_forms, key=str):
            issues.append(
                ValidationIssue(
                    path="blocks",
                    code="missing_form",
                    message=f"Форма {missing} не существует или неактивна",
                )
            )
    internal_paths: set[str] = set()
    for link in referenced_links(document):
        if link.startswith("#"):
            continue
        if link.startswith("/"):
            try:
                internal_paths.add(normalize_path(link))
            except AppError:
                issues.append(
                    ValidationIssue(
                        path="blocks",
                        code="invalid_link",
                        message=f"Ссылка '{link}' не является корректным локальным путём",
                    )
                )
            continue
        parsed = urlsplit(link)
        if parsed.scheme.lower() not in SAFE_LINK_SCHEMES or (
            parsed.scheme.lower() in {"http", "https"} and not parsed.netloc
        ):
            issues.append(
                ValidationIssue(
                    path="blocks",
                    code="unsafe_link",
                    message=(
                        f"Ссылка '{link}' использует неподдерживаемую или небезопасную схему URL"
                    ),
                )
            )
    if internal_paths:
        known_paths = set(
            (
                await session.scalars(
                    select(Route.path)
                    .join(Page, Page.id == Route.page_id)
                    .where(
                        Route.site_id == page.site_id,
                        Route.path.in_(internal_paths),
                        Page.deleted_at.is_(None),
                    )
                )
            ).all()
        )
        for missing in sorted(internal_paths - known_paths):
            issues.append(
                ValidationIssue(
                    path="blocks",
                    code="broken_internal_link",
                    message=f"Внутренняя ссылка '{missing}' не соответствует маршруту страницы",
                )
            )
    return issues


async def get_page(
    session: AsyncSession,
    page_id: UUID,
    *,
    include_deleted: bool = False,
    for_update: bool = False,
) -> Page:
    statement = select(Page).where(Page.id == page_id)
    if not include_deleted:
        statement = statement.where(Page.deleted_at.is_(None))
    if for_update:
        statement = statement.with_for_update()
    page = await session.scalar(statement)
    if page is None:
        raise not_found("Page")
    return page


async def create_page(
    session: AsyncSession,
    payload: PageCreate,
    actor: User,
    block_registry: BlockRegistry = registry,
    settings: Settings | None = None,
) -> tuple[Page, Route]:
    site = await session.get(Site, payload.site_id)
    if site is None or not site.is_active:
        raise not_found("Site")
    locale = settings.default_locale if settings is not None else site.default_locale or "ru"
    source_document = payload.document.model_copy(update={"locale": locale})
    document = sanitize_document(source_document, block_registry)
    _raise_issues(block_registry.validate(document, actor_role=actor.role))
    route_path = normalize_path(payload.route_path)
    occupied = await session.scalar(
        select(Route.id).where(Route.site_id == payload.site_id, Route.path == route_path)
    )
    if occupied is not None:
        raise conflict("Путь маршрута уже занят")
    page = Page(
        site_id=payload.site_id,
        folder_id=payload.folder_id,
        title=payload.title.strip(),
        slug=payload.slug,
        content_type=payload.content_type.value,
        section_key=payload.section_key,
        listing_meta=payload.listing_meta.model_dump(mode="json", by_alias=True),
        status=PageStatus.DRAFT.value,
        draft_document=document_json(document),
        draft_version=1,
        created_by=actor.id,
        updated_by=actor.id,
    )
    session.add(page)
    await session.flush()
    route = Route(
        site_id=payload.site_id,
        page_id=page.id,
        path=route_path,
        locale=locale,
        is_primary=True,
        is_active=False,
    )
    session.add(route)
    await session.flush()
    return page, route


async def update_draft(
    session: AsyncSession,
    page_id: UUID,
    expected_version: int,
    document: PageDocument,
    actor: User,
    block_registry: BlockRegistry = registry,
    settings: Settings | None = None,
) -> Page:
    source_document = (
        document.model_copy(update={"locale": settings.default_locale})
        if settings is not None
        else document
    )
    sanitized = sanitize_document(source_document, block_registry)
    _raise_issues(block_registry.validate(sanitized, actor_role=actor.role))
    timestamp = utcnow()
    lock_cutoff = timestamp - timedelta(seconds=settings.edit_lock_ttl_seconds if settings else 120)
    statement = (
        update(Page)
        .where(
            Page.id == page_id,
            Page.deleted_at.is_(None),
            Page.draft_version == expected_version,
            or_(
                Page.locked_by.is_(None),
                Page.locked_by == actor.id,
                Page.locked_at.is_(None),
                Page.locked_at < lock_cutoff,
            ),
        )
        .values(
            draft_document=document_json(sanitized),
            draft_version=Page.draft_version + 1,
            updated_by=actor.id,
            updated_at=timestamp,
            status=case(
                (Page.status == PageStatus.PUBLISHED.value, PageStatus.PUBLISHED.value),
                else_=PageStatus.DRAFT.value,
            ),
            review_status=ReviewDecision.NONE.value,
            review_comment=None,
        )
        .execution_options(synchronize_session=False)
    )
    result = await session.execute(statement)
    if result.rowcount != 1:
        current_page = await session.scalar(
            select(Page).where(
                Page.id == page_id,
                Page.deleted_at.is_(None),
            )
        )
        if current_page is None:
            raise not_found("Page")
        if settings is not None:
            assert_editable(current_page, actor, settings)
        raise conflict(
            "Черновик был изменён другим редактором",
            {
                "expectedVersion": expected_version,
                "currentVersion": current_page.draft_version,
            },
        )
    page = await session.scalar(
        select(Page).where(Page.id == page_id).execution_options(populate_existing=True)
    )
    assert page is not None
    if settings is not None:
        await maybe_create_autosave_revision(session, page, actor.id, sanitized, settings)
    return page


async def _next_revision_number(session: AsyncSession, page_id: UUID) -> int:
    current = await session.scalar(
        select(func.max(Revision.number)).where(Revision.page_id == page_id)
    )
    return int(current or 0) + 1


async def create_revision(
    session: AsyncSession,
    page: Page,
    actor_id: UUID | None,
    *,
    document: PageDocument | None = None,
    kind: str = "manual",
    message: str | None = None,
    source_revision_id: UUID | None = None,
) -> Revision:
    await session.execute(select(Page.id).where(Page.id == page.id).with_for_update())
    document = document or parse_document(page.draft_document)
    revision = Revision(
        page_id=page.id,
        number=await _next_revision_number(session, page.id),
        document=document_json(document),
        checksum=document_checksum(document),
        draft_version=page.draft_version,
        kind=kind,
        message=message,
        source_revision_id=source_revision_id,
        created_by=actor_id,
    )
    session.add(revision)
    await session.flush()
    return revision


async def maybe_create_autosave_revision(
    session: AsyncSession,
    page: Page,
    actor_id: UUID,
    document: PageDocument,
    settings: Settings,
) -> Revision | None:
    latest = await session.scalar(
        select(Revision)
        .where(
            Revision.page_id == page.id,
            Revision.kind == "autosave",
        )
        .order_by(Revision.created_at.desc())
        .limit(1)
    )
    now = utcnow()
    if latest is not None:
        created_at = latest.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        if now - created_at < timedelta(seconds=settings.autosave_snapshot_interval_seconds):
            return None
        if latest.checksum == document_checksum(document):
            return None
    snapshot = await create_revision(
        session,
        page,
        actor_id,
        document=document,
        kind="autosave",
        message=f"Автосохранение версии черновика {page.draft_version}",
    )
    retained_ids = list(
        (
            await session.scalars(
                select(Revision.id)
                .where(
                    Revision.page_id == page.id,
                    Revision.kind == "autosave",
                )
                .order_by(Revision.created_at.desc())
                .offset(settings.autosave_snapshot_retention)
            )
        ).all()
    )
    if retained_ids:
        await session.execute(delete(Revision).where(Revision.id.in_(retained_ids)))
    return snapshot


async def restore_revision_to_draft(
    session: AsyncSession,
    page_id: UUID,
    revision_id: UUID,
    expected_version: int,
    actor: User,
    settings: Settings | None = None,
) -> Page:
    revision = await session.scalar(
        select(Revision).where(Revision.id == revision_id, Revision.page_id == page_id)
    )
    if revision is None:
        raise not_found("Revision")
    return await update_draft(
        session,
        page_id,
        expected_version,
        parse_document(revision.document),
        actor,
        settings=settings,
    )


async def _activate_route(
    session: AsyncSession,
    page: Page,
    path: str,
    locale: str = "ru",
) -> Route:
    path = normalize_path(path)
    conflict_page = await session.scalar(
        select(Route.page_id).where(
            Route.site_id == page.site_id,
            Route.path == path,
            Route.page_id != page.id,
        )
    )
    if conflict_page is not None:
        raise conflict("Путь маршрута уже занят")
    previous = await session.scalar(
        select(Route).where(
            Route.page_id == page.id,
            Route.is_primary.is_(True),
        )
    )
    await session.execute(
        update(Route).where(Route.page_id == page.id).values(is_active=False, is_primary=False)
    )
    route = await session.scalar(select(Route).where(Route.page_id == page.id, Route.path == path))
    if route is None:
        route = Route(
            site_id=page.site_id,
            page_id=page.id,
            path=path,
            locale=locale,
        )
        session.add(route)
    route.locale = locale
    route.is_active = True
    route.is_primary = True
    if previous is not None and previous.path != path:
        existing_redirect = await session.scalar(
            select(Redirect).where(
                Redirect.site_id == page.site_id,
                Redirect.source_path == previous.path,
            )
        )
        if existing_redirect is None:
            session.add(
                Redirect(
                    site_id=page.site_id,
                    source_path=previous.path,
                    destination=path,
                    status_code=301,
                    is_active=True,
                )
            )
    await session.flush()
    return route


async def publish_page(
    session: AsyncSession,
    page_id: UUID,
    payload: PublishRequest,
    actor: User,
    cache: ResilientCache,
    *,
    source_document: PageDocument | None = None,
    source_revision_id: UUID | None = None,
    kind: str = "published",
    force_revision: bool = False,
    settings: Settings | None = None,
) -> tuple[Page, Revision]:
    page = await get_page(session, page_id, for_update=True)
    await session.execute(
        update(PublishJob)
        .where(
            PublishJob.page_id == page.id,
            PublishJob.status == JobStatus.PENDING.value,
        )
        .values(status=JobStatus.CANCELLED.value)
    )
    if page.draft_version != payload.expected_version:
        raise conflict(
            "Черновик был изменён другим редактором",
            {
                "expectedVersion": payload.expected_version,
                "currentVersion": page.draft_version,
            },
        )
    document = sanitize_document(source_document or parse_document(page.draft_document))
    _raise_issues(await validate_for_publish(session, page, document, settings=settings))
    checksum = document_checksum(document)
    current_revision = (
        await session.get(Revision, page.published_revision_id)
        if page.published_revision_id
        else None
    )
    route = await session.scalar(
        select(Route).where(Route.page_id == page.id, Route.is_primary.is_(True))
    )
    requested_path = normalize_path(
        payload.route_path or (route.path if route else f"/{page.slug}")
    )
    if (
        not force_revision
        and current_revision is not None
        and current_revision.checksum == checksum
        and route is not None
        and route.path == requested_path
        and route.is_active
        and page.status == PageStatus.PUBLISHED.value
    ):
        await invalidate_public_content(cache, page.site_id)
        return page, current_revision
    revision = await create_revision(
        session,
        page,
        actor.id,
        document=document,
        kind=kind,
        message=payload.message,
        source_revision_id=source_revision_id,
    )
    page.draft_document = document_json(document)
    page.published_revision_id = revision.id
    page.published_at = utcnow()
    page.status = PageStatus.PUBLISHED.value
    page.review_status = ReviewDecision.APPROVED.value
    page.updated_by = actor.id
    await _activate_route(
        session,
        page,
        requested_path,
        settings.default_locale if settings is not None else document.locale,
    )
    await session.flush()
    await invalidate_public_content(cache, page.site_id)
    return page, revision


async def rollback_page(
    session: AsyncSession,
    page_id: UUID,
    revision_id: UUID,
    payload: PublishRequest,
    actor: User,
    cache: ResilientCache,
    settings: Settings | None = None,
) -> tuple[Page, Revision]:
    source = await session.scalar(
        select(Revision).where(Revision.id == revision_id, Revision.page_id == page_id)
    )
    if source is None:
        raise not_found("Revision")
    page = await get_page(session, page_id)
    if payload.expected_version != page.draft_version:
        raise conflict(
            "Черновик был изменён другим редактором",
            {
                "expectedVersion": payload.expected_version,
                "currentVersion": page.draft_version,
            },
        )
    page.draft_document = source.document
    page.draft_version += 1
    page.updated_by = actor.id
    await session.flush()
    return await publish_page(
        session,
        page_id,
        payload.model_copy(update={"expected_version": page.draft_version}),
        actor,
        cache,
        source_document=parse_document(source.document),
        source_revision_id=source.id,
        kind="rollback",
        force_revision=True,
        settings=settings,
    )


async def schedule_page(
    session: AsyncSession,
    page_id: UUID,
    payload: ScheduleRequest,
    actor: User,
    cache: ResilientCache,
    settings: Settings | None = None,
) -> tuple[Page, PublishJob, Revision]:
    run_at = payload.run_at
    if run_at.tzinfo is None or run_at.utcoffset() is None:
        raise AppError(422, "invalid_schedule", "Поле runAt должно содержать часовой пояс")
    run_at = run_at.astimezone(UTC)
    if run_at <= datetime.now(UTC):
        raise AppError(422, "invalid_schedule", "Поле runAt должно указывать время в будущем")
    page = await get_page(session, page_id, for_update=True)
    if payload.expected_version != page.draft_version:
        raise conflict(
            "Черновик был изменён другим редактором",
            {
                "expectedVersion": payload.expected_version,
                "currentVersion": page.draft_version,
            },
        )
    document = sanitize_document(parse_document(page.draft_document))
    _raise_issues(await validate_for_publish(session, page, document, settings=settings))
    current_route = await session.scalar(
        select(Route).where(Route.page_id == page.id, Route.is_primary.is_(True))
    )
    route_path = normalize_path(
        payload.route_path or (current_route.path if current_route else f"/{page.slug}")
    )
    await session.execute(
        update(PublishJob)
        .where(
            PublishJob.page_id == page.id,
            PublishJob.status == JobStatus.PENDING.value,
        )
        .values(status=JobStatus.CANCELLED.value)
    )
    revision = await create_revision(
        session,
        page,
        actor.id,
        document=document,
        kind="scheduled",
        message=payload.message,
    )
    job = PublishJob(
        page_id=page.id,
        action="publish",
        status=JobStatus.PENDING.value,
        run_at=run_at,
        route_path=route_path,
        revision_id=revision.id,
        expected_draft_version=page.draft_version,
        created_by=actor.id,
    )
    session.add(job)
    page.status = PageStatus.SCHEDULED.value
    page.updated_by = actor.id
    await session.flush()
    await invalidate_public_content(cache, page.site_id)
    return page, job, revision


async def unpublish_page(
    session: AsyncSession,
    page_id: UUID,
    actor: User,
    cache: ResilientCache,
) -> Page:
    page = await get_page(session, page_id, for_update=True)
    await session.execute(update(Route).where(Route.page_id == page.id).values(is_active=False))
    await session.execute(
        update(PublishJob)
        .where(
            PublishJob.page_id == page.id,
            PublishJob.status == JobStatus.PENDING.value,
        )
        .values(status=JobStatus.CANCELLED.value)
    )
    page.status = PageStatus.DRAFT.value
    page.updated_by = actor.id
    await session.flush()
    await invalidate_public_content(cache, page.site_id)
    return page
