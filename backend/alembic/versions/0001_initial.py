"""Initial page-builder schema.

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-12
"""

from collections.abc import Sequence

from alembic import op
from app import models  # noqa: F401
from app.db import Base

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the complete baseline from the version-pinned SQLAlchemy metadata."""
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    """Drop the baseline in dependency-safe reverse order."""
    bind = op.get_bind()
    for table in reversed(Base.metadata.sorted_tables):
        table.drop(bind=bind, checkfirst=True)
