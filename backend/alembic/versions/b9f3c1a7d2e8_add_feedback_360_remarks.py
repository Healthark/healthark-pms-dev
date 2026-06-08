"""add_feedback_360_remarks

Adds an optional free-text `remarks` column to `feedback_360_reviews`.

The remark is the reviewer's qualitative note alongside their 1–5
ratings. It's surfaced anonymously on the target's own My Feedback view
as scrollable cards, gated by the same per-cohort reviewer threshold as
the rating matrix (a cohort's remarks appear only once that cohort has
3+ reviewers). Reviewer identity remains unstored — see
`a3f7c2b9e108_add_feedback_360`.

Nullable with no backfill: existing reviews simply have no remark.

Revision ID: b9f3c1a7d2e8
Revises: b7d9f1a3c2e4
Create Date: 2026-06-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b9f3c1a7d2e8"
down_revision: Union[str, None] = "b7d9f1a3c2e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "feedback_360_reviews",
        sa.Column("remarks", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("feedback_360_reviews", "remarks")
