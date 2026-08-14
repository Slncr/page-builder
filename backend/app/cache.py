from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from redis.asyncio import Redis

from app.config import Settings

logger = logging.getLogger(__name__)


class MemoryCache:
    def __init__(self) -> None:
        self._values: dict[str, tuple[float, str]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> str | None:
        async with self._lock:
            value = self._values.get(key)
            if value is None:
                return None
            expires_at, payload = value
            if expires_at and expires_at <= time.monotonic():
                self._values.pop(key, None)
                return None
            return payload

    async def set(self, key: str, value: str, ttl: int) -> None:
        expires_at = time.monotonic() + ttl if ttl > 0 else 0
        async with self._lock:
            self._values[key] = (expires_at, value)

    async def increment(self, key: str, ttl: int) -> int:
        async with self._lock:
            now = time.monotonic()
            value = self._values.get(key)
            count = 0
            if value is not None and (not value[0] or value[0] > now):
                try:
                    count = int(value[1])
                except ValueError:
                    count = 0
            count += 1
            self._values[key] = (now + ttl, str(count))
            return count

    async def delete_prefix(self, prefix: str) -> None:
        async with self._lock:
            for key in tuple(self._values):
                if key.startswith(prefix):
                    self._values.pop(key, None)

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        self._values.clear()


class ResilientCache:
    def __init__(self, settings: Settings) -> None:
        self.prefix = settings.cache_prefix
        self.memory = MemoryCache()
        self.redis: Redis | None = (
            Redis.from_url(settings.redis_url, decode_responses=True)
            if settings.redis_url
            else None
        )
        self.redis_healthy = False

    def key(self, value: str) -> str:
        return f"{self.prefix}:{value}"

    async def initialize(self) -> None:
        if self.redis is None:
            return
        try:
            self.redis_healthy = bool(await self.redis.ping())
        except Exception:
            logger.warning("Redis unavailable; using in-process cache", exc_info=True)
            self.redis_healthy = False

    async def get_json(self, key: str) -> dict[str, Any] | None:
        full_key = self.key(key)
        payload: str | None = None
        if self.redis_healthy and self.redis is not None:
            try:
                payload = await self.redis.get(full_key)
            except Exception:
                logger.warning("Redis read failed; falling back to memory", exc_info=True)
                self.redis_healthy = False
        if payload is None:
            payload = await self.memory.get(full_key)
        if payload is None:
            return None
        try:
            value = json.loads(payload)
        except json.JSONDecodeError:
            return None
        return value if isinstance(value, dict) else None

    async def set_json(self, key: str, value: dict[str, Any], ttl: int) -> None:
        full_key = self.key(key)
        payload = json.dumps(value, separators=(",", ":"), default=str)
        await self.memory.set(full_key, payload, ttl)
        if self.redis_healthy and self.redis is not None:
            try:
                await self.redis.set(full_key, payload, ex=ttl if ttl > 0 else None)
            except Exception:
                logger.warning("Redis write failed; retaining memory cache", exc_info=True)
                self.redis_healthy = False

    async def increment(self, key: str, ttl: int) -> int:
        full_key = self.key(key)
        if self.redis_healthy and self.redis is not None:
            try:
                count = int(await self.redis.incr(full_key))
                if count == 1:
                    await self.redis.expire(full_key, ttl)
                return count
            except Exception:
                logger.warning("Redis counter failed; using memory limiter", exc_info=True)
                self.redis_healthy = False
        return await self.memory.increment(full_key, ttl)

    async def delete_prefix(self, prefix: str) -> None:
        full_prefix = self.key(prefix)
        await self.memory.delete_prefix(full_prefix)
        if self.redis_healthy and self.redis is not None:
            try:
                async for key in self.redis.scan_iter(match=f"{full_prefix}*"):
                    await self.redis.delete(key)
            except Exception:
                logger.warning("Redis invalidation failed", exc_info=True)
                self.redis_healthy = False

    async def ping(self) -> bool:
        if self.redis is None:
            return True
        if not self.redis_healthy:
            return False
        try:
            return bool(await self.redis.ping())
        except Exception:
            self.redis_healthy = False
            return False

    async def close(self) -> None:
        await self.memory.close()
        if self.redis is not None:
            await self.redis.aclose()
