from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select, update

from app.audit import add_audit
from app.dependencies import AdminUser, SessionDep
from app.errors import AppError, not_found
from app.models import RefreshSession, Role, User
from app.schemas import UserOut, UserPatch

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
async def list_users(
    session: SessionDep,
    _actor: AdminUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 50,
    role: Annotated[Role | None, Query()] = None,
    active: Annotated[bool | None, Query()] = None,
) -> dict[str, object]:
    filters = []
    if role is not None:
        filters.append(User.role == role.value)
    if active is not None:
        filters.append(User.is_active.is_(active))
    total = int(await session.scalar(select(func.count(User.id)).where(*filters)) or 0)
    users = list(
        (
            await session.scalars(
                select(User)
                .where(*filters)
                .order_by(User.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    )
    return {
        "items": [UserOut.model_validate(user) for user in users],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: UUID,
    session: SessionDep,
    _actor: AdminUser,
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise not_found("User")
    return user


@router.patch("/{user_id}", response_model=UserOut)
async def patch_user(
    user_id: UUID,
    payload: UserPatch,
    request: Request,
    session: SessionDep,
    actor: AdminUser,
) -> User:
    user = await session.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise not_found("User")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return user
    removing_active_admin = (
        user.role == Role.ADMIN.value
        and user.is_active
        and (changes.get("role", Role.ADMIN) != Role.ADMIN or changes.get("is_active") is False)
    )
    if removing_active_admin:
        other_admins = int(
            await session.scalar(
                select(func.count(User.id)).where(
                    User.id != user.id,
                    User.role == Role.ADMIN.value,
                    User.is_active.is_(True),
                )
            )
            or 0
        )
        if other_admins == 0:
            raise AppError(
                409,
                "last_admin",
                "Нельзя удалить или лишить прав последнего активного администратора",
            )
    if "username" in changes and payload.username is not None:
        existing_username = await session.scalar(
            select(User.id).where(
                User.id != user.id,
                User.username == payload.username,
            )
        )
        if existing_username is not None:
            raise AppError(409, "username_exists", "Учётная запись с таким логином уже существует")
    before = {
        "username": user.username,
        "displayName": user.display_name,
        "role": user.role,
        "isActive": user.is_active,
    }
    if "username" in changes:
        user.username = payload.username
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.role is not None:
        user.role = payload.role.value
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.role is not None or payload.is_active is not None:
        user.token_version += 1
        await session.execute(
            update(RefreshSession)
            .where(
                RefreshSession.user_id == user.id,
                RefreshSession.revoked_at.is_(None),
            )
            .values(revoked_at=func.now())
        )
    await session.flush()
    add_audit(
        session,
        request,
        actor=actor,
        action="user.updated",
        resource_type="user",
        resource_id=user.id,
        details={
            "before": before,
            "after": {
                "username": user.username,
                "displayName": user.display_name,
                "role": user.role,
                "isActive": user.is_active,
            },
        },
    )
    return user
