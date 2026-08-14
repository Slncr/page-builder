from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Request, status
from sqlalchemy import select

from app.audit import add_audit
from app.dependencies import AdminUser, SessionDep
from app.errors import AppError, conflict, not_found
from app.models import Page, PageStatus, Route, Site
from app.schemas import LegacyImportOut, LegacyImportRequest, PageCreate
from app.services import (
    create_page,
    document_checksum,
    normalize_path,
    update_draft,
)

router = APIRouter(prefix="/legacy", tags=["legacy"])


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:180] or "legacy-page"


async def _available_slug(session: SessionDep, site_id: object, candidate: str) -> str:
    slug = candidate
    suffix = 1
    while await session.scalar(select(Page.id).where(Page.site_id == site_id, Page.slug == slug)):
        suffix += 1
        slug = f"{candidate[:170]}-{suffix}"
    return slug


@router.get("/inventory")
async def legacy_inventory(
    request: Request,
    _actor: AdminUser,
) -> dict[str, Any]:
    try:
        items = await request.app.state.legacy_importer.inventory()
    except Exception as exc:
        raise AppError(
            502,
            "legacy_inventory_failed",
            "Не удалось загрузить список страниц прежней системы",
            details={"diagnostic": "Адаптер прежней системы вернул ошибку"},
        ) from exc
    return {"items": items, "count": len(items), "diagnostics": []}


async def _import(
    source_id: str,
    payload: LegacyImportRequest,
    request: Request,
    session: SessionDep,
    actor: AdminUser,
) -> LegacyImportOut:
    site = await session.get(Site, payload.site_id)
    if site is None or not site.is_active:
        raise not_found("Site")
    try:
        imported = await request.app.state.legacy_importer.import_page(source_id)
    except LookupError as exc:
        raise not_found("Legacy source") from exc
    except Exception as exc:
        raise AppError(
            502,
            "legacy_import_failed",
            "Не удалось преобразовать страницу прежней системы",
            details={"diagnostic": "Адаптер прежней системы вернул ошибку преобразования"},
        ) from exc
    fingerprint = imported.fingerprint or document_checksum(imported.document)
    existing = await session.scalar(
        select(Page).where(
            Page.site_id == payload.site_id,
            Page.source_identifier == source_id,
            Page.deleted_at.is_(None),
        )
    )
    warnings = list(imported.warnings)
    diagnostics = {
        "warnings": warnings,
        "sourceUrl": imported.source_url,
        "importedAt": datetime.now(UTC).isoformat(),
    }
    created = False
    updated = False
    parsed_path = urlsplit(imported.source_url).path or "/"
    requested_path = normalize_path(payload.route_path or parsed_path)
    if existing is None:
        raw_slug = payload.slug or parsed_path.rstrip("/").rsplit("/", 1)[-1] or imported.source_id
        slug = await _available_slug(session, payload.site_id, _slugify(raw_slug))
        page, _route = await create_page(
            session,
            PageCreate(
                site_id=payload.site_id,
                folder_id=payload.folder_id,
                title=imported.title,
                slug=slug,
                route_path=requested_path,
                document=imported.document,
            ),
            actor,
            settings=request.app.state.settings,
        )
        page.source_identifier = source_id
        page.source_url = imported.source_url
        page.source_fingerprint = fingerprint
        page.source_type = "legacy_import"
        page.render_mode = "builder"
        page.status = PageStatus.IMPORTED_DRAFT.value
        page.import_diagnostics = diagnostics
        existing = page
        created = True
    elif existing.source_fingerprint != fingerprint:
        existing = await update_draft(
            session,
            existing.id,
            existing.draft_version,
            imported.document,
            actor,
            settings=request.app.state.settings,
        )
        existing.title = imported.title
        existing.folder_id = payload.folder_id
        existing.source_url = imported.source_url
        existing.source_fingerprint = fingerprint
        existing.source_type = "legacy_import"
        existing.render_mode = "builder"
        existing.status = PageStatus.IMPORTED_DRAFT.value
        existing.import_diagnostics = diagnostics
        route = await session.scalar(
            select(Route).where(
                Route.page_id == existing.id,
                Route.is_primary.is_(True),
            )
        )
        occupied = await session.scalar(
            select(Route.page_id).where(
                Route.site_id == existing.site_id,
                Route.path == requested_path,
                Route.page_id != existing.id,
            )
        )
        if occupied is not None:
            raise conflict("Путь импортированного маршрута уже занят")
        if route is not None:
            route.path = requested_path
            route.locale = request.app.state.settings.default_locale
        updated = True
    add_audit(
        session,
        request,
        actor=actor,
        action="legacy.page_imported",
        resource_type="page",
        resource_id=existing.id,
        details={
            "sourceId": source_id,
            "fingerprint": fingerprint,
            "created": created,
            "updated": updated,
            "warnings": warnings,
        },
    )
    await session.flush()
    return LegacyImportOut(
        page=existing,
        created=created,
        updated=updated,
        warnings=warnings,
        fingerprint=fingerprint,
    )


@router.post("/import", response_model=LegacyImportOut, status_code=status.HTTP_200_OK)
async def import_legacy_page(
    payload: LegacyImportRequest,
    request: Request,
    session: SessionDep,
    actor: AdminUser,
) -> LegacyImportOut:
    if payload.source_id is None:
        raise AppError(422, "source_id_required", "Необходимо передать sourceId")
    return await _import(payload.source_id, payload, request, session, actor)


@router.post("/import/{source_id}", response_model=LegacyImportOut)
async def import_legacy_page_by_id(
    source_id: str,
    payload: LegacyImportRequest,
    request: Request,
    session: SessionDep,
    actor: AdminUser,
) -> LegacyImportOut:
    if len(source_id) > 500:
        raise AppError(
            422,
            "invalid_source_id",
            "Идентификатор источника прежней системы слишком длинный",
        )
    return await _import(source_id, payload, request, session, actor)
