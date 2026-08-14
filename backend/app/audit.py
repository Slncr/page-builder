from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User

SENSITIVE_KEYS = {"password", "password_hash", "token", "access_token", "refresh_token"}


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if key.lower() in SENSITIVE_KEYS else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def add_audit(
    session: AsyncSession,
    request: Request,
    *,
    actor: User | None,
    action: str,
    resource_type: str,
    resource_id: UUID | str | None,
    details: dict[str, Any] | None = None,
) -> AuditLog:
    record = AuditLog(
        actor_id=actor.id if actor else None,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        details=redact(details or {}),
        ip_address=client_ip(request),
        user_agent=request.headers.get("User-Agent", "")[:512] or None,
    )
    session.add(record)
    return record
