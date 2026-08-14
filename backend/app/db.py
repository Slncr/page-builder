from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, MetaData, Uuid, event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.pool import StaticPool

from app.config import Settings

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UUIDPrimaryKeyMixin:
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class Database:
    def __init__(self, settings: Settings) -> None:
        connect_args: dict[str, Any] = {}
        sqlite = settings.database_url.startswith("sqlite")
        engine_options: dict[str, Any] = {}
        if sqlite:
            connect_args["check_same_thread"] = False
            if ":memory:" in settings.database_url:
                engine_options["poolclass"] = StaticPool
        self.engine: AsyncEngine = create_async_engine(
            settings.database_url,
            echo=settings.database_echo,
            pool_pre_ping=not sqlite,
            connect_args=connect_args,
            **engine_options,
        )
        if sqlite:
            event.listen(self.engine.sync_engine, "connect", self._enable_sqlite_foreign_keys)
        self.session_factory = async_sessionmaker(
            self.engine, expire_on_commit=False, class_=AsyncSession
        )

    @staticmethod
    def _enable_sqlite_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    def session(self) -> AsyncSession:
        return self.session_factory()

    async def create_all(self) -> None:
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def dispose(self) -> None:
        await self.engine.dispose()


async def session_scope(database: Database) -> AsyncIterator[AsyncSession]:
    async with database.session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
