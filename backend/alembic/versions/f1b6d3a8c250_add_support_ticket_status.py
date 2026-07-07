"""add support ticket status

Adds ``support_tickets.status`` — the admin-managed lifecycle (pending /
in_progress / completed) surfaced + edited in the Responses queue. Additive:
``NOT NULL DEFAULT 'pending'`` backfills existing rows, and a CHECK constraint
fences the allowed values.

Revision ID: f1b6d3a8c250
Revises: e4a7c2f19b83
Create Date: 2026-07-07
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "f1b6d3a8c250"
down_revision: Union[str, None] = "e4a7c2f19b83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("support_tickets", schema=None) as batch:
        batch.add_column(
            sa.Column(
                "status",
                sa.String(),
                nullable=False,
                server_default="pending",
            )
        )
        batch.create_check_constraint(
            "ck_support_tickets_status",
            "status IN ('pending', 'in_progress', 'completed')",
        )


def downgrade() -> None:
    with op.batch_alter_table("support_tickets", schema=None) as batch:
        batch.drop_constraint("ck_support_tickets_status", type_="check")
        batch.drop_column("status")
