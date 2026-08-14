from __future__ import annotations

import argparse
import asyncio

from app.cache import ResilientCache
from app.config import Settings
from app.db import Database
from app.jobs import JobRunner


async def run(*, once: bool = False) -> None:
    settings = Settings()
    database = Database(settings)
    cache = ResilientCache(settings)
    runner = JobRunner(database, cache, settings)
    await cache.initialize()
    try:
        if once:
            await runner.run_once()
            return
        while True:
            await runner.run_once()
            await asyncio.sleep(settings.scheduler_interval_seconds)
    finally:
        await cache.close()
        await database.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run scheduled publishing and cleanup jobs")
    parser.add_argument("--once", action="store_true", help="Run one job cycle and exit")
    args = parser.parse_args()
    try:
        asyncio.run(run(once=args.once))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
