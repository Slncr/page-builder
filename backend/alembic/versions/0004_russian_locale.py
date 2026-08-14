"""Switch technical locale defaults to Russian.

Revision ID: 0004_russian_locale
Revises: 0003_final_hardening
Create Date: 2026-08-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_russian_locale"
down_revision: str | None = "0003_final_hardening"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _set_locale_default(table_name: str, column_name: str, locale: str) -> None:
    with op.batch_alter_table(table_name) as batch:
        batch.alter_column(
            column_name,
            existing_type=sa.String(length=20),
            existing_nullable=False,
            server_default=sa.text(f"'{locale}'"),
        )


def upgrade() -> None:
    """Convert only relational locale metadata that used the old technical default."""
    sites = sa.table("sites", sa.column("default_locale", sa.String(length=20)))
    routes = sa.table("routes", sa.column("locale", sa.String(length=20)))
    op.execute(
        sites.update()
        .where(sites.c.default_locale == op.inline_literal("en"))
        .values(default_locale=op.inline_literal("ru"))
    )
    op.execute(
        routes.update()
        .where(routes.c.locale == op.inline_literal("en"))
        .values(locale=op.inline_literal("ru"))
    )
    _set_locale_default("sites", "default_locale", "ru")
    _set_locale_default("routes", "locale", "ru")


def downgrade() -> None:
    """Restore schema defaults without rewriting possibly user-selected Russian metadata."""
    _set_locale_default("routes", "locale", "en")
    _set_locale_default("sites", "default_locale", "en")
