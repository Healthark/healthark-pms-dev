"""project_assignment_soft_delete

Add soft-delete columns to project_assignments so removing a member from a
project preserves the team-membership record (across review cycles) with an
audit of who removed them and when, instead of hard-deleting the row.

  is_deleted     – false for active members; true once removed
  removed_at     – timestamp of removal
  removed_by_id  – the admin who removed the member (FK users.id)

server_default backfills existing rows to is_deleted=false. batch_alter_table
keeps it portable across Postgres (prod) and SQLite.

Revision ID: c3f1a8d29b4e
Revises: f4d2a9c7b318
Create Date: 2026-06-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3f1a8d29b4e"
down_revision: Union[str, None] = "f4d2a9c7b318"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("project_assignments") as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_deleted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("removed_by_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_project_assignments_removed_by_id_users",
            "users",
            ["removed_by_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("project_assignments") as batch_op:
        batch_op.drop_constraint(
            "fk_project_assignments_removed_by_id_users", type_="foreignkey"
        )
        batch_op.drop_column("removed_by_id")
        batch_op.drop_column("removed_at")
        batch_op.drop_column("is_deleted")
