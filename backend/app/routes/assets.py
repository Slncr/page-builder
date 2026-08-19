from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, Query, Request, UploadFile, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select

from app.audit import add_audit
from app.dependencies import CopywriterUser, SessionDep, ViewerUser
from app.errors import AppError, not_found
from app.idempotency import claim_idempotency, complete_idempotency, request_fingerprint
from app.media import normalize_uploaded_image
from app.metrics import UPLOAD_OPERATIONS
from app.models import Asset, AssetProcessingJob, JobStatus, Rendition, Site
from app.schemas import AssetMetadataCreate, AssetOut, AssetPatch, RenditionOut

router = APIRouter(tags=["assets"])

ALLOWED_TYPES = {
    ".avif": {"image/avif"},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    ".gif": {"image/gif"},
    ".jpeg": {"image/jpeg"},
    ".jpg": {"image/jpeg"},
    ".mp4": {"video/mp4"},
    ".pdf": {"application/pdf"},
    ".png": {"image/png"},
    ".webp": {"image/webp"},
    ".xlsx": {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
}


def _require_media(request: Request) -> None:
    if not request.app.state.settings.media_enabled:
        raise AppError(503, "media_disabled", "Операции с медиатекой отключены")


def _validate_upload(filename: str, content_type: str, data: bytes) -> str:
    extension = Path(filename).suffix.lower()
    allowed = ALLOWED_TYPES.get(extension)
    if allowed is None or content_type not in allowed:
        raise AppError(415, "unsupported_media_type", "Этот тип файла не разрешён")
    signatures = {
        ".gif": (b"GIF87a", b"GIF89a"),
        ".jpeg": (b"\xff\xd8\xff",),
        ".jpg": (b"\xff\xd8\xff",),
        ".pdf": (b"%PDF-",),
        ".png": (b"\x89PNG\r\n\x1a\n",),
        ".webp": (b"RIFF",),
    }
    expected = signatures.get(extension)
    if expected and not any(data.startswith(signature) for signature in expected):
        raise AppError(415, "mime_mismatch", "Содержимое файла не соответствует его расширению")
    if extension == ".webp" and data[8:12] != b"WEBP":
        raise AppError(415, "mime_mismatch", "Содержимое файла не соответствует его расширению")
    if extension in {".docx", ".xlsx"} and not data.startswith(b"PK"):
        raise AppError(
            415, "mime_mismatch", "Офисный документ должен быть корректным ZIP-контейнером"
        )
    if extension in {".avif", ".mp4"} and b"ftyp" not in data[:32]:
        raise AppError(
            415, "mime_mismatch", "Содержимое медиафайла не соответствует его расширению"
        )
    return extension


@router.post("/assets", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
@router.post("/assets/upload", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
async def upload_asset(
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
    site_id: Annotated[UUID, Form(alias="siteId")],
    file: Annotated[UploadFile, File()],
    alt_text: Annotated[str | None, Form(alias="altText")] = None,
    folder_path: Annotated[str | None, Form(alias="folderPath", max_length=500)] = None,
    tags: Annotated[str | None, Form(max_length=2000)] = None,
) -> Asset | JSONResponse:
    _require_media(request)
    site = await session.get(Site, site_id)
    if site is None or not site.is_active:
        raise not_found("Site")
    data = await file.read(request.app.state.settings.max_upload_bytes + 1)
    if not data:
        raise AppError(422, "empty_file", "Загруженный файл пуст")
    if len(data) > request.app.state.settings.max_upload_bytes:
        raise AppError(413, "file_too_large", "Загруженный файл превышает допустимый размер")
    filename = Path(file.filename or "upload").name
    content_type = (file.content_type or "application/octet-stream").lower()
    extension = _validate_upload(filename, content_type, data)
    image_info = None
    if content_type.startswith("image/"):
        settings = request.app.state.settings
        image_info = await asyncio.to_thread(
            normalize_uploaded_image,
            data,
            settings.image_quality,
            settings.image_max_bytes,
            settings.image_max_dimension,
        )
        data = image_info.data
        content_type = image_info.content_type
        extension = image_info.extension
        filename = f"{Path(filename).stem}.webp"
    now = datetime.now(UTC)
    object_key = f"{site_id}/{now:%Y/%m}/{uuid4().hex}{extension}"
    checksum = hashlib.sha256(data).hexdigest()
    fingerprint = request_fingerprint(
        {
            "siteId": site_id,
            "filename": filename,
            "contentType": content_type,
            "altText": alt_text,
            "folderPath": folder_path,
            "tags": tags,
            "checksum": checksum,
        }
    )
    record, replay = await claim_idempotency(
        session,
        request,
        actor.id,
        "asset.upload",
        fingerprint,
        request.app.state.settings,
    )
    if replay is not None:
        return replay
    await request.app.state.storage.put(object_key, data, content_type)
    asset = Asset(
        site_id=site_id,
        filename=filename,
        object_key=object_key,
        content_type=content_type,
        byte_size=len(data),
        checksum=checksum,
        width=image_info.width if image_info else None,
        height=image_info.height if image_info else None,
        alt_text=alt_text,
        folder_path=folder_path.strip() if folder_path else None,
        tags=sorted({tag.strip() for tag in (tags or "").split(",") if tag.strip()})[:50],
        status="processing" if image_info else "ready",
        metadata_json=image_info.metadata if image_info else {},
        created_by=actor.id,
    )
    session.add(asset)
    await session.flush()
    if image_info:
        session.add(AssetProcessingJob(asset_id=asset.id))
    add_audit(
        session,
        request,
        actor=actor,
        action="asset.uploaded",
        resource_type="asset",
        resource_id=asset.id,
        details={"contentType": content_type, "byteSize": len(data)},
    )
    complete_idempotency(
        record,
        jsonable_encoder(AssetOut.model_validate(asset), by_alias=True),
        status.HTTP_201_CREATED,
    )
    UPLOAD_OPERATIONS.labels("upload", "success").inc()
    return asset


@router.post(
    "/assets/metadata",
    response_model=AssetOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_asset_metadata(
    payload: AssetMetadataCreate,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Asset:
    _require_media(request)
    if not await request.app.state.storage.exists(payload.object_key):
        raise AppError(422, "object_missing", "Загруженный объект в хранилище не существует")
    asset = Asset(
        site_id=payload.site_id,
        filename=payload.filename,
        object_key=payload.object_key,
        content_type=payload.content_type,
        byte_size=payload.byte_size,
        checksum=payload.checksum,
        alt_text=payload.alt_text,
        folder_path=payload.folder_path,
        tags=sorted({tag.strip() for tag in payload.tags if tag.strip()}),
        metadata_json=payload.metadata,
        created_by=actor.id,
    )
    session.add(asset)
    await session.flush()
    if payload.content_type.startswith("image/"):
        asset.status = "processing"
        session.add(AssetProcessingJob(asset_id=asset.id))
    add_audit(
        session,
        request,
        actor=actor,
        action="asset.metadata_created",
        resource_type="asset",
        resource_id=asset.id,
    )
    return asset


@router.get("/assets")
async def list_assets(
    request: Request,
    session: SessionDep,
    _actor: ViewerUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 40,
    site_id: Annotated[UUID | None, Query(alias="siteId")] = None,
    content_type: Annotated[str | None, Query(alias="contentType")] = None,
    folder_path: Annotated[str | None, Query(alias="folderPath", max_length=500)] = None,
    query: Annotated[str | None, Query(alias="q", max_length=200)] = None,
) -> dict[str, object]:
    _require_media(request)
    filters = [Asset.deleted_at.is_(None)]
    if site_id:
        filters.append(Asset.site_id == site_id)
    if content_type:
        filters.append(Asset.content_type.startswith(content_type))
    if folder_path:
        filters.append(Asset.folder_path == folder_path)
    if query:
        filters.append(Asset.filename.ilike(f"%{query.strip()}%"))
    total = int(await session.scalar(select(func.count(Asset.id)).where(*filters)) or 0)
    assets = list(
        (
            await session.scalars(
                select(Asset)
                .where(*filters)
                .order_by(Asset.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    )
    return {
        "items": [AssetOut.model_validate(asset) for asset in assets],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.get("/assets/{asset_id}", response_model=AssetOut)
async def get_asset(
    asset_id: UUID,
    request: Request,
    session: SessionDep,
    _actor: ViewerUser,
) -> Asset:
    _require_media(request)
    asset = await session.scalar(
        select(Asset).where(Asset.id == asset_id, Asset.deleted_at.is_(None))
    )
    if asset is None:
        raise not_found("Asset")
    return asset


@router.get("/assets/{asset_id}/renditions", response_model=list[RenditionOut])
async def list_asset_renditions(
    asset_id: UUID,
    request: Request,
    session: SessionDep,
    _actor: ViewerUser,
) -> list[Rendition]:
    _require_media(request)
    asset = await session.scalar(
        select(Asset.id).where(Asset.id == asset_id, Asset.deleted_at.is_(None))
    )
    if asset is None:
        raise not_found("Asset")
    return list(
        (
            await session.scalars(
                select(Rendition)
                .where(Rendition.asset_id == asset_id)
                .order_by(Rendition.width, Rendition.format)
            )
        ).all()
    )


@router.post("/assets/{asset_id}/renditions", status_code=status.HTTP_202_ACCEPTED)
async def queue_asset_renditions(
    asset_id: UUID,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> dict[str, str]:
    _require_media(request)
    asset = await session.scalar(
        select(Asset).where(Asset.id == asset_id, Asset.deleted_at.is_(None))
    )
    if asset is None:
        raise not_found("Asset")
    if not asset.content_type.startswith("image/"):
        raise AppError(
            422, "not_an_image", "Варианты размеров можно создавать только для изображений"
        )
    job = await session.scalar(
        select(AssetProcessingJob).where(AssetProcessingJob.asset_id == asset.id)
    )
    if job is None:
        job = AssetProcessingJob(asset_id=asset.id)
        session.add(job)
    else:
        job.status = JobStatus.PENDING.value
        job.run_at = datetime.now(UTC)
        job.error = None
    asset.status = "processing"
    add_audit(
        session,
        request,
        actor=actor,
        action="asset.renditions_queued",
        resource_type="asset",
        resource_id=asset.id,
    )
    await session.flush()
    return {"status": "queued", "jobId": str(job.id)}


@router.patch("/assets/{asset_id}", response_model=AssetOut)
async def patch_asset(
    asset_id: UUID,
    payload: AssetPatch,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> Asset:
    _require_media(request)
    asset = await session.scalar(
        select(Asset).where(Asset.id == asset_id, Asset.deleted_at.is_(None))
    )
    if asset is None:
        raise not_found("Asset")
    changes = payload.model_dump(exclude_unset=True)
    if "alt_text" in changes:
        asset.alt_text = changes["alt_text"]
    if changes.get("metadata") is not None:
        asset.metadata_json = changes["metadata"]
    if "folder_path" in changes:
        asset.folder_path = changes["folder_path"]
    if changes.get("tags") is not None:
        asset.tags = sorted({tag.strip() for tag in changes["tags"] if tag.strip()})
    add_audit(
        session,
        request,
        actor=actor,
        action="asset.updated",
        resource_type="asset",
        resource_id=asset.id,
        details={"fields": list(changes)},
    )
    return asset


@router.put("/assets/{asset_id}/content", response_model=AssetOut)
async def replace_asset_content(
    asset_id: UUID,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
    file: Annotated[UploadFile, File()],
) -> Asset | JSONResponse:
    _require_media(request)
    asset = await session.scalar(
        select(Asset).where(Asset.id == asset_id, Asset.deleted_at.is_(None)).with_for_update()
    )
    if asset is None:
        raise not_found("Asset")
    data = await file.read(request.app.state.settings.max_upload_bytes + 1)
    if not data or len(data) > request.app.state.settings.max_upload_bytes:
        raise AppError(413, "file_too_large", "Новый файл пуст или превышает допустимый размер")
    filename = Path(file.filename or asset.filename).name
    content_type = (file.content_type or "application/octet-stream").lower()
    extension = _validate_upload(filename, content_type, data)
    image_info = None
    if content_type.startswith("image/"):
        settings = request.app.state.settings
        image_info = await asyncio.to_thread(
            normalize_uploaded_image,
            data,
            settings.image_quality,
            settings.image_max_bytes,
            settings.image_max_dimension,
        )
        data = image_info.data
        content_type = image_info.content_type
        extension = image_info.extension
        filename = f"{Path(filename).stem}.webp"
    checksum = hashlib.sha256(data).hexdigest()
    fingerprint = request_fingerprint(
        {"assetId": asset.id, "checksum": checksum, "contentType": content_type}
    )
    record, replay = await claim_idempotency(
        session,
        request,
        actor.id,
        f"asset.replace:{asset.id}",
        fingerprint,
        request.app.state.settings,
    )
    if replay is not None:
        return replay
    object_key = f"{asset.site_id}/{datetime.now(UTC):%Y/%m}/{uuid4().hex}{extension}"
    await request.app.state.storage.put(object_key, data, content_type)
    old_object_key = asset.object_key
    renditions = list(
        (await session.scalars(select(Rendition).where(Rendition.asset_id == asset.id))).all()
    )
    asset.filename = filename
    asset.object_key = object_key
    asset.content_type = content_type
    asset.byte_size = len(data)
    asset.checksum = checksum
    asset.width = image_info.width if image_info else None
    asset.height = image_info.height if image_info else None
    asset.metadata_json = image_info.metadata if image_info else {}
    asset.status = "processing" if image_info else "ready"
    await session.execute(delete(Rendition).where(Rendition.asset_id == asset.id))
    job = await session.scalar(
        select(AssetProcessingJob).where(AssetProcessingJob.asset_id == asset.id)
    )
    if image_info:
        if job is None:
            session.add(AssetProcessingJob(asset_id=asset.id))
        else:
            job.status = JobStatus.PENDING.value
            job.run_at = datetime.now(UTC)
            job.error = None
    elif job is not None:
        job.status = JobStatus.CANCELLED.value
    await session.flush()
    await request.app.state.storage.delete(old_object_key)
    for rendition in renditions:
        await request.app.state.storage.delete(rendition.object_key)
    add_audit(
        session,
        request,
        actor=actor,
        action="asset.replaced",
        resource_type="asset",
        resource_id=asset.id,
        details={"checksum": checksum, "contentType": content_type},
    )
    complete_idempotency(
        record,
        jsonable_encoder(AssetOut.model_validate(asset), by_alias=True),
        status.HTTP_200_OK,
    )
    UPLOAD_OPERATIONS.labels("replace", "success").inc()
    return asset


@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: UUID,
    request: Request,
    session: SessionDep,
    actor: CopywriterUser,
) -> None:
    _require_media(request)
    asset = await session.scalar(
        select(Asset).where(Asset.id == asset_id, Asset.deleted_at.is_(None))
    )
    if asset is None:
        raise not_found("Asset")
    asset.deleted_at = datetime.now(UTC)
    add_audit(
        session,
        request,
        actor=actor,
        action="asset.trashed",
        resource_type="asset",
        resource_id=asset.id,
    )
