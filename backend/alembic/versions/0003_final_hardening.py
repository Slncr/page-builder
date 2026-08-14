"""Add hardening state for idempotency and managed content.

Revision ID: 0003_final_hardening
Revises: 0002_builder_operations
Create Date: 2026-08-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003_final_hardening"
down_revision: str | None = "0002_builder_operations"
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


def upgrade() -> None:
    revision_columns = _columns("revisions")
    if "draft_version" not in revision_columns:
        op.add_column("revisions", sa.Column("draft_version", sa.Integer(), nullable=True))

    asset_columns = _columns("assets")
    with op.batch_alter_table("assets") as batch:
        if "folder_path" not in asset_columns:
            batch.add_column(sa.Column("folder_path", sa.String(length=500), nullable=True))
        if "tags" not in asset_columns:
            batch.add_column(
                sa.Column(
                    "tags",
                    JSON_VALUE,
                    nullable=False,
                    server_default=sa.text("'[]'"),
                )
            )
    if "ix_assets_folder_path" not in _indexes("assets"):
        op.create_index("ix_assets_folder_path", "assets", ["folder_path"])

    preset_columns = _columns("presets")
    if "is_active" not in preset_columns:
        op.add_column(
            "presets",
            sa.Column(
                "is_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )

    if "idempotency_records" not in _tables():
        op.create_table(
            "idempotency_records",
            sa.Column("actor_id", sa.Uuid(), nullable=False),
            sa.Column("operation", sa.String(length=100), nullable=False),
            sa.Column("key", sa.String(length=200), nullable=False),
            sa.Column("request_hash", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("response_json", JSON_VALUE, nullable=True),
            sa.Column("status_code", sa.Integer(), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["actor_id"],
                ["users.id"],
                name="fk_idempotency_records_actor_id_users",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id", name="pk_idempotency_records"),
            sa.UniqueConstraint(
                "actor_id",
                "operation",
                "key",
                name="uq_idempotency_actor_operation_key",
            ),
        )
        op.create_index(
            "ix_idempotency_records_actor_id",
            "idempotency_records",
            ["actor_id"],
        )
        op.create_index(
            "ix_idempotency_expires",
            "idempotency_records",
            ["expires_at"],
        )


def downgrade() -> None:
    if "idempotency_records" in _tables():
        op.drop_table("idempotency_records")
    if "is_active" in _columns("presets"):
        op.drop_column("presets", "is_active")
    if "ix_assets_folder_path" in _indexes("assets"):
        op.drop_index("ix_assets_folder_path", table_name="assets")
    asset_columns = _columns("assets")
    with op.batch_alter_table("assets") as batch:
        if "tags" in asset_columns:
            batch.drop_column("tags")
        if "folder_path" in asset_columns:
            batch.drop_column("folder_path")
    if "draft_version" in _columns("revisions"):
        op.drop_column("revisions", "draft_version")
