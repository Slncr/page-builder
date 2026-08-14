from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import redact
from app.cache import ResilientCache
from app.config import Settings
from app.db import Database, utcnow
from app.metrics import SCHEDULER_OPERATIONS
from app.models import (
    AuditLog,
    IdempotencyRecord,
    JobStatus,
    Page,
    PageStatus,
    PublishJob,
    RefreshSession,
    ReviewDecision,
    Revision,
    Submission,
)
from app.services import (
    _activate_route,
    invalidate_public_content,
    parse_document,
    validate_for_publish,
)

logger = logging.getLogger(__name__)


def advisory_lock_key(name: str) -> int:
    raw = hashlib.sha256(name.encode("utf-8")).digest()[:8]
    return int.from_bytes(raw, byteorder="big", signed=True)


class JobRunner:
    def __init__(
        self,
        database: Database,
        cache: ResilientCache,
        settings: Settings,
    ) -> None:
        self.database = database
        self.cache = cache
        self.settings = settings
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._local_lock = asyncio.Lock()

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="page-builder-jobs")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("scheduled job cycle failed")
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=self.settings.scheduler_interval_seconds,
                )
            except TimeoutError:
                pass

    @asynccontextmanager
    async def _leader(self, session: AsyncSession) -> AsyncIterator[bool]:
        if session.bind and session.bind.dialect.name == "postgresql":
            key = advisory_lock_key("construktor:scheduler")
            acquired = bool(
                await session.scalar(text("SELECT pg_try_advisory_lock(:key)").bindparams(key=key))
            )
            try:
                yield acquired
            finally:
                if acquired:
                    await session.execute(
                        text("SELECT pg_advisory_unlock(:key)").bindparams(key=key)
                    )
            return
        if self._local_lock.locked():
            yield False
            return
        async with self._local_lock:
            yield True

    async def run_once(self) -> None:
        async with self.database.session() as leader_session:
            async with self._leader(leader_session) as leader:
                if not leader:
                    return
                due_ids = list(
                    (
                        await leader_session.scalars(
                            select(PublishJob.id)
                            .where(
                                PublishJob.status == JobStatus.PENDING.value,
                                PublishJob.run_at <= datetime.now(UTC),
                            )
                            .order_by(PublishJob.run_at)
                            .limit(50)
                        )
                    ).all()
                )
                for job_id in due_ids:
                    await self._process_publish_job(job_id)
                await self._cleanup(leader_session)
                await leader_session.commit()

    async def _process_publish_job(self, job_id: object) -> None:
        try:
            async with self.database.session() as session:
                job = await session.scalar(
                    select(PublishJob)
                    .where(PublishJob.id == job_id)
                    .with_for_update(skip_locked=True)
                )
                if job is None or job.status != JobStatus.PENDING.value:
                    return
                job.status = JobStatus.RUNNING.value
                job.attempts += 1
                await session.flush()
                page = await session.scalar(
                    select(Page).where(Page.id == job.page_id).with_for_update()
                )
                revision = await session.get(Revision, job.revision_id)
                if page is None or page.deleted_at is not None or revision is None:
                    raise RuntimeError(
                        "страница или ревизия для отложенной публикации больше не существует"
                    )
                issues = await validate_for_publish(
                    session,
                    page,
                    parse_document(revision.document),
                    settings=self.settings,
                )
                if issues:
                    raise RuntimeError(
                        "документ для отложенной публикации не прошёл проверку: "
                        + "; ".join(issue.message for issue in issues)
                    )
                await _activate_route(
                    session,
                    page,
                    job.route_path,
                    self.settings.default_locale,
                )
                page.published_revision_id = revision.id
                page.published_at = utcnow()
                page.status = PageStatus.PUBLISHED.value
                page.review_status = ReviewDecision.APPROVED.value
                page.updated_by = job.created_by
                job.status = JobStatus.SUCCEEDED.value
                job.error = None
                session.add(
                    AuditLog(
                        actor_id=job.created_by,
                        action="page.scheduled_publish_completed",
                        resource_type="page",
                        resource_id=str(page.id),
                        details={"jobId": str(job.id), "revisionId": str(revision.id)},
                    )
                )
                await session.commit()
                SCHEDULER_OPERATIONS.labels("success").inc()
                await invalidate_public_content(self.cache, page.site_id)
        except Exception as exc:
            SCHEDULER_OPERATIONS.labels("failure").inc()
            logger.exception("scheduled publish job failed", extra={"job_id": str(job_id)})
            async with self.database.session() as session:
                job = await session.get(PublishJob, job_id)
                if job is None:
                    return
                attempts = job.attempts + 1
                job.attempts = attempts
                job.error = str(exc)[:4000]
                if attempts < 3:
                    job.status = JobStatus.PENDING.value
                    job.run_at = datetime.now(UTC) + timedelta(minutes=5 * attempts)
                else:
                    job.status = JobStatus.FAILED.value
                session.add(
                    AuditLog(
                        actor_id=job.created_by,
                        action="page.scheduled_publish_failed",
                        resource_type="publish_job",
                        resource_id=str(job.id),
                        details=redact({"attempts": attempts, "error": str(exc)[:500]}),
                    )
                )
                await session.commit()

    async def _cleanup(self, session: AsyncSession) -> None:
        now = datetime.now(UTC)
        await session.execute(delete(RefreshSession).where(RefreshSession.expires_at < now))
        await session.execute(delete(IdempotencyRecord).where(IdempotencyRecord.expires_at < now))
        completed_before = now - timedelta(days=self.settings.cleanup_after_days)
        await session.execute(
            delete(PublishJob).where(
                PublishJob.status.in_(
                    [
                        JobStatus.SUCCEEDED.value,
                        JobStatus.CANCELLED.value,
                    ]
                ),
                PublishJob.updated_at < completed_before,
            )
        )
        await session.execute(
            delete(Page).where(
                Page.deleted_at.is_not(None),
                Page.deleted_at < now - timedelta(days=self.settings.trash_retention_days),
            )
        )
        await session.execute(delete(Submission).where(Submission.created_at < completed_before))
