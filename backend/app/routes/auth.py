from __future__ import annotations

import hmac
import re
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Request, Response, status
from sqlalchemy import func, select, update

from app.audit import add_audit, client_ip
from app.dependencies import (
    CurrentUser,
    OptionalUser,
    SessionDep,
    SettingsDep,
)
from app.errors import AppError, forbidden
from app.models import RefreshSession, Role, User
from app.schemas import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from app.security import (
    DUMMY_PASSWORD_HASH,
    clear_auth_cookies,
    create_token_pair,
    decode_token,
    hash_identifier,
    hash_password,
    set_auth_cookies,
    validate_csrf,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _validate_password_strength(password: str) -> None:
    if not (
        re.search(r"[a-z]", password)
        and re.search(r"[A-Z]", password)
        and re.search(r"\d", password)
    ):
        raise AppError(
            422,
            "weak_password",
            "Пароль должен содержать прописные и строчные буквы, а также цифры",
        )


def _token_response(user: User, pair: object, expires_in: int) -> TokenResponse:
    return TokenResponse(
        access_token=pair.access_token,
        refresh_token=pair.refresh_token,
        expires_in=expires_in,
        user=UserOut.model_validate(user),
    )


def _authorization_token(request: Request) -> str | None:
    value = request.headers.get("Authorization", "")
    return value[7:].strip() if value.lower().startswith("bearer ") else None


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    request: Request,
    session: SessionDep,
    actor: OptionalUser,
) -> User:
    _validate_password_strength(payload.password)
    user_count = int(await session.scalar(select(func.count(User.id))) or 0)
    if user_count:
        if actor is None:
            raise AppError(401, "not_authenticated", "Необходима аутентификация")
        if actor.role != Role.ADMIN.value:
            raise forbidden("Создавать учётные записи может только администратор")
    email = str(payload.email).strip().lower()
    existing = await session.scalar(select(User.id).where(User.email == email))
    if existing is not None:
        raise AppError(
            409, "email_exists", "Учётная запись с таким адресом электронной почты уже существует"
        )
    user = User(
        email=email,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        role=payload.role.value if user_count else Role.ADMIN.value,
    )
    session.add(user)
    await session.flush()
    add_audit(
        session,
        request,
        actor=actor,
        action="user.created",
        resource_type="user",
        resource_id=user.id,
        details={"role": user.role, "bootstrap": user_count == 0},
    )
    return user


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> TokenResponse:
    email = str(payload.email).strip().lower()
    ip = client_ip(request) or "unknown"
    attempts = await request.app.state.cache.increment(
        f"auth-rate:{hash_identifier(ip + ':' + email)}",
        300,
    )
    if attempts > 10:
        raise AppError(
            429,
            "rate_limited",
            "Слишком много попыток входа; повторите попытку позже",
            headers={"Retry-After": "300"},
        )
    user = await session.scalar(select(User).where(User.email == email))
    encoded = user.password_hash if user is not None else DUMMY_PASSWORD_HASH
    valid, replacement = verify_password(payload.password, encoded)
    if user is None or not valid or not user.is_active:
        add_audit(
            session,
            request,
            actor=None,
            action="auth.login_failed",
            resource_type="auth",
            resource_id=None,
            details={"emailHash": hash_identifier(email)},
        )
        await session.commit()
        raise AppError(401, "invalid_credentials", "Неверный адрес электронной почты или пароль")
    if replacement:
        user.password_hash = replacement
    user.last_login_at = datetime.now(UTC)
    pair = create_token_pair(user, settings)
    session.add(
        RefreshSession(
            user_id=user.id,
            jti_hash=hash_identifier(pair.refresh_jti),
            csrf_hash=hash_identifier(pair.csrf_token),
            user_agent=request.headers.get("User-Agent", "")[:512] or None,
            ip_address=client_ip(request),
            expires_at=pair.refresh_expires_at,
        )
    )
    add_audit(
        session,
        request,
        actor=user,
        action="auth.login",
        resource_type="user",
        resource_id=user.id,
    )
    set_auth_cookies(response, pair, settings)
    return _token_response(user, pair, settings.access_token_minutes * 60)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    payload: Annotated[RefreshRequest, Body()] = RefreshRequest(),
) -> TokenResponse:
    bearer = _authorization_token(request)
    token = bearer or payload.refresh_token or request.cookies.get("refresh_token")
    if not token:
        raise AppError(401, "missing_refresh_token", "Необходимо передать токен обновления")
    claims = decode_token(token, settings, "refresh")
    if not bearer and not payload.refresh_token:
        validate_csrf(
            claims,
            request.cookies.get("csrf_token"),
            request.headers.get("X-CSRF-Token"),
        )
    refresh_session = await session.scalar(
        select(RefreshSession).where(RefreshSession.jti_hash == hash_identifier(claims["jti"]))
    )
    user = await session.get(User, UUID(claims["sub"]))
    if refresh_session is None or user is None or not user.is_active:
        raise AppError(
            401, "invalid_refresh_token", "Токен обновления недействителен или просрочен"
        )
    expires_at = refresh_session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if refresh_session.revoked_at is not None:
        await session.execute(
            update(RefreshSession)
            .where(
                RefreshSession.user_id == user.id,
                RefreshSession.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(UTC))
        )
        user.token_version += 1
        await session.commit()
        raise AppError(
            401, "refresh_reuse_detected", "Обнаружено повторное использование токена обновления"
        )
    if expires_at <= datetime.now(UTC) or user.token_version != int(claims.get("ver", -1)):
        raise AppError(
            401, "invalid_refresh_token", "Токен обновления недействителен или просрочен"
        )
    if not hmac.compare_digest(str(claims.get("csrf", "")), refresh_session.csrf_hash):
        raise AppError(401, "invalid_refresh_token", "Токен обновления недействителен")
    pair = create_token_pair(user, settings)
    replacement = RefreshSession(
        user_id=user.id,
        jti_hash=hash_identifier(pair.refresh_jti),
        csrf_hash=hash_identifier(pair.csrf_token),
        user_agent=request.headers.get("User-Agent", "")[:512] or None,
        ip_address=client_ip(request),
        expires_at=pair.refresh_expires_at,
    )
    session.add(replacement)
    await session.flush()
    refresh_session.revoked_at = datetime.now(UTC)
    refresh_session.replaced_by = replacement.id
    add_audit(
        session,
        request,
        actor=user,
        action="auth.refresh",
        resource_type="user",
        resource_id=user.id,
    )
    set_auth_cookies(response, pair, settings)
    return _token_response(user, pair, settings.access_token_minutes * 60)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    payload: Annotated[RefreshRequest, Body()] = RefreshRequest(),
) -> Response:
    bearer = _authorization_token(request)
    token = bearer or payload.refresh_token or request.cookies.get("refresh_token")
    if token:
        try:
            claims = decode_token(token, settings, "refresh")
        except AppError:
            claims = None
        if claims is not None:
            if not bearer and not payload.refresh_token:
                validate_csrf(
                    claims,
                    request.cookies.get("csrf_token"),
                    request.headers.get("X-CSRF-Token"),
                )
            refresh_session = await session.scalar(
                select(RefreshSession).where(
                    RefreshSession.jti_hash == hash_identifier(claims["jti"])
                )
            )
            if refresh_session and refresh_session.revoked_at is None:
                refresh_session.revoked_at = datetime.now(UTC)
            user = await session.get(User, UUID(claims["sub"]))
            add_audit(
                session,
                request,
                actor=user,
                action="auth.logout",
                resource_type="user",
                resource_id=user.id if user else claims["sub"],
            )
    clear_auth_cookies(response, settings)
    return response


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user
