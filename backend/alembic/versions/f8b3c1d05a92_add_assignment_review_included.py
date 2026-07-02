"""add_assignment_review_included

Adds `review_included` (Boolean NOT NULL DEFAULT true) to project_assignments —
the per-(employee, project) review-scope flag. Opt-out: every existing
membership is in scope by default (existing rows backfill to true via the
server default), so nothing changes until an admin excludes a pair in the
review-scope tab. Independent of `is_deleted` (which is team removal).

Revision ID: f8b3c1d05a92
Revises: e7c2a9f14d63
Create Date: 2026-07-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f8b3c1d05a92"
down_revision: Union[str, None] = "e7c2a9f14d63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("project_assignments", schema=None) as batch:
        batch.add_column(
            sa.Column(
                "review_included",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("project_assignments", schema=None) as batch:
        batch.drop_column("review_included")
