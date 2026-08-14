from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas import PageDocument


@dataclass(frozen=True)
class LegacyPage:
    source_id: str
    source_url: str
    title: str
    document: PageDocument
    warnings: tuple[str, ...] = ()
    fingerprint: str | None = None


@dataclass(frozen=True)
class LegacyRouteResult:
    mode: Literal["legacy", "not_found"] = "legacy"
    metadata: dict[str, Any] | None = None


class LegacyImporter(ABC):
    """Adapter boundary for inventory, conversion, and legacy route fallback."""

    @abstractmethod
    async def inventory(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    async def import_page(self, source_id: str) -> LegacyPage:
        raise NotImplementedError

    @abstractmethod
    async def resolve(self, path: str, locale: str | None = None) -> LegacyRouteResult:
        raise NotImplementedError


class NullLegacyImporter(LegacyImporter):
    async def inventory(self) -> list[dict[str, Any]]:
        return []

    async def import_page(self, source_id: str) -> LegacyPage:
        raise LookupError(f"источник прежней системы '{source_id}' не настроен")

    async def resolve(self, path: str, locale: str | None = None) -> LegacyRouteResult:
        return LegacyRouteResult(
            mode="legacy",
            metadata={"path": path, "locale": locale, "reason": "fallback"},
        )
