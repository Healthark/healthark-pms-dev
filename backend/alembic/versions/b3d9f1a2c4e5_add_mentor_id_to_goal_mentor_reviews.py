"""add mentor_id to goal_mentor_reviews

Records WHICH mentor authored each half's goal mentor-review, snapshotted at
write time. Goal.manager_id tracks the mentee's *current* mentor and is
re-pointed on reassignment, so without this column the earlier half's review
gets silently mis-attributed once a mentee changes mentors mid-cycle.

Nullable + backfilled best-effort from the goal's current manager_id — the only
signal available for rows written before the column existed. New rows are
stamped explicitly by the submit/draft handlers.

Revision ID: b3d9f1a2c4e5
Revises: f2b9c7d4e6a1
Create Date: 2026-07-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b3d9f1a2c4e5"
down_revision: Union[str, None] = "f2b9c7d4e6a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("goal_mentor_reviews", schema=None) as batch:
        batch.add_column(sa.Column("mentor_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_goal_mentor_reviews_mentor_id_users",
            "users",
            ["mentor_id"],
            ["id"],
        )
        batch.create_index("ix_goal_mentor_reviews_mentor_id", ["mentor_id"])

    # Best-effort backfill: attribute existing reviews to the goal's current
    # manager. Imperfect for rows written before a mentor change, but the only
    # historical signal we have; new rows are stamped accurately going forward.
    op.execute(
        """
        UPDATE goal_mentor_reviews AS gmr
        SET mentor_id = g.manager_id
        FROM goals AS g
        WHERE gmr.goal_id = g.id
          AND gmr.mentor_id IS NULL
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("goal_mentor_reviews", schema=None) as batch:
        batch.drop_index("ix_goal_mentor_reviews_mentor_id")
        batch.drop_constraint(
            "fk_goal_mentor_reviews_mentor_id_users", type_="foreignkey"
        )
        batch.drop_column("mentor_id")
