"""add_goal_soft_delete

Add is_deleted to goals so an owner's delete soft-deletes the goal, preserving
its criteria + self/mentor review history instead of hard-deleting (which
cascaded those rows away). server_default backfills existing rows to
is_deleted=false. batch_alter_table keeps it portable across SQLite/Postgres.

Revision ID: d5e8c1f93a27
Revises: c9a2f4b81e30
Create Date: 2026-06-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d5e8c1f93a27"
down_revision: Union[str, None] = "c9a2f4b81e30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("goals") as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_deleted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("goals") as batch_op:
        batch_op.drop_column("is_deleted")
