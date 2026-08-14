from __future__ import annotations

import hashlib
import json
import re
from datetime import timedelta
from typing import Any
from uuid import UUID

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import utcnow
from app.errors import AppError
from app.models import IdempotencyRecord

KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,200}$")


def request_fingerprint(value: Any) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


async def claim_idempotency(
    session: AsyncSession,
    request: Request,
    actor_id: UUID,
    operation: str,
    request_hash: str,
    settings: Settings,
) -> tuple[IdempotencyRecord | None, JSONResponse | None]:
    key = request.headers.get("Idempotency-Key")
    if key is None:
        return None, None
    if not KEY_PATTERN.fullmatch(key):
        raise AppError(
            422,
            "invalid_idempotency_key",
            "Idempotency-Key должен содержать от 8 до 200 безопасных для URL символов",
        )
    record = IdempotencyRecord(
        actor_id=actor_id,
        operation=operation,
        key=key,
        request_hash=request_hash,
        expires_at=utcnow() + timedelta(hours=settings.idempotency_ttl_hours),
    )
    try:
        async with session.begin_nested():
            session.add(record)
            await session.flush()
        return record, None
    except IntegrityError:
        existing = await session.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.actor_id == actor_id,
                IdempotencyRecord.operation == operation,
                IdempotencyRecord.key == key,
            )
        )
        if existing is None:
            raise AppError(
                409,
                "idempotency_conflict",
                "Возник конфликт идемпотентного запроса",
            ) from None
        if existing.request_hash != request_hash:
            raise AppError(
                409,
                "idempotency_key_reused",
                "Этот Idempotency-Key уже использован для другого запроса",
            ) from None
        if existing.status != "completed" or existing.response_json is None:
            raise AppError(
                409,
                "idempotency_in_progress",
                "Операция с этим Idempotency-Key ещё выполняется",
                headers={"Retry-After": "2"},
            ) from None
        return (
            None,
            JSONResponse(
                content=existing.response_json,
                status_code=existing.status_code or 200,
                headers={"Idempotent-Replayed": "true"},
            ),
        )


def complete_idempotency(
    record: IdempotencyRecord | None,
    response_json: dict[str, Any],
    status_code: int,
) -> None:
    if record is None:
        return
    record.status = "completed"
    record.response_json = response_json
    record.status_code = status_code
