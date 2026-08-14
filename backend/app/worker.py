from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.config import Settings
from app.db import Database, utcnow
from app.media import generate_renditions, normalize_uploaded_image
from app.metrics import WORKER_OPERATIONS
from app.models import (
    Asset,
    AssetProcessingJob,
    JobStatus,
    Rendition,
    WebhookDelivery,
)
from app.storage import ResilientObjectStorage
from app.webhooks import WebhookDispatcher

logger = logging.getLogger(__name__)


class BackgroundWorker:
    def __init__(
        self,
        database: Database,
        storage: ResilientObjectStorage,
        settings: Settings,
        webhooks: WebhookDispatcher,
    ) -> None:
        self.database = database
        self.storage = storage
        self.settings = settings
        self.webhooks = webhooks
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        if self._task is None:
            self._stop.clear()
            self._task = asyncio.create_task(self.run_forever(), name="page-builder-worker")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def run_forever(self) -> None:
        while not self._stop.is_set():
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("background worker cycle failed")
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=self.settings.worker_interval_seconds,
                )
            except TimeoutError:
                pass

    async def run_once(self) -> None:
        now = datetime.now(UTC)
        async with self.database.session() as session:
            asset_ids = list(
                (
                    await session.scalars(
                        select(AssetProcessingJob.id)
                        .where(
                            AssetProcessingJob.status == JobStatus.PENDING.value,
                            AssetProcessingJob.run_at <= now,
                        )
                        .order_by(AssetProcessingJob.run_at)
                        .limit(10)
                    )
                ).all()
            )
            webhook_ids = list(
                (
                    await session.scalars(
                        select(WebhookDelivery.id)
                        .where(
                            WebhookDelivery.status == JobStatus.PENDING.value,
                            WebhookDelivery.next_attempt_at <= now,
                        )
                        .order_by(WebhookDelivery.next_attempt_at)
                        .limit(25)
                    )
                ).all()
            )
        for job_id in asset_ids:
            await self._process_asset(job_id)
        for delivery_id in webhook_ids:
            await self._process_webhook(delivery_id)

    async def _process_asset(self, job_id: object) -> None:
        try:
            async with self.database.session() as session:
                job = await session.scalar(
                    select(AssetProcessingJob)
                    .where(AssetProcessingJob.id == job_id)
                    .with_for_update(skip_locked=True)
                )
                if job is None or job.status != JobStatus.PENDING.value:
                    return
                job.status = JobStatus.RUNNING.value
                job.attempts += 1
                asset = await session.get(Asset, job.asset_id)
                if asset is None or asset.deleted_at is not None:
                    raise RuntimeError("медиафайл больше не существует")
                source = await self.storage.get(asset.object_key)
                normalized = await asyncio.to_thread(
                    normalize_uploaded_image,
                    source,
                    self.settings.image_quality,
                )
                checksum = hashlib.sha256(normalized.data).hexdigest()
                if checksum != asset.checksum:
                    await self.storage.put(
                        asset.object_key,
                        normalized.data,
                        normalized.content_type,
                    )
                asset.content_type = normalized.content_type
                asset.byte_size = len(normalized.data)
                asset.checksum = checksum
                asset.width = normalized.width
                asset.height = normalized.height
                asset.metadata_json = {**asset.metadata_json, **normalized.metadata}
                generated = await asyncio.to_thread(
                    generate_renditions,
                    normalized.data,
                    self.settings.rendition_widths,
                    self.settings.image_quality,
                )
                for item in generated:
                    rendition = await session.scalar(
                        select(Rendition).where(
                            Rendition.asset_id == asset.id,
                            Rendition.name == item.name,
                        )
                    )
                    object_key = (
                        f"{asset.site_id}/renditions/{asset.id}/{item.name}.{item.extension}"
                    )
                    await self.storage.put(object_key, item.data, item.content_type)
                    if rendition is None:
                        rendition = Rendition(
                            asset_id=asset.id,
                            name=item.name,
                            object_key=object_key,
                            format=item.format,
                            content_type=item.content_type,
                            byte_size=len(item.data),
                            checksum=item.checksum,
                            width=item.width,
                            height=item.height,
                        )
                        session.add(rendition)
                    else:
                        rendition.object_key = object_key
                        rendition.format = item.format
                        rendition.content_type = item.content_type
                        rendition.byte_size = len(item.data)
                        rendition.checksum = item.checksum
                        rendition.width = item.width
                        rendition.height = item.height
                asset.status = "ready"
                job.status = JobStatus.SUCCEEDED.value
                job.error = None
                await session.commit()
                WORKER_OPERATIONS.labels("asset", "success").inc()
        except Exception as exc:
            WORKER_OPERATIONS.labels("asset", "failure").inc()
            logger.exception("asset processing failed", extra={"job_id": str(job_id)})
            async with self.database.session() as session:
                job = await session.get(AssetProcessingJob, job_id)
                if job is None:
                    return
                asset = await session.get(Asset, job.asset_id)
                job.error = str(exc)[:4000]
                if job.attempts < 3:
                    job.status = JobStatus.PENDING.value
                    job.run_at = datetime.now(UTC) + timedelta(minutes=job.attempts)
                else:
                    job.status = JobStatus.FAILED.value
                    if asset is not None:
                        asset.status = "failed"
                await session.commit()

    async def _process_webhook(self, delivery_id: object) -> None:
        try:
            async with self.database.session() as session:
                delivery = await session.scalar(
                    select(WebhookDelivery)
                    .where(WebhookDelivery.id == delivery_id)
                    .with_for_update(skip_locked=True)
                )
                if delivery is None or delivery.status != JobStatus.PENDING.value:
                    return
                delivery.status = JobStatus.RUNNING.value
                delivery.attempts += 1
                await session.flush()
                await self.webhooks.deliver(delivery.url, delivery.payload)
                delivery.status = JobStatus.SUCCEEDED.value
                delivery.delivered_at = utcnow()
                delivery.last_error = None
                await session.commit()
                WORKER_OPERATIONS.labels("webhook", "success").inc()
        except Exception as exc:
            WORKER_OPERATIONS.labels("webhook", "failure").inc()
            logger.exception("webhook delivery failed", extra={"delivery_id": str(delivery_id)})
            async with self.database.session() as session:
                delivery = await session.get(WebhookDelivery, delivery_id)
                if delivery is None:
                    return
                delivery.last_error = str(exc)[:4000]
                if delivery.attempts < 5:
                    delivery.status = JobStatus.PENDING.value
                    delivery.next_attempt_at = datetime.now(UTC) + timedelta(
                        minutes=2 ** max(delivery.attempts - 1, 0)
                    )
                else:
                    delivery.status = JobStatus.FAILED.value
                await session.commit()
