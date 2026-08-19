from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from html import escape
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import String, cast, func, select

from app.dependencies import OptionalUser, SessionDep
from app.errors import AppError, not_found
from app.models import (
    Asset,
    Form,
    Page,
    PageContentType,
    PageStatus,
    Redirect,
    Rendition,
    Revision,
    Route,
    Site,
    Submission,
    WebhookDelivery,
)
from app.schemas import (
    SECTION_KEY_PATTERN,
    ListingMeta,
    PageOut,
    PublicPageDetailOut,
    PublicPageListItem,
    PublicPageListOut,
    PublicResolveOut,
    SubmissionCreate,
)
from app.security import decode_preview_token, hash_sensitive
from app.services import normalize_path, parse_document

router = APIRouter(tags=["public"])


def _listing_meta_payload(page: Page) -> dict[str, Any]:
    return ListingMeta.model_validate(page.listing_meta or {}).model_dump(
        mode="json",
        by_alias=True,
    )


def _page_etag(page: Page, route: Route, revision: Revision) -> str:
    representation = {
        "revisionId": str(revision.id),
        "checksum": revision.checksum,
        "path": route.path,
        "title": page.title,
        "slug": page.slug,
        "contentType": page.content_type,
        "sectionKey": page.section_key,
        "listingMeta": _listing_meta_payload(page),
    }
    digest = hashlib.sha256(
        json.dumps(
            representation,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
    ).hexdigest()[:16]
    return f"rev-{revision.id}-{digest}"


def _public_page_fields(page: Page, route: Route) -> dict[str, Any]:
    return {
        "id": str(page.id),
        "siteId": str(page.site_id),
        "title": page.title,
        "slug": page.slug,
        "contentType": page.content_type,
        "sectionKey": page.section_key,
        "listingMeta": _listing_meta_payload(page),
        "path": route.path,
    }


def _etag_matches(request: Request, etag: str) -> bool:
    for candidate in request.headers.get("If-None-Match", "").split(","):
        normalized = candidate.strip()
        if normalized == "*":
            return True
        if normalized.startswith("W/"):
            normalized = normalized[2:].strip()
        if normalized.strip('"') == etag:
            return True
    return False


def _preview_token(request: Request, query_token: str | None) -> str | None:
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("preview "):
        return authorization[8:].strip()
    return query_token


async def _site(session: SessionDep, slug: str | None) -> Site | None:
    statement = select(Site).where(Site.is_active.is_(True))
    if slug:
        statement = statement.where(Site.slug == slug)
    return await session.scalar(statement.order_by(Site.created_at).limit(1))


async def _resolve_database(
    session: SessionDep,
    path: str,
    site_slug: str | None,
) -> tuple[dict[str, Any], Site | None]:
    site = await _site(session, site_slug)
    if site is None:
        return {"mode": "not_found", "cacheTtl": 30}, None
    redirect = await session.scalar(
        select(Redirect).where(
            Redirect.site_id == site.id,
            Redirect.source_path == path,
            Redirect.is_active.is_(True),
        )
    )
    if redirect:
        return (
            {
                "mode": "redirect",
                "location": redirect.destination,
                "statusCode": redirect.status_code,
                "cacheTtl": 300,
            },
            site,
        )
    candidate = (
        await session.execute(
            select(Route, Page)
            .join(Page, Page.id == Route.page_id)
            .where(
                Route.site_id == site.id,
                Route.path == path,
                Page.deleted_at.is_(None),
            )
        )
    ).first()
    if candidate is not None and candidate[1].render_mode == "legacy":
        return {"mode": "legacy_required", "cacheTtl": 30}, site
    row = (
        await session.execute(
            select(Route, Page, Revision)
            .join(Page, Page.id == Route.page_id)
            .join(Revision, Revision.id == Page.published_revision_id)
            .where(
                Route.site_id == site.id,
                Route.path == path,
                Route.is_active.is_(True),
                Page.status == PageStatus.PUBLISHED.value,
                Page.render_mode.in_(["builder", "fallback_legacy"]),
                Page.deleted_at.is_(None),
            )
        )
    ).first()
    if row:
        route, page, revision = row
        etag = _page_etag(page, route, revision)
        return (
            {
                "mode": "builder",
                "pageId": str(page.id),
                "revisionId": str(revision.id),
                "path": route.path,
                "contentType": page.content_type,
                "sectionKey": page.section_key,
                "listingMeta": _listing_meta_payload(page),
                "etag": etag,
                "cacheTtl": 300,
            },
            site,
        )
    if candidate is not None and candidate[1].render_mode == "builder":
        return {"mode": "not_found", "cacheTtl": 30, "fallbackAllowed": False}, site
    return {"mode": "not_found", "cacheTtl": 30}, site


async def _legacy_fallback(request: Request, path: str, locale: str | None) -> dict[str, Any]:
    if (
        not request.app.state.settings.legacy_fallback_enabled
        or not request.app.state.legacy_adapter_available
    ):
        return {"mode": "not_found", "cacheTtl": 30}
    try:
        result = await request.app.state.legacy_importer.resolve(path, locale)
        return {
            "mode": result.mode,
            "cacheTtl": 30,
            "metadata": result.metadata or {},
        }
    except Exception as exc:
        if request.app.state.settings.public_read_fail_closed:
            raise AppError(
                503,
                "legacy_resolver_unavailable",
                "Сервис маршрутов прежней системы недоступен",
            ) from exc
        return {"mode": "not_found", "cacheTtl": 5}


@router.get(
    "/public/route",
    response_model=PublicResolveOut,
    response_model_exclude_unset=True,
)
@router.get(
    "/public/resolve",
    response_model=PublicResolveOut,
    response_model_exclude_unset=True,
)
async def resolve_route(
    request: Request,
    session: SessionDep,
    path: Annotated[str, Query(min_length=1, max_length=1024)],
    site: Annotated[str | None, Query(max_length=100)] = None,
    locale: Annotated[str | None, Query(max_length=20)] = None,
) -> dict[str, Any]:
    route_path = normalize_path(path)
    resolved_locale = locale or request.app.state.settings.default_locale
    if not request.app.state.settings.public_renderer_enabled:
        return await _legacy_fallback(request, route_path, resolved_locale)
    cache_key = f"resolver:v2:{site or 'default'}:{resolved_locale}:{route_path}"
    cached = await request.app.state.cache.get_json(cache_key)
    if cached is not None:
        return cached
    try:
        result, resolved_site = await _resolve_database(session, route_path, site)
    except Exception as exc:
        await session.rollback()
        if request.app.state.legacy_adapter_available:
            return await _legacy_fallback(request, route_path, resolved_locale)
        if request.app.state.settings.public_read_fail_closed:
            raise AppError(
                503,
                "public_read_unavailable",
                "Опубликованный контент временно недоступен",
            ) from exc
        return {"mode": "not_found", "cacheTtl": 5}
    if result["mode"] == "legacy_required":
        result = await _legacy_fallback(request, route_path, resolved_locale)
    elif result["mode"] == "not_found" and result.get("fallbackAllowed", True):
        result = await _legacy_fallback(request, route_path, resolved_locale)
    ttl = int(result.get("cacheTtl", 30))
    await request.app.state.cache.set_json(cache_key, result, ttl)
    if resolved_site:
        await request.app.state.cache.set_json(
            f"public:{resolved_site.id}:resolver:{route_path}", result, ttl
        )
    return result


async def _published_page(
    session: SessionDep,
    path: str,
    site_slug: str | None,
) -> tuple[Site, Route, Page, Revision] | None:
    site = await _site(session, site_slug)
    if site is None:
        return None
    row = (
        await session.execute(
            select(Route, Page, Revision)
            .join(Page, Page.id == Route.page_id)
            .join(Revision, Revision.id == Page.published_revision_id)
            .where(
                Route.site_id == site.id,
                Route.path == path,
                Route.is_active.is_(True),
                Page.status == PageStatus.PUBLISHED.value,
                Page.render_mode.in_(["builder", "fallback_legacy"]),
                Page.deleted_at.is_(None),
            )
        )
    ).first()
    if row is None:
        return None
    route, page, revision = row
    return site, route, page, revision


def _cache_headers(etag: str, max_age: int) -> dict[str, str]:
    return {
        "ETag": f'"{etag}"',
        "Cache-Control": (f"public, max-age={max_age}, stale-while-revalidate={max_age * 5}"),
        "Vary": "Accept-Encoding",
        "X-Content-Type-Options": "nosniff",
    }


@router.get(
    "/public/pages",
    response_model=PublicPageListOut,
    responses={status.HTTP_304_NOT_MODIFIED: {"description": "Not modified"}},
)
async def list_public_pages(
    request: Request,
    session: SessionDep,
    site: Annotated[str | None, Query(max_length=100)] = None,
    content_type: Annotated[
        PageContentType | None,
        Query(alias="contentType"),
    ] = None,
    section: Annotated[
        str | None,
        Query(max_length=100, pattern=SECTION_KEY_PATTERN.pattern),
    ] = None,
    featured: Annotated[bool | None, Query()] = None,
    path_prefix: Annotated[
        str | None,
        Query(alias="pathPrefix", min_length=1, max_length=1024),
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 20,
) -> Response:
    if not request.app.state.settings.public_renderer_enabled:
        raise not_found("Published pages")
    resolved_site = await _site(session, site)
    if resolved_site is None:
        raise not_found("Site")
    normalized_prefix = normalize_path(path_prefix) if path_prefix is not None else None
    filter_payload = {
        "siteId": str(resolved_site.id),
        "contentType": content_type.value if content_type else None,
        "section": section,
        "featured": featured,
        "pathPrefix": normalized_prefix,
        "page": page,
        "pageSize": page_size,
    }
    filter_digest = hashlib.sha256(
        json.dumps(filter_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    cache_key = f"public:{resolved_site.id}:feed:{filter_digest}"
    max_age = request.app.state.settings.public_cache_seconds
    cached = await request.app.state.cache.get_json(cache_key)
    if cached is not None and isinstance(cached.get("etag"), str):
        etag = cached["etag"]
        headers = _cache_headers(etag, max_age)
        if _etag_matches(request, etag):
            return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
        return JSONResponse(content=cached, headers=headers)

    filters = [
        Route.site_id == resolved_site.id,
        Route.is_primary.is_(True),
        Route.is_active.is_(True),
        Page.status == PageStatus.PUBLISHED.value,
        Page.render_mode.in_(["builder", "fallback_legacy"]),
        Page.deleted_at.is_(None),
        func.coalesce(
            Page.listing_meta["hiddenFromLists"].as_boolean(),
            False,
        ).is_(False),
    ]
    if content_type is not None:
        filters.append(Page.content_type == content_type.value)
    if section is not None:
        filters.append(Page.section_key == section)
    if featured is not None:
        filters.append(
            func.coalesce(Page.listing_meta["featured"].as_boolean(), False).is_(featured)
        )
    if normalized_prefix is not None:
        filters.append(Route.path.startswith(normalized_prefix, autoescape=True))

    sort_order = func.coalesce(Page.listing_meta["sortOrder"].as_integer(), 0)
    display_at = func.coalesce(
        Page.listing_meta["publishedDisplayAt"].as_string(),
        cast(Page.published_at, String),
    )
    statement = (
        select(Page, Revision, Route)
        .join(Revision, Revision.id == Page.published_revision_id)
        .join(Route, Route.page_id == Page.id)
        .where(*filters)
        .order_by(
            sort_order.asc(),
            display_at.desc(),
            Page.published_at.desc(),
            Route.path.asc(),
            Page.id.asc(),
        )
    )
    total = int(
        await session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
        or 0
    )
    rows = (await session.execute(statement.offset((page - 1) * page_size).limit(page_size))).all()
    items = [
        PublicPageListItem(
            id=item.id,
            site_id=item.site_id,
            title=item.title,
            slug=item.slug,
            content_type=item.content_type,
            section_key=item.section_key,
            listing_meta=ListingMeta.model_validate(item.listing_meta or {}),
            path=route.path,
            published_at=item.published_at,
            updated_at=item.updated_at,
            revision_id=revision.id,
            etag=_page_etag(item, route, revision),
            checksum=revision.checksum,
        ).model_dump(mode="json", by_alias=True)
        for item, revision, route in rows
    ]
    representation = {
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size,
    }
    etag = (
        "feed-"
        + hashlib.sha256(
            json.dumps(
                representation,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode("utf-8")
        ).hexdigest()
    )
    payload = {**representation, "etag": etag}
    headers = _cache_headers(etag, max_age)
    if max_age > 0:
        await request.app.state.cache.set_json(cache_key, payload, max_age)
    if _etag_matches(request, etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return JSONResponse(content=payload, headers=headers)


@router.get(
    "/public/pages/by-path",
    response_model=PublicPageDetailOut,
    responses={status.HTTP_304_NOT_MODIFIED: {"description": "Not modified"}},
)
async def public_page_by_path(
    request: Request,
    session: SessionDep,
    path: Annotated[str, Query(min_length=1, max_length=1024)],
    site: Annotated[str | None, Query(max_length=100)] = None,
) -> Response:
    if not request.app.state.settings.public_renderer_enabled:
        raise not_found("Published page")
    route_path = normalize_path(path)
    result = await _published_page(session, route_path, site)
    if result is None:
        raise not_found("Published page")
    resolved_site, route, page, revision = result
    max_age = request.app.state.settings.public_cache_seconds
    etag = _page_etag(page, route, revision)
    headers = _cache_headers(etag, max_age)
    if _etag_matches(request, etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    cache_key = f"public:{resolved_site.id}:page:v2:{route.path}:{etag}"
    payload = await request.app.state.cache.get_json(cache_key)
    if payload is None:
        payload = {
            "page": _public_page_fields(page, route),
            "revisionId": str(revision.id),
            "document": revision.document,
            "etag": etag,
            "checksum": revision.checksum,
        }
        await request.app.state.cache.set_json(cache_key, payload, max_age)
    return JSONResponse(content=payload, headers=headers)


@router.get(
    "/public/pages/{page_id}",
    response_model=PublicPageDetailOut,
    responses={status.HTTP_304_NOT_MODIFIED: {"description": "Not modified"}},
)
async def public_page_by_id(
    page_id: UUID,
    request: Request,
    session: SessionDep,
) -> Response:
    if not request.app.state.settings.public_renderer_enabled:
        raise not_found("Published page")
    row = (
        await session.execute(
            select(Page, Revision, Route)
            .join(Revision, Revision.id == Page.published_revision_id)
            .join(Route, Route.page_id == Page.id)
            .where(
                Page.id == page_id,
                Page.status == PageStatus.PUBLISHED.value,
                Page.render_mode.in_(["builder", "fallback_legacy"]),
                Page.deleted_at.is_(None),
                Route.is_primary.is_(True),
                Route.is_active.is_(True),
            )
        )
    ).first()
    if row is None:
        raise not_found("Published page")
    page, revision, route = row
    etag = _page_etag(page, route, revision)
    headers = _cache_headers(etag, request.app.state.settings.public_cache_seconds)
    if _etag_matches(request, etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return JSONResponse(
        content={
            "page": _public_page_fields(page, route),
            "revisionId": str(revision.id),
            "document": revision.document,
            "etag": etag,
            "checksum": revision.checksum,
        },
        headers=headers,
    )


@router.get("/public/assets/{asset_id}")
async def public_asset(
    asset_id: UUID,
    request: Request,
    session: SessionDep,
) -> Response:
    asset = await session.scalar(
        select(Asset).where(
            Asset.id == asset_id,
            Asset.deleted_at.is_(None),
            Asset.status == "ready",
        )
    )
    if asset is None:
        raise not_found("Asset")
    safe_filename = re.sub(r'[\r\n"\\]', "_", asset.filename)[:200]
    headers = {
        "ETag": f'"{asset.checksum}"',
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": (
            "inline"
            if asset.content_type.startswith(("image/", "video/"))
            else f'attachment; filename="{safe_filename}"'
        ),
    }
    if request.headers.get("If-None-Match", "").strip('"') == asset.checksum:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    try:
        data = await request.app.state.storage.get(asset.object_key)
    except FileNotFoundError as exc:
        raise not_found("Asset object") from exc
    return Response(content=data, media_type=asset.content_type, headers=headers)


@router.get("/public/assets/{asset_id}/renditions/{name}")
async def public_rendition(
    asset_id: UUID,
    name: str,
    request: Request,
    session: SessionDep,
) -> Response:
    rendition = await session.scalar(
        select(Rendition)
        .join(Asset, Asset.id == Rendition.asset_id)
        .where(
            Rendition.asset_id == asset_id,
            Rendition.name == name,
            Asset.deleted_at.is_(None),
            Asset.status == "ready",
        )
    )
    if rendition is None:
        raise not_found("Rendition")
    etag = rendition.checksum or str(rendition.id)
    headers = {
        "ETag": f'"{etag}"',
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
    }
    if request.headers.get("If-None-Match", "").strip('"') == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    try:
        data = await request.app.state.storage.get(rendition.object_key)
    except FileNotFoundError as exc:
        raise not_found("Rendition object") from exc
    return Response(content=data, media_type=rendition.content_type, headers=headers)


def _validate_submission(form: Form, values: dict[str, Any]) -> dict[str, Any]:
    fields = form.schema.get("fields", [])
    cleaned: dict[str, Any] = {}
    for field in fields:
        if not isinstance(field, dict):
            continue
        name = field.get("name")
        if not isinstance(name, str) or not name:
            continue
        value = values.get(name)
        if field.get("required") and (value is None or value == "" or value is False):
            raise AppError(
                422,
                "form_validation_failed",
                f"Поле '{name}' обязательно для заполнения",
            )
        if value is None:
            continue
        if isinstance(value, str):
            value = value.strip()
            maximum = min(int(field.get("maxLength", 10_000)), 10_000)
            minimum = max(int(field.get("minLength", 0)), 0)
            if not minimum <= len(value) <= maximum:
                raise AppError(
                    422,
                    "form_validation_failed",
                    f"Поле '{name}' имеет недопустимую длину",
                )
            pattern = field.get("pattern")
            if isinstance(pattern, str) and len(pattern) <= 200:
                try:
                    matched = re.fullmatch(pattern, value)
                except re.error as exc:
                    raise AppError(
                        422,
                        "invalid_form_schema",
                        f"Для поля '{name}' задан некорректный шаблон проверки",
                    ) from exc
                if not matched:
                    raise AppError(
                        422,
                        "form_validation_failed",
                        f"Поле '{name}' содержит недопустимое значение",
                    )
            if field.get("type") == "email" and not re.fullmatch(
                r"[^@\s]+@[^@\s]+\.[^@\s]+", value
            ):
                raise AppError(
                    422,
                    "form_validation_failed",
                    f"Поле '{name}' должно содержать адрес электронной почты",
                )
        if not isinstance(value, (str, int, float, bool, list)):
            raise AppError(
                422,
                "form_validation_failed",
                f"Поле '{name}' содержит некорректное значение",
            )
        cleaned[name] = value
    return cleaned


@router.post(
    "/public/forms/{form_id}/submit",
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_form(
    form_id: UUID,
    payload: SubmissionCreate,
    request: Request,
    session: SessionDep,
) -> dict[str, str]:
    form = await session.scalar(select(Form).where(Form.id == form_id, Form.is_active.is_(True)))
    if form is None:
        raise not_found("Form")
    if payload.website and payload.website.strip():
        return {"status": "accepted"}
    antispam = form.settings.get("antispam", {})
    if not isinstance(antispam, dict):
        antispam = {}
    minimum_elapsed = antispam.get(
        "minimumElapsedSeconds",
        form.settings.get("minimumElapsedSeconds"),
    )
    if minimum_elapsed is None and antispam.get("enabled") is True:
        minimum_elapsed = request.app.state.settings.form_default_min_elapsed_seconds
    if minimum_elapsed is not None:
        try:
            minimum_seconds = float(minimum_elapsed)
        except (TypeError, ValueError) as exc:
            raise AppError(
                500,
                "invalid_form_settings",
                "Настройки защиты формы от спама некорректны",
            ) from exc
        if payload.started_at is None:
            raise AppError(
                422,
                "form_timing_required",
                "Необходимо указать время начала заполнения формы",
            )
        started_at = payload.started_at
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=UTC)
        elapsed = datetime.now(UTC) - started_at.astimezone(UTC)
        if elapsed < timedelta(seconds=max(minimum_seconds, 0)):
            raise AppError(422, "form_submitted_too_quickly", "Форма отправлена слишком быстро")
        if elapsed > timedelta(hours=request.app.state.settings.form_max_elapsed_hours):
            raise AppError(422, "form_timestamp_expired", "Время начала заполнения формы истекло")
    ip = request.client.host if request.client else "unknown"
    ip_hash = hash_sensitive(ip, request.app.state.settings)
    count = await request.app.state.cache.increment(f"form-rate:{form_id}:{ip_hash}", 300)
    if count > 10:
        raise AppError(
            429,
            "rate_limited",
            "Слишком много отправок формы; повторите попытку позже",
            headers={"Retry-After": "300"},
        )
    cleaned = _validate_submission(form, payload.data)
    fingerprint = hashlib.sha256(
        json.dumps(cleaned, sort_keys=True, default=str).encode("utf-8") + ip_hash.encode("ascii")
    ).hexdigest()
    duplicate_key = f"form-duplicate:{form_id}:{fingerprint}"
    if await request.app.state.cache.get_json(duplicate_key):
        return {"status": "accepted"}
    submission = Submission(
        form_id=form.id,
        data=cleaned,
        source_ip_hash=ip_hash,
        user_agent=request.headers.get("User-Agent", "")[:512] or None,
    )
    session.add(submission)
    await session.flush()
    webhook_url = form.settings.get("webhookUrl")
    if isinstance(webhook_url, str) and webhook_url:
        session.add(
            WebhookDelivery(
                submission_id=submission.id,
                url=webhook_url,
                payload={
                    "event": "form.submitted",
                    "formId": str(form.id),
                    "submissionId": str(submission.id),
                    "submittedAt": submission.created_at.isoformat(),
                    "data": cleaned,
                },
            )
        )
    await request.app.state.cache.set_json(duplicate_key, {"seen": True}, 60)
    return {"status": "accepted", "submissionId": str(submission.id)}


@router.get("/sitemap.xml")
async def sitemap(
    request: Request,
    session: SessionDep,
    site: Annotated[str | None, Query(max_length=100)] = None,
) -> Response:
    if not request.app.state.settings.public_renderer_enabled:
        raise not_found("Sitemap")
    resolved_site = await _site(session, site)
    if resolved_site is None:
        raise not_found("Site")
    rows = (
        await session.execute(
            select(Route.path, Page.updated_at, Revision.document)
            .join(Page, Page.id == Route.page_id)
            .join(Revision, Revision.id == Page.published_revision_id)
            .where(
                Route.site_id == resolved_site.id,
                Route.is_primary.is_(True),
                Route.is_active.is_(True),
                Page.status == PageStatus.PUBLISHED.value,
                Page.render_mode.in_(["builder", "fallback_legacy"]),
                Page.deleted_at.is_(None),
            )
            .order_by(Route.path)
        )
    ).all()
    base = resolved_site.domains[0].rstrip("/") if resolved_site.domains else ""
    entries: list[str] = []
    for path, updated_at, document_value in rows:
        document = parse_document(document_value)
        if document.page_meta.robots.startswith("noindex"):
            continue
        entries.append(
            "<url>"
            f"<loc>{escape(base + path)}</loc>"
            f"<lastmod>{updated_at.date().isoformat()}</lastmod>"
            f"<changefreq>{document.page_meta.change_frequency}</changefreq>"
            f"<priority>{document.page_meta.sitemap_priority:.1f}</priority>"
            "</url>"
        )
    urls = "".join(entries)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"{urls}</urlset>"
    )
    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.get("/preview/pages/{page_id}")
async def preview_page(
    page_id: UUID,
    request: Request,
    session: SessionDep,
    actor: OptionalUser,
    token: Annotated[str | None, Query(max_length=4096)] = None,
) -> Response:
    if actor is None:
        token = _preview_token(request, token)
        if token is None:
            raise AppError(
                401,
                "not_authenticated",
                "Необходима аутентификация или токен предпросмотра",
            )
        claims = decode_preview_token(token, page_id, request.app.state.settings)
    else:
        claims = None
    page = await session.scalar(select(Page).where(Page.id == page_id, Page.deleted_at.is_(None)))
    if page is None:
        raise not_found("Page")
    if claims is not None and claims.get("draftVersion") != page.draft_version:
        raise AppError(
            409,
            "stale_preview_token",
            "Токен предпросмотра относится к устаревшей версии черновика",
            details={
                "tokenVersion": claims.get("draftVersion"),
                "currentVersion": page.draft_version,
            },
        )
    return JSONResponse(
        content=jsonable_encoder(
            {
                "page": PageOut.model_validate(page),
                "document": parse_document(page.draft_document),
                "draftVersion": page.draft_version,
            }
        ),
        headers={
            "Cache-Control": "private, no-store",
            "X-Robots-Tag": "noindex, nofollow",
        },
    )


@router.get("/preview/pages/{page_id}/revisions/{revision_id}")
async def preview_revision(
    page_id: UUID,
    revision_id: UUID,
    request: Request,
    session: SessionDep,
    actor: OptionalUser,
    token: Annotated[str | None, Query(max_length=4096)] = None,
) -> Response:
    if actor is None:
        token = _preview_token(request, token)
        if token is None:
            raise AppError(
                401,
                "not_authenticated",
                "Необходима аутентификация или токен предпросмотра",
            )
        decode_preview_token(
            token,
            page_id,
            request.app.state.settings,
            revision_id=revision_id,
        )
    row = (
        await session.execute(
            select(Page, Revision)
            .join(Revision, Revision.page_id == Page.id)
            .where(
                Page.id == page_id,
                Page.deleted_at.is_(None),
                Revision.id == revision_id,
            )
        )
    ).first()
    if row is None:
        raise not_found("Revision")
    page, revision = row
    return JSONResponse(
        content=jsonable_encoder(
            {
                "page": PageOut.model_validate(page),
                "revisionId": revision.id,
                "draftVersion": revision.draft_version,
                "document": parse_document(revision.document),
            }
        ),
        headers={
            "Cache-Control": "private, no-store",
            "X-Robots-Tag": "noindex, nofollow",
        },
    )
