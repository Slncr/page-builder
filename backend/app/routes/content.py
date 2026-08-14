from __future__ import annotations

import csv
import io
import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from jsonschema import Draft202012Validator
from sqlalchemy import func, select

from app.audit import add_audit
from app.dependencies import (
    AdminUser,
    CopywriterUser,
    EditorUser,
    PublisherUser,
    SessionDep,
    ViewerUser,
)
from app.errors import AppError, not_found
from app.models import (
    AuditLog,
    Folder,
    Form,
    Page,
    Preset,
    Redirect,
    Setting,
    Submission,
    Template,
)
from app.registry import json_schema_error_message, registry
from app.schemas import (
    FolderCreate,
    FolderOut,
    FormCreate,
    FormOut,
    FormPatch,
    PageCreate,
    PageFromTemplate,
    PageOut,
    PresetCreate,
    PresetOut,
    PresetPatch,
    RedirectCreate,
    RedirectOut,
    SettingOut,
    SettingUpsert,
    SubmissionOut,
    TemplateCreate,
    TemplateOut,
    TemplatePatch,
)
from app.services import create_page, normalize_path, parse_document

router = APIRouter(tags=["content"])


def _validate_preset_data(block_type: str, data: dict[str, object]) -> None:
    definition = registry.get(block_type)
    if definition is None:
        raise AppError(422, "unknown_block", "Тип блока пресета не зарегистрирован")
    errors = sorted(
        Draft202012Validator(definition.schema).iter_errors(data),
        key=lambda item: list(item.absolute_path),
    )
    if errors:
        raise AppError(
            422,
            "invalid_preset",
            "Данные пресета не соответствуют схеме блока",
            details=[json_schema_error_message(error) for error in errors],
        )


async def _validate_form_settings(request: Request, settings: dict[str, object]) -> None:
    webhook_url = settings.get("webhookUrl")
    if webhook_url is not None:
        if not isinstance(webhook_url, str) or not webhook_url:
            raise AppError(
                422,
                "invalid_webhook_url",
                "Поле webhookUrl должно содержать непустой URL",
            )
        await request.app.state.webhooks.validate_target(webhook_url)


@router.get("/folders", response_model=list[FolderOut])
async def list_folders(
    session: SessionDep,
    _actor: ViewerUser,
    site_id: Annotated[UUID, Query(alias="siteId")],
) -> list[Folder]:
    return list(
        (
            await session.scalars(
                select(Folder)
                .where(Folder.site_id == site_id)
                .order_by(Folder.sort_order, Folder.name)
            )
        ).all()
    )


