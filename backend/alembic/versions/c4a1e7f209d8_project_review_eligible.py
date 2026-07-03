"""project_review_eligible (drop assignment review_included)

Moves review scoping from per-(employee, project) to per-project. Adds
projects.review_eligible (Boolean NOT NULL DEFAULT true — opt-out; every project
is reviewed until HR unchecks it in the Review Eligibility tab) and drops the
now-superseded project_assignments.review_included.

Revision ID: c4a1e7f209d8
Revises: a3f5c8e21b90
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4a1e7f209d8"
down_revision: Union[str, None] = "a3f5c8e21b90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projects", schema=None) as batch:
        batch.add_column(
            sa.Column(
                "review_eligible",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )
    with op.batch_alter_table("project_assignments", schema=None) as batch:
        batch.drop_column("review_included")


def downgrade() -> None:
    with op.batch_alter_table("project_assignments", schema=None) as batch:
        batch.add_column(
            sa.Column(
                "review_included",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )
    with op.batch_alter_table("projects", schema=None) as batch:
        batch.drop_column("review_eligible")
