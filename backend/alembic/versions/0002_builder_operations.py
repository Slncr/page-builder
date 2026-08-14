"""Add locks, import provenance, renditions, and delivery jobs.

Revision ID: 0002_builder_operations
Revises: 0001_initial
Create Date: 2026-08-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0002_builder_operations"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_VALUE = sa.JSON().with_variant(postgresql.JSONB(none_as_null=True), "postgresql")


def _columns(table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _indexes(table: str) -> set[str]:
    return {
        item["name"]
        for item in sa.inspect(op.get_bind()).get_indexes(table)
        if item["name"] is not None
    }


def _unique_constraints(table: str) -> set[str]:
    return {
        item["name"]
        for item in sa.inspect(op.get_bind()).get_unique_constraints(table)
        if item["name"] is not None
    }


def upgrade() -> None:
    page_columns = _columns("pages")
    with op.batch_alter_table("pages") as batch:
        if "locked_by" not in page_columns:
            batch.add_column(sa.Column("locked_by", sa.Uuid(), nullable=True))
            batch.create_foreign_key(
                "fk_pages_locked_by_users",
                "users",
                ["locked_by"],
                ["id"],
                ondelete="SET NULL",
            )
        if "locked_at" not in page_columns:
            batch.add_column(sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))
        if "source_identifier" not in page_columns:
            batch.add_column(sa.Column("source_identifier", sa.String(length=500), nullable=True))
        if "source_url" not in page_columns:
            batch.add_column(sa.Column("source_url", sa.String(length=2048), nullable=True))
        if "source_fingerprint" not in page_columns:
            batch.add_column(sa.Column("source_fingerprint", sa.String(length=128), nullable=True))
        if "import_diagnostics" not in page_columns:
            batch.add_column(
                sa.Column(
                    "import_diagnostics",
                    JSON_VALUE,
                    nullable=False,
                    server_default=sa.text("'{}'"),
                )
            )
    page_indexes = _indexes("pages")
    if "ix_pages_locked_by" not in page_indexes:
        op.create_index("ix_pages_locked_by", "pages", ["locked_by"])
    if "ix_pages_locked_at" not in page_indexes:
        op.create_index("ix_pages_locked_at", "pages", ["locked_at"])
    if "ix_pages_source_identifier" not in page_indexes:
        op.create_index("ix_pages_source_identifier", "pages", ["source_identifier"])
    if "uq_pages_site_source_identifier" not in _unique_constraints("pages"):
        with op.batch_alter_table("pages") as batch:
            batch.create_unique_constraint(
                "uq_pages_site_source_identifier",
                ["site_id", "source_identifier"],
            )

    rendition_columns = _columns("renditions")
    with op.batch_alter_table("renditions") as batch:
        if "format" not in rendition_columns:
            batch.add_column(
                sa.Column(
                    "format",
                    sa.String(length=20),
                    nullable=False,
                    server_default="unknown",
                )
            )
        if "checksum" not in rendition_columns:
            batch.add_column(sa.Column("checksum", sa.String(length=64), nullable=True))

    tables = _tables()
    if "asset_processing_jobs" not in tables:
        op.create_table(
            "asset_processing_jobs",
            sa.Column("asset_id", sa.Uuid(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("run_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["asset_id"],
                ["assets.id"],
                name="fk_asset_processing_jobs_asset_id_assets",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id", name="pk_asset_processing_jobs"),
            sa.UniqueConstraint("asset_id", name="uq_asset_processing_jobs_asset_id"),
        )
        op.create_index(
            "ix_asset_processing_jobs_asset_id",
            "asset_processing_jobs",
            ["asset_id"],
        )
        op.create_index(
            "ix_asset_processing_jobs_due",
            "asset_processing_jobs",
            ["status", "run_at"],
        )

    if "webhook_deliveries" not in tables:
        op.create_table(
            "webhook_deliveries",
            sa.Column("submission_id", sa.Uuid(), nullable=False),
            sa.Column("url", sa.String(length=2048), nullable=False),
            sa.Column("payload", JSON_VALUE, nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["submission_id"],
                ["submissions.id"],
                name="fk_webhook_deliveries_submission_id_submissions",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id", name="pk_webhook_deliveries"),
        )
        op.create_index(
            "ix_webhook_deliveries_submission_id",
            "webhook_deliveries",
            ["submission_id"],
        )
        op.create_index(
            "ix_webhook_deliveries_due",
            "webhook_deliveries",
            ["status", "next_attempt_at"],
        )


def downgrade() -> None:
    tables = _tables()
    if "webhook_deliveries" in tables:
        op.drop_table("webhook_deliveries")
    if "asset_processing_jobs" in tables:
        op.drop_table("asset_processing_jobs")

    rendition_columns = _columns("renditions")
    with op.batch_alter_table("renditions") as batch:
        if "checksum" in rendition_columns:
            batch.drop_column("checksum")
        if "format" in rendition_columns:
            batch.drop_column("format")

    page_indexes = _indexes("pages")
    for index_name in (
        "ix_pages_source_identifier",
        "ix_pages_locked_at",
        "ix_pages_locked_by",
    ):
        if index_name in page_indexes:
            op.drop_index(index_name, table_name="pages")
    if "uq_pages_site_source_identifier" in _unique_constraints("pages"):
        with op.batch_alter_table("pages") as batch:
            batch.drop_constraint("uq_pages_site_source_identifier", type_="unique")
    page_columns = _columns("pages")
    with op.batch_alter_table("pages") as batch:
        for column_name in (
            "import_diagnostics",
            "source_fingerprint",
            "source_url",
            "source_identifier",
            "locked_at",
            "locked_by",
        ):
            if column_name in page_columns:
                batch.drop_column(column_name)
