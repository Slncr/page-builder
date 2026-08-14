from __future__ import annotations

import argparse
import asyncio

from app.config import Settings
from app.db import Database
from app.storage import ResilientObjectStorage
from app.webhooks import WebhookDispatcher
from app.worker import BackgroundWorker


async def run(*, once: bool = False) -> None:
    settings = Settings()
    database = Database(settings)
    storage = ResilientObjectStorage(settings)
    webhooks = WebhookDispatcher(settings)
    worker = BackgroundWorker(database, storage, settings, webhooks)
    await storage.initialize()
    try:
        if once:
            await worker.run_once()
            return
        await worker.run_forever()
    finally:
        await worker.stop()
        await database.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run asset rendition and webhook jobs")
    parser.add_argument("--once", action="store_true", help="Run one worker cycle and exit")
    args = parser.parse_args()
    try:
        asyncio.run(run(once=args.once))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
