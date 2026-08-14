from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, forbidden
from app.models import Role, User
from app.security import decode_token, validate_csrf

ROLE_LEVEL = {
    Role.VIEWER.value: 0,
    Role.COPYWRITER.value: 1,
    Role.EDITOR.value: 2,
    Role.PUBLISHER.value: 3,
    Role.ADMIN.value: 4,
}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.database.session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def _extract_access_token(request: Request) -> tuple[str | None, bool]:
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip(), False
    return request.cookies.get("access_token"), True


async def optional_current_user(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_app_settings)],
) -> User | None:
    token, from_cookie = _extract_access_token(request)
    if not token:
        return None
    claims = decode_token(token, settings, "access")
    user = await session.get(User, UUID(claims["sub"]))
    if user is None or not user.is_active or user.token_version != int(claims.get("ver", -1)):
        raise AppError(
            401,
            "invalid_token",
            "Токен аутентификации недействителен или просрочен",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if from_cookie and request.method.upper() not in SAFE_METHODS:
        validate_csrf(
            claims,
            request.cookies.get("csrf_token"),
            request.headers.get("X-CSRF-Token"),
        )
    return user


async def current_user(
    user: Annotated[User | None, Depends(optional_current_user)],
) -> User:
    if user is None:
        raise AppError(
            401,
            "not_authenticated",
            "Необходима аутентификация",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_min_role(
    role: Role,
) -> Callable[[User], Coroutine[Any, Any, User]]:
    async def dependency(user: Annotated[User, Depends(current_user)]) -> User:
        if ROLE_LEVEL.get(user.role, -1) < ROLE_LEVEL[role.value]:
            raise forbidden()
        return user

    return dependency


SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_app_settings)]
CurrentUser = Annotated[User, Depends(current_user)]
OptionalUser = Annotated[User | None, Depends(optional_current_user)]
ViewerUser = Annotated[User, Depends(require_min_role(Role.VIEWER))]
CopywriterUser = Annotated[User, Depends(require_min_role(Role.COPYWRITER))]
EditorUser = Annotated[User, Depends(require_min_role(Role.EDITOR))]
PublisherUser = Annotated[User, Depends(require_min_role(Role.PUBLISHER))]
AdminUser = Annotated[User, Depends(require_min_role(Role.ADMIN))]