@router.post("/folders", response_model=FolderOut, status_code=status.HTTP_201_CREATED)
async def create_folder(
    payload: FolderCreate,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Folder:
    if payload.parent_id:
        parent = await session.get(Folder, payload.parent_id)
        if parent is None or parent.site_id != payload.site_id:
            raise AppError(422, "invalid_parent", "Родительская папка не относится к этому сайту")
        depth = 1
        while parent.parent_id:
            depth += 1
            parent = await session.get(Folder, parent.parent_id)
            if parent is None:
                break
        if depth >= 3:
            raise AppError(422, "folder_depth", "Допускается не более трёх уровней папок")
    folder = Folder(**payload.model_dump())
    session.add(folder)
    await session.flush()
    add_audit(
        session,
        request,
        actor=actor,
        action="folder.created",
        resource_type="folder",
        resource_id=folder.id,
    )
    return folder


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: UUID,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> None:
    folder = await session.get(Folder, folder_id)
    if folder is None:
        raise not_found("Folder")
    page_count = int(
        await session.scalar(
            select(func.count(Page.id)).where(
                Page.folder_id == folder.id, Page.deleted_at.is_(None)
            )
        )
        or 0
    )
    child_count = int(
        await session.scalar(select(func.count(Folder.id)).where(Folder.parent_id == folder.id))
        or 0
    )
    if page_count or child_count:
        raise AppError(409, "folder_not_empty", "Сначала переместите вложенные страницы и папки")
    await session.delete(folder)
    add_audit(
        session,
        request,
        actor=actor,
        action="folder.deleted",
        resource_type="folder",
        resource_id=folder.id,
    )


@router.get("/templates", response_model=list[TemplateOut])
async def list_templates(
    session: SessionDep,
    _actor: ViewerUser,
    site_id: Annotated[UUID | None, Query(alias="siteId")] = None,
) -> list[Template]:
    statement = select(Template).where(Template.is_active.is_(True))
    if site_id:
        statement = statement.where((Template.site_id == site_id) | (Template.site_id.is_(None)))
    return list((await session.scalars(statement.order_by(Template.name))).all())


@router.post("/templates", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(
    payload: TemplateCreate,
    request: Request,
    session: SessionDep,
    actor: EditorUser,
) -> Template:
    document = payload.document
    issues = registry.validate(document, actor_role=actor.role)
    if issues:
        raise AppError(
            422,
            "document_validation_failed",
            "Документ шаблона не прошёл проверку",
            details=[issue.model_dump(mode="json") for issue in issues],
        )
    template = Template(
        site_id=payload.site_id,
        slug=payload.slug,
        name=payload.name,
        version=payload.version,
        document=document.model_dump(mode="json", by_alias=True),
        created_by=actor.id,
    )
    session.add(template)
    await session.flush()
    add_audit(
        session,
        request,
        actor=actor,
        action="template.created",
        resource_type="template",
        resource_id=template.id,
    )
    return template


@router.get("/templates/{template_id}", response_model=TemplateOut)
async def get_template(
    template_id: UUID,
    session: SessionDep,
    _actor: ViewerUser,
) -> Template:
    template = await session.scalar(
        select(Template).where(Template.id == template_id, Template.is_active.is_(True))
    )
    if template is None:
        raise not_found("Template")
    return template


@router.patch("/templates/{template_id}", response_model=TemplateOut)
async def patch_template(
    template_id: UUID,
    payload: TemplatePatch,
    request: Request,
    session: SessionDep,
    actor: EditorUser,
) -> Template:
    template = await session.get(Template, template_id)
    if template is None:
        raise not_found("Template")
    if payload.document is not None:
        issues = registry.validate(payload.document, actor_role=actor.role)
        if issues:
            raise AppError(
                422,
                "document_validation_failed",
                "Документ шаблона не прошёл проверку",
                details=[issue.model_dump(mode="json") for issue in issues],
            )
        template.document = payload.document.model_dump(mode="json", by_alias=True)
    if payload.name is not None:
        template.name = payload.name.strip()
    if payload.is_active is not None:
        template.is_active = payload.is_active
    add_audit(
        session,
        request,
        actor=actor,
        action="template.updated",
        resource_type="template",
        resource_id=template.id,
        details={"fields": list(payload.model_dump(exclude_unset=True))},
    )
    return template


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_template(
    template_id: UUID,
    request: Request,
    session: SessionDep,
    actor: EditorUser,
) -> None:
    template = await session.get(Template, template_id)
    if template is None:
        raise not_found("Template")
    template.is_active = False
    add_audit(
        session,
        request,
        actor=actor,
        action="template.deactivated",
        resource_type="template",
        resource_id=template.id,
    )


@router.get("/templates/{template_id}/preview")
async def preview_template(
    template_id: UUID,
    session: SessionDep,
    _actor: ViewerUser,
) -> JSONResponse:
    template = await session.get(Template, template_id)
    if template is None:
        raise not_found("Template")
    return JSONResponse(
        {"templateId": str(template.id), "document": template.document},
        headers={
            "Cache-Control": "private, no-store",
            "X-Robots-Tag": "noindex, nofollow",
        },
    )


@router.post("/pages/from-template", response_model=PageOut)
async def page_from_template(
    payload: PageFromTemplate,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Page:
    template = await session.scalar(
        select(Template).where(
            Template.id == payload.template_id,
            Template.is_active.is_(True),
        )
    )
    if template is None or template.site_id not in {None, payload.site_id}:
        raise not_found("Template")
    page, _route = await create_page(
        session,
        PageCreate(
            site_id=payload.site_id,
            folder_id=payload.folder_id,
            title=payload.title,
            slug=payload.slug,
            route_path=payload.route_path,
            content_type=payload.content_type,
            section_key=payload.section_key,
            listing_meta=payload.listing_meta,
            document=parse_document(template.document),
        ),
        actor,
        settings=request.app.state.settings,
    )
    add_audit(
        session,
        request,
        actor=actor,
        action="page.created_from_template",
        resource_type="page",
        resource_id=page.id,
        details={"templateId": str(template.id)},
    )
    return page


@router.get("/presets", response_model=list[PresetOut])
async def list_presets(
    session: SessionDep,
    _actor: ViewerUser,
    site_id: Annotated[UUID, Query(alias="siteId")],
) -> list[Preset]:
    return list(
        (
            await session.scalars(
                select(Preset)
                .where(Preset.site_id == site_id, Preset.is_active.is_(True))
                .order_by(Preset.name)
            )
        ).all()
    )


@router.post("/presets", response_model=PresetOut, status_code=status.HTTP_201_CREATED)
async def create_preset(
    payload: PresetCreate,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Preset:
    definition = registry.get(payload.block_type)
    if definition is None:
        raise AppError(422, "unknown_block", "Тип блока пресета не зарегистрирован")
    if definition.admin_only and actor.role != "Admin":
        raise AppError(403, "forbidden", "Для этого типа блока требуются права администратора")
    _validate_preset_data(payload.block_type, payload.data)
    preset = Preset(
        site_id=payload.site_id,
        block_type=payload.block_type,
        name=payload.name,
        data=payload.data,
        created_by=actor.id,
    )
    session.add(preset)
    await session.flush()
    add_audit(
        session,
        request,
        actor=actor,
        action="preset.created",
        resource_type="preset",
        resource_id=preset.id,
    )
    return preset


@router.patch("/presets/{preset_id}", response_model=PresetOut)
async def patch_preset(
    preset_id: UUID,
    payload: PresetPatch,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Preset:
    preset = await session.get(Preset, preset_id)
    if preset is None:
        raise not_found("Preset")
    if payload.data is not None:
        _validate_preset_data(preset.block_type, payload.data)
        preset.data = payload.data
    if payload.name is not None:
        preset.name = payload.name.strip()
    if payload.is_active is not None:
        preset.is_active = payload.is_active
    add_audit(
        session,
        request,
        actor=actor,
        action="preset.updated",
        resource_type="preset",
        resource_id=preset.id,
        details={"fields": list(payload.model_dump(exclude_unset=True))},
    )
    return preset


@router.delete("/presets/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_preset(
    preset_id: UUID,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> None:
    preset = await session.get(Preset, preset_id)
    if preset is None:
        raise not_found("Preset")
    preset.is_active = False
    add_audit(
        session,
        request,
        actor=actor,
        action="preset.deactivated",
        resource_type="preset",
        resource_id=preset.id,
    )


@router.get("/presets/{preset_id}/preview")
async def preview_preset(
    preset_id: UUID,
    session: SessionDep,
    _actor: ViewerUser,
) -> JSONResponse:
    preset = await session.get(Preset, preset_id)
    if preset is None:
        raise not_found("Preset")
    definition = registry.get(preset.block_type)
    if definition is None:
        raise AppError(422, "unknown_block", "Тип блока пресета не зарегистрирован")
    return JSONResponse(
        {
            "presetId": str(preset.id),
            "block": {
                "id": f"preset-{preset.id}",
                "type": preset.block_type,
                "version": definition.current_version,
                "props": preset.data,
            },
        },
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/forms", response_model=list[FormOut])
async def list_forms(
    session: SessionDep,
    _actor: ViewerUser,
    site_id: Annotated[UUID | None, Query(alias="siteId")] = None,
) -> list[Form]:
    statement = select(Form)
    if site_id:
        statement = statement.where(Form.site_id == site_id)
    return list((await session.scalars(statement.order_by(Form.name))).all())


@router.post("/forms", response_model=FormOut, status_code=status.HTTP_201_CREATED)
async def create_form(
    payload: FormCreate,
    request: Request,
    session: SessionDep,
    actor: EditorUser,
) -> Form:
    fields = payload.form_schema.get("fields")
    if not isinstance(fields, list) or not fields:
        raise AppError(422, "invalid_form_schema", "Схема формы должна содержать хотя бы одно поле")
    await _validate_form_settings(request, payload.settings)
    form = Form(
        site_id=payload.site_id,
        slug=payload.slug,
        name=payload.name,
        schema=payload.form_schema,
        settings=payload.settings,
    )
    session.add(form)
    await session.flush()
    add_audit(
        session,
        request,
        actor=actor,
        action="form.created",
        resource_type="form",
        resource_id=form.id,
    )
    return form


@router.patch("/forms/{form_id}", response_model=FormOut)
async def patch_form(
    form_id: UUID,
    payload: FormPatch,
    request: Request,
    session: SessionDep,
    actor: EditorUser,
) -> Form:
    form = await session.get(Form, form_id)
    if form is None:
        raise not_found("Form")
    if payload.form_schema is not None:
        fields = payload.form_schema.get("fields")
        if not isinstance(fields, list) or not fields:
            raise AppError(
                422,
                "invalid_form_schema",
                "Схема формы должна содержать хотя бы одно поле",
            )
        form.schema = payload.form_schema
    if payload.settings is not None:
        await _validate_form_settings(request, payload.settings)
        form.settings = payload.settings
    if payload.name is not None:
        form.name = payload.name.strip()
    if payload.is_active is not None:
        form.is_active = payload.is_active
    add_audit(
        session,
        request,
        actor=actor,
        action="form.updated",
        resource_type="form",
        resource_id=form.id,
        details={"fields": list(payload.model_dump(exclude_unset=True))},
    )
    return form


@router.delete("/forms/{form_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_form(
    form_id: UUID,
    request: Request,
    session: SessionDep,
    actor: EditorUser,
) -> None:
    form = await session.get(Form, form_id)
    if form is None:
        raise not_found("Form")
    form.is_active = False
    add_audit(
        session,
        request,
        actor=actor,
        action="form.deactivated",
        resource_type="form",
        resource_id=form.id,
    )


async def _submission_query(
    session: SessionDep,
    form_id: UUID | None,
    limit: int | None = None,
) -> list[Submission]:
    statement = select(Submission).order_by(Submission.created_at.desc())
    if form_id:
        statement = statement.where(Submission.form_id == form_id)
    if limit:
        statement = statement.limit(limit)
    return list((await session.scalars(statement)).all())


@router.get("/forms/submissions/export")
async def export_submissions(
    session: SessionDep,
    _actor: EditorUser,
    form_id: Annotated[UUID | None, Query(alias="formId")] = None,
) -> StreamingResponse:
    submissions = await _submission_query(session, form_id)
    field_names = sorted(
        {field for submission in submissions for field in submission.data if isinstance(field, str)}
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id", "formId", "createdAt", "status", *field_names])
    for submission in submissions:
        writer.writerow(
            [
                submission.id,
                submission.form_id,
                submission.created_at.isoformat(),
                submission.status,
                *[
                    json.dumps(submission.data.get(field, ""), ensure_ascii=False)
                    for field in field_names
                ],
            ]
        )
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="submissions.csv"'},
    )


@router.get("/forms/submissions")
async def list_submissions(
    session: SessionDep,
    _actor: EditorUser,
    form_id: Annotated[UUID | None, Query(alias="formId")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 50,
) -> dict[str, object]:
    filters = [Submission.form_id == form_id] if form_id else []
    total = int(await session.scalar(select(func.count(Submission.id)).where(*filters)) or 0)
    submissions = list(
        (
            await session.scalars(
                select(Submission)
                .where(*filters)
                .order_by(Submission.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    )
    return {
        "items": [SubmissionOut.model_validate(item) for item in submissions],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.get("/redirects", response_model=list[RedirectOut])
async def list_redirects(
    session: SessionDep,
    _actor: ViewerUser,
    site_id: Annotated[UUID | None, Query(alias="siteId")] = None,
) -> list[Redirect]:
    statement = select(Redirect)
    if site_id:
        statement = statement.where(Redirect.site_id == site_id)
    return list((await session.scalars(statement.order_by(Redirect.source_path))).all())


@router.post("/redirects", response_model=RedirectOut, status_code=status.HTTP_201_CREATED)
async def create_redirect(
    payload: RedirectCreate,
    request: Request,
    session: SessionDep,
    actor: PublisherUser,
) -> Redirect:
    source_path = normalize_path(payload.source_path)
    destination = (
        normalize_path(payload.destination)
        if payload.destination.startswith("/")
        else payload.destination
    )
    if source_path == destination:
        raise AppError(
            422,
            "redirect_loop",
            "Исходный и целевой адреса перенаправления должны различаться",
        )
    redirect = Redirect(
        site_id=payload.site_id,
        source_path=source_path,
        destination=destination,
        status_code=payload.status_code,
    )
    session.add(redirect)
    await session.flush()
    add_audit(
        session,
        request,
        actor=actor,
        action="redirect.created",
        resource_type="redirect",
        resource_id=redirect.id,
    )
    await request.app.state.cache.delete_prefix(f"public:{payload.site_id}:")
    await request.app.state.cache.delete_prefix("resolver:")
    return redirect


@router.delete("/redirects/{redirect_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_redirect(
    redirect_id: UUID,
    request: Request,
    session: SessionDep,
    actor: PublisherUser,
) -> None:
    redirect = await session.get(Redirect, redirect_id)
    if redirect is None:
        raise not_found("Redirect")
    redirect.is_active = False
    add_audit(
        session,
        request,
        actor=actor,
        action="redirect.disabled",
        resource_type="redirect",
        resource_id=redirect.id,
    )
    await request.app.state.cache.delete_prefix(f"public:{redirect.site_id}:")
    await request.app.state.cache.delete_prefix("resolver:")


@router.get("/builder/registry")
async def block_registry(_actor: ViewerUser) -> dict[str, object]:
    return registry.manifest()


@router.get("/audit")
async def audit_log(
    session: SessionDep,
    _actor: AdminUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 50,
) -> dict[str, object]:
    total = int(await session.scalar(select(func.count(AuditLog.id))) or 0)
    entries = list(
        (
            await session.scalars(
                select(AuditLog)
                .order_by(AuditLog.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    )
    return {
        "items": [
            {
                "id": entry.id,
                "actorId": entry.actor_id,
                "action": entry.action,
                "resourceType": entry.resource_type,
                "resourceId": entry.resource_id,
                "details": entry.details,
                "createdAt": entry.created_at,
            }
            for entry in entries
        ],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.get("/settings", response_model=list[SettingOut])
async def list_settings(
    session: SessionDep,
    _actor: AdminUser,
    site_id: Annotated[UUID | None, Query(alias="siteId")] = None,
) -> list[SettingOut]:
    statement = select(Setting)
    if site_id:
        statement = statement.where(Setting.site_id == site_id)
    entries = list((await session.scalars(statement.order_by(Setting.key))).all())
    return [
        SettingOut(
            id=entry.id,
            site_id=entry.site_id,
            key=entry.key,
            value={"redacted": True} if entry.is_secret else entry.value,
            is_secret=entry.is_secret,
            created_at=entry.created_at,
            updated_at=entry.updated_at,
        )
        for entry in entries
    ]


@router.put("/settings", response_model=SettingOut)
async def upsert_setting(
    payload: SettingUpsert,
    request: Request,
    session: SessionDep,
    actor: AdminUser,
) -> SettingOut:
    entry = await session.scalar(
        select(Setting).where(
            Setting.site_id == payload.site_id,
            Setting.key == payload.key,
        )
    )
    if entry is None:
        entry = Setting(
            site_id=payload.site_id,
            key=payload.key,
            value=payload.value,
            is_secret=payload.is_secret,
            updated_by=actor.id,
        )
        session.add(entry)
    else:
        entry.value = payload.value
        entry.is_secret = payload.is_secret
        entry.updated_by = actor.id
    await session.flush()
    add_audit(
        session,
        request,
        actor=actor,
        action="setting.updated",
        resource_type="setting",
        resource_id=entry.id,
        details={"key": entry.key, "isSecret": entry.is_secret},
    )
    return SettingOut(
        id=entry.id,
        site_id=entry.site_id,
        key=entry.key,
        value={"redacted": True} if entry.is_secret else entry.value,
        is_secret=entry.is_secret,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )
