from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, forbidden, not_found
from app.models import Page, Role, User
from app.schemas import PageLockOut


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def lock_expires_at(page: Page, settings: Settings) -> datetime | None:
    if page.locked_at is None:
        return None
    return _aware(page.locked_at) + timedelta(seconds=settings.edit_lock_ttl_seconds)


def lock_is_active(page: Page, settings: Settings) -> bool:
    expires_at = lock_expires_at(page, settings)
    return page.locked_by is not None and expires_at is not None and expires_at > datetime.now(UTC)


def lock_view(page: Page, actor: User, settings: Settings) -> PageLockOut:
    active = lock_is_active(page, settings)
    owner = active and page.locked_by == actor.id
    return PageLockOut(
        page_id=page.id,
        locked=active,
        locked_by=page.locked_by if active else None,
        locked_at=page.locked_at if active else None,
        expires_at=lock_expires_at(page, settings) if active else None,
        is_owner=owner,
        read_only=bool(active and not owner),
        warning=(
            "Страница открыта другим редактором и доступна только для чтения."
            if active and not owner
            else None
        ),
    )


def assert_editable(page: Page, actor: User, settings: Settings) -> None:
    if lock_is_active(page, settings) and page.locked_by != actor.id:
        view = lock_view(page, actor, settings)
        raise AppError(
            409,
            "page_locked",
            "Страница заблокирована другим редактором",
            details=view.model_dump(mode="json", by_alias=True),
        )


async def lock_page(
    session: AsyncSession,
    page_id: UUID,
    actor: User,
    settings: Settings,
    *,
    force: bool = False,
) -> tuple[Page, PageLockOut]:
    page = await session.scalar(
        select(Page).where(Page.id == page_id, Page.deleted_at.is_(None)).with_for_update()
    )
    if page is None:
        raise not_found("Page")
    active_other = lock_is_active(page, settings) and page.locked_by != actor.id
    if active_other and not force:
        assert_editable(page, actor, settings)
    if force and actor.role != Role.ADMIN.value:
        raise forbidden("Принудительно заблокировать страницу может только администратор")
    page.locked_by = actor.id
    page.locked_at = datetime.now(UTC)
    await session.flush()
    return page, lock_view(page, actor, settings)


async def heartbeat_page_lock(
    session: AsyncSession,
    page_id: UUID,
    actor: User,
    settings: Settings,
) -> tuple[Page, PageLockOut]:
    page = await session.scalar(
        select(Page).where(Page.id == page_id, Page.deleted_at.is_(None)).with_for_update()
    )
    if page is None:
        raise not_found("Page")
    if not lock_is_active(page, settings) or page.locked_by != actor.id:
        raise AppError(
            409,
            "lock_lost",
            "Блокировка редактирования истекла или принадлежит другому редактору",
            details=lock_view(page, actor, settings).model_dump(mode="json", by_alias=True),
        )
    page.locked_at = datetime.now(UTC)
    await session.flush()
    return page, lock_view(page, actor, settings)


async def unlock_page(
    session: AsyncSession,
    page_id: UUID,
    actor: User,
    settings: Settings,
    *,
    force: bool = False,
) -> tuple[Page, PageLockOut]:
    page = await session.scalar(
        select(Page).where(Page.id == page_id, Page.deleted_at.is_(None)).with_for_update()
    )
    if page is None:
        raise not_found("Page")
    active = lock_is_active(page, settings)
    if active and page.locked_by != actor.id:
        if actor.role != Role.ADMIN.value or not force:
            raise forbidden(
                "Разблокировать страницу может владелец блокировки "
                "или администратор в принудительном режиме"
            )
    page.locked_by = None
    page.locked_at = None
    await session.flush()
    return page, lock_view(page, actor, settings)
