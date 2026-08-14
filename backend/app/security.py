from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Response

from app.config import Settings
from app.errors import AppError
from app.models import User

password_hasher = PasswordHasher(time_cost=3, memory_cost=65_536, parallelism=4)
DUMMY_PASSWORD_HASH = password_hasher.hash("not-a-real-password")


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    refresh_jti: str
    csrf_token: str
    refresh_expires_at: datetime


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, encoded: str) -> tuple[bool, str | None]:
    try:
        valid = password_hasher.verify(encoded, password)
    except (VerifyMismatchError, InvalidHashError):
        return False, None
    replacement = (
        password_hasher.hash(password) if password_hasher.check_needs_rehash(encoded) else None
    )
    return valid, replacement


def hash_identifier(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_sensitive(value: str, settings: Settings) -> str:
    return hmac.new(
        settings.jwt_secret.get_secret_value().encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _encode_token(
    user: User,
    settings: Settings,
    token_type: Literal["access", "refresh"],
    expires_at: datetime,
    jti: str,
    csrf_token: str,
) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": str(user.id),
        "role": user.role,
        "ver": user.token_version,
        "typ": token_type,
        "jti": jti,
        "csrf": hash_identifier(csrf_token),
        "iss": settings.jwt_issuer,
        "iat": now,
        "nbf": now,
        "exp": expires_at,
    }
    return jwt.encode(
        claims,
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )


def create_token_pair(user: User, settings: Settings) -> TokenPair:
    now = datetime.now(UTC)
    csrf_token = secrets.token_urlsafe(32)
    refresh_jti = str(uuid4())
    access_token = _encode_token(
        user,
        settings,
        "access",
        now + timedelta(minutes=settings.access_token_minutes),
        str(uuid4()),
        csrf_token,
    )
    refresh_expires_at = now + timedelta(days=settings.refresh_token_days)
    refresh_token = _encode_token(
        user,
        settings,
        "refresh",
        refresh_expires_at,
        refresh_jti,
        csrf_token,
    )
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        refresh_jti=refresh_jti,
        csrf_token=csrf_token,
        refresh_expires_at=refresh_expires_at,
    )


def create_preview_token(
    user: User,
    page_id: UUID,
    draft_version: int,
    settings: Settings,
    *,
    revision_id: UUID | None = None,
) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.preview_token_minutes)
    claims = {
        "sub": str(user.id),
        "typ": "preview",
        "page": str(page_id),
        "draftVersion": draft_version,
        "revision": str(revision_id) if revision_id else None,
        "iss": settings.jwt_issuer,
        "iat": now,
        "nbf": now,
        "exp": expires_at,
        "jti": str(uuid4()),
    }
    token = jwt.encode(
        claims,
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )
    return token, expires_at


def decode_preview_token(
    token: str,
    page_id: UUID,
    settings: Settings,
    *,
    revision_id: UUID | None = None,
) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "typ", "page", "iat", "exp", "jti"]},
        )
    except jwt.PyJWTError as exc:
        raise AppError(
            401,
            "invalid_preview_token",
            "Токен предпросмотра недействителен или просрочен",
        ) from exc
    if payload.get("typ") != "preview" or payload.get("page") != str(page_id):
        raise AppError(
            401,
            "invalid_preview_token",
            "Токен предпросмотра недействителен или просрочен",
        )
    expected_revision = str(revision_id) if revision_id else None
    if payload.get("revision") != expected_revision:
        raise AppError(
            401, "invalid_preview_token", "Токен предпросмотра предназначен для другого ресурса"
        )
    return payload


def decode_token(
    token: str,
    settings: Settings,
    expected_type: Literal["access", "refresh"],
) -> dict[str, Any]:
    auth_error = AppError(
        401,
        "invalid_token",
        "Токен аутентификации недействителен или просрочен",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "typ", "jti", "iat", "exp", "ver"]},
        )
    except jwt.PyJWTError as exc:
        raise auth_error from exc
    if payload.get("typ") != expected_type:
        raise auth_error
    try:
        UUID(payload["sub"])
    except (ValueError, TypeError, KeyError) as exc:
        raise auth_error from exc
    return payload


def set_auth_cookies(response: Response, pair: TokenPair, settings: Settings) -> None:
    common = {
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "domain": settings.cookie_domain,
        "path": "/",
    }
    response.set_cookie(
        "access_token",
        pair.access_token,
        httponly=True,
        max_age=settings.access_token_minutes * 60,
        **common,
    )
    response.set_cookie(
        "refresh_token",
        pair.refresh_token,
        httponly=True,
        max_age=settings.refresh_token_days * 86400,
        **common,
    )
    response.set_cookie(
        "csrf_token",
        pair.csrf_token,
        httponly=False,
        max_age=settings.refresh_token_days * 86400,
        **common,
    )


def clear_auth_cookies(response: Response, settings: Settings) -> None:
    for name in ("access_token", "refresh_token", "csrf_token"):
        response.delete_cookie(
            name,
            path="/",
            domain=settings.cookie_domain,
            secure=settings.cookie_secure,
            samesite=settings.cookie_samesite,
        )


def validate_csrf(
    claims: dict[str, Any],
    cookie_value: str | None,
    header_value: str | None,
) -> None:
    if not cookie_value or not header_value or not hmac.compare_digest(cookie_value, header_value):
        raise AppError(403, "csrf_failed", "CSRF-токен отсутствует или недействителен")
    claim_hash = claims.get("csrf")
    if not isinstance(claim_hash, str) or not hmac.compare_digest(
        hash_identifier(cookie_value), claim_hash
    ):
        raise AppError(403, "csrf_failed", "CSRF-токен отсутствует или недействителен")
