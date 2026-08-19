from __future__ import annotations

import argparse
import asyncio
from uuid import UUID

from sqlalchemy import select, update

from app.config import Settings
from app.db import Database
from app.models import Template
from app.templates.catalog import LEGACY_SITE_TEMPLATE_SLUGS, load_site_templates


async def seed_templates(
    *,
    site_id: UUID | None = None,
    replace: bool = False,
    dry_run: bool = False,
) -> tuple[int, int]:
    settings = Settings()
    database = Database(settings)
    created = 0
    updated = 0
    try:
        async with database.session() as session:
            site_filter = (
                Template.site_id.is_(None) if site_id is None else Template.site_id == site_id
            )
            for item in load_site_templates():
                existing = await session.scalar(
                    select(Template).where(
                        Template.slug == item["slug"],
                        site_filter,
                    )
                )
                if existing is None:
                    session.add(
                        Template(
                            site_id=site_id,
                            slug=item["slug"],
                            name=item["name"],
                            version=1,
                            document=item["document"].model_dump(by_alias=True, mode="json"),
                            is_active=True,
                        )
                    )
                    created += 1
                    continue
                if replace:
                    existing.name = item["name"]
                    existing.document = item["document"].model_dump(by_alias=True, mode="json")
                    existing.is_active = True
                    updated += 1
            if replace:
                result = await session.execute(
                    update(Template)
                    .where(
                        site_filter,
                        Template.slug.in_(LEGACY_SITE_TEMPLATE_SLUGS),
                        Template.is_active.is_(True),
                    )
                    .values(is_active=False)
                )
                updated += result.rowcount or 0
            if dry_run:
                await session.rollback()
            else:
                await session.commit()
    finally:
        await database.dispose()
    return created, updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed built-in site page templates")
    parser.add_argument("--site-id", type=UUID, help="Attach templates to a site (default: global)")
    parser.add_argument("--replace", action="store_true", help="Update existing templates by slug")
    parser.add_argument("--dry-run", action="store_true", help="Validate without writing")
    args = parser.parse_args()
    created, updated = asyncio.run(
        seed_templates(site_id=args.site_id, replace=args.replace, dry_run=args.dry_run)
    )
    action = "would seed" if args.dry_run else "seeded"
    print(f"{action}: {created} created, {updated} updated")


if __name__ == "__main__":
    main()
