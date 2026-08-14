from __future__ import annotations

import asyncio
import io
import logging
from pathlib import Path
from typing import Protocol

from minio import Minio

from app.config import Settings

logger = logging.getLogger(__name__)


class ObjectStorage(Protocol):
    async def initialize(self) -> None: ...

    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> bytes: ...

    async def delete(self, key: str) -> None: ...

    async def exists(self, key: str) -> bool: ...


class LocalObjectStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        target = (self.root / key).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError("небезопасный ключ объекта")
        return target

    async def initialize(self) -> None:
        await asyncio.to_thread(self.root.mkdir, parents=True, exist_ok=True)

    async def put(self, key: str, data: bytes, _content_type: str) -> None:
        path = self._path(key)
        await asyncio.to_thread(path.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, data)

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread(self._path(key).read_bytes)

    async def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            await asyncio.to_thread(path.unlink)

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._path(key).is_file)


class MinioObjectStorage:
    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.minio_bucket
        self.client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key.get_secret_value(),
            secure=settings.minio_secure,
        )

    async def initialize(self) -> None:
        exists = await asyncio.to_thread(self.client.bucket_exists, self.bucket)
        if not exists:
            await asyncio.to_thread(self.client.make_bucket, self.bucket)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(
            self.client.put_object,
            self.bucket,
            key,
            io.BytesIO(data),
            len(data),
            content_type=content_type,
        )

    async def get(self, key: str) -> bytes:
        response = await asyncio.to_thread(self.client.get_object, self.bucket, key)
        try:
            return await asyncio.to_thread(response.read)
        finally:
            response.close()
            response.release_conn()

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self.client.remove_object, self.bucket, key)

    async def exists(self, key: str) -> bool:
        try:
            await asyncio.to_thread(self.client.stat_object, self.bucket, key)
            return True
        except Exception:
            return False


class ResilientObjectStorage:
    def __init__(self, settings: Settings) -> None:
        self.local = LocalObjectStorage(settings.local_storage_path)
        self.primary: ObjectStorage = (
            MinioObjectStorage(settings) if settings.object_storage == "minio" else self.local
        )
        self.using_fallback = False

    @property
    def active(self) -> ObjectStorage:
        return self.local if self.using_fallback else self.primary

    async def initialize(self) -> None:
        await self.local.initialize()
        if self.primary is self.local:
            return
        try:
            await self.primary.initialize()
        except Exception:
            logger.error("MinIO unavailable; using local object storage", exc_info=True)
            self.using_fallback = True

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        try:
            await self.active.put(key, data, content_type)
        except Exception:
            if self.active is self.local:
                raise
            logger.error("MinIO write failed; switching to local storage", exc_info=True)
            self.using_fallback = True
            await self.local.put(key, data, content_type)

    async def get(self, key: str) -> bytes:
        try:
            return await self.active.get(key)
        except Exception:
            if self.active is self.local:
                raise
            logger.error("MinIO read failed; checking local fallback", exc_info=True)
            return await self.local.get(key)

    async def delete(self, key: str) -> None:
        await self.active.delete(key)

    async def exists(self, key: str) -> bool:
        return await self.active.exists(key)
