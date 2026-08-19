from __future__ import annotations

import argparse
import asyncio
from uuid import UUID

from sqlalchemy import select

from app.config import Settings
from app.db import Database, utcnow
from app.models import Asset, AssetProcessingJob, JobStatus


async def queue_image_reprocessing(
    *,
    site_id: UUID | None = None,
    dry_run: bool = False,
) -> int:
    settings = Settings()
    database = Database(settings)
    queued = 0
    try:
        async with database.session() as session:
            query = select(Asset).where(
                Asset.deleted_at.is_(None),
                Asset.content_type.like("image/%"),
            )
            if site_id is not None:
                query = query.where(Asset.site_id == site_id)
            assets = list((await session.scalars(query)).all())
            for asset in assets:
                job = await session.scalar(
                    select(AssetProcessingJob).where(AssetProcessingJob.asset_id == asset.id)
                )
                if job is None:
                    session.add(AssetProcessingJob(asset_id=asset.id))
                else:
                    job.status = JobStatus.PENDING.value
                    job.run_at = utcnow()
                    job.attempts = 0
                    job.error = None
                asset.status = "processing"
                queued += 1
            if dry_run:
                await session.rollback()
            else:
                await session.commit()
    finally:
        await database.dispose()
    return queued


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Queue WebP re-optimization jobs for existing image assets",
    )
    parser.add_argument(
        "--site-id",
        type=UUID,
        help="Limit reprocessing to one site UUID",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count matching assets without enqueueing jobs",
    )
    args = parser.parse_args()
    queued = asyncio.run(
        queue_image_reprocessing(site_id=args.site_id, dry_run=args.dry_run)
    )
    action = "would queue" if args.dry_run else "queued"
    print(f"{action} {queued} image asset(s) for reprocessing")


if __name__ == "__main__":
    main()
