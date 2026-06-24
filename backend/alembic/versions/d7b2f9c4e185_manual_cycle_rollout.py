"""manual_cycle_rollout: drop simulated_today, add cycle_rollout_log

The active cycle is now an admin-advanced stored value (manual roll-out), so
cycle/FY are no longer derived from the calendar. The date-simulation escape
hatch is therefore obsolete — drop `system_settings.simulated_today`. Add the
`cycle_rollout_log` audit table (one row per roll-out / manual set).

Revision ID: d7b2f9c4e185
Revises: c9e1f4a72b38
Create Date: 2026-06-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d7b2f9c4e185"
down_revision: Union[str, None] = "c9e1f4a72b38"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cycle_rollout_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("from_cycle", sa.String(), nullable=False),
        sa.Column("to_cycle", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("rolled_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["rolled_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_cycle_rollout_log_id"), "cycle_rollout_log", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_cycle_rollout_log_org_id"),
        "cycle_rollout_log",
        ["org_id"],
        unique=False,
    )

    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.drop_column("simulated_today")


def downgrade() -> None:
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.add_column(sa.Column("simulated_today", sa.Date(), nullable=True))
    op.drop_index(op.f("ix_cycle_rollout_log_org_id"), table_name="cycle_rollout_log")
    op.drop_index(op.f("ix_cycle_rollout_log_id"), table_name="cycle_rollout_log")
    op.drop_table("cycle_rollout_log")
