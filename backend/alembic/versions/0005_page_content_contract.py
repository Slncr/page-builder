"""Add first-class page content and listing metadata.

Revision ID: 0005_page_content_contract
Revises: 0004_russian_locale
Create Date: 2026-08-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0005_page_content_contract"
down_revision: str | None = "0004_russian_locale"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_VALUE = sa.JSON().with_variant(postgresql.JSONB(none_as_null=True), "postgresql")


def _columns(table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {
        item["name"]
        for item in sa.inspect(op.get_bind()).get_indexes(table)
        if item["name"] is not None
    }


def _checks(table: str) -> set[str]:
    return {
        item["name"]
        for item in sa.inspect(op.get_bind()).get_check_constraints(table)
        if item["name"] is not None
    }


def upgrade() -> None:
    page_columns = _columns("pages")
    with op.batch_alter_table("pages") as batch:
        if "content_type" not in page_columns:
            batch.add_column(
                sa.Column(
                    "content_type",
                    sa.String(length=32),
                    nullable=False,
                    server_default="generic",
                )
            )
        if "section_key" not in page_columns:
            batch.add_column(sa.Column("section_key", sa.String(length=100), nullable=True))
        if "listing_meta" not in page_columns:
            batch.add_column(
                sa.Column(
                    "listing_meta",
                    JSON_VALUE,
                    nullable=False,
                    server_default=sa.text("'{}'"),
                )
            )

    check_names = _checks("pages")
    if not {"valid_content_type", "ck_pages_valid_content_type"} & check_names:
        with op.batch_alter_table("pages") as batch:
            batch.create_check_constraint(
                "valid_content_type",
                "content_type IN ('generic', 'news', 'article', 'service')",
            )

    page_indexes = _indexes("pages")
    if "ix_pages_content_type" not in page_indexes:
        op.create_index("ix_pages_content_type", "pages", ["content_type"])
    if "ix_pages_section_key" not in page_indexes:
        op.create_index("ix_pages_section_key", "pages", ["section_key"])


def downgrade() -> None:
    page_indexes = _indexes("pages")
    if "ix_pages_section_key" in page_indexes:
        op.drop_index("ix_pages_section_key", table_name="pages")
    if "ix_pages_content_type" in page_indexes:
        op.drop_index("ix_pages_content_type", table_name="pages")

    page_columns = _columns("pages")
    check_names = _checks("pages")
    with op.batch_alter_table("pages") as batch:
        for check_name in ("ck_pages_valid_content_type", "valid_content_type"):
            if check_name in check_names:
                batch.drop_constraint(op.f(check_name), type_="check")
                break
        if "listing_meta" in page_columns:
            batch.drop_column("listing_meta")
        if "section_key" in page_columns:
            batch.drop_column("section_key")
        if "content_type" in page_columns:
            batch.drop_column("content_type")
