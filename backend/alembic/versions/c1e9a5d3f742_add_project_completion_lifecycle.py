"""add_project_completion_lifecycle

Adds the project-completion lifecycle columns on ``projects``:
    - ``status``           — "active" (default) or "completed"
    - ``completed_at``     — UTC timestamp set when the admin marks complete
    - ``completed_by_id``  — FK to the admin who marked it complete

Re-open clears the latter two and flips ``status`` back to "active".

This migration deliberately does NOT touch ``project_assignments`` — the
team list is preserved across complete/reopen (see plan D1). Filtering
of completed projects in the review queues lives at the route layer.

Revision ID: c1e9a5d3f742
Revises: 8ce49ca8be6a
Create Date: 2026-05-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c1e9a5d3f742"
down_revision: Union[str, None] = "8ce49ca8be6a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(
            sa.Column(
                "status",
                sa.String(),
                nullable=False,
                server_default="active",
            ),
        )
        batch_op.add_column(
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        batch_op.add_column(
            sa.Column("completed_by_id", sa.Integer(), nullable=True),
        )
        batch_op.create_foreign_key(
            "fk_projects_completed_by_id_users",
            "users",
            ["completed_by_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_constraint(
            "fk_projects_completed_by_id_users", type_="foreignkey",
        )
        batch_op.drop_column("completed_by_id")
        batch_op.drop_column("completed_at")
        batch_op.drop_column("status")
