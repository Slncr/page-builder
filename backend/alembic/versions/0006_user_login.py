"""Add unique usernames for account login.

Revision ID: 0006_user_login
Revises: 0005_page_content_contract
Create Date: 2026-08-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_user_login"
down_revision: str | None = "0005_page_content_contract"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {
        item["name"]
        for item in sa.inspect(op.get_bind()).get_indexes(table)
        if item["name"] is not None
    }


def upgrade() -> None:
    if "username" not in _columns("users"):
        with op.batch_alter_table("users") as batch:
            batch.add_column(sa.Column("username", sa.String(length=64), nullable=True))

    if "ix_users_username" not in _indexes("users"):
        op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    if "ix_users_username" in _indexes("users"):
        op.drop_index("ix_users_username", table_name="users")

    if "username" in _columns("users"):
        with op.batch_alter_table("users") as batch:
            batch.drop_column("username")
