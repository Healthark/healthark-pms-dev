"""drop_dead_goal_self_desc_columns

The original goal self-review design (migration c7f1a5b92e04) stored 8
``self_desc_*`` columns + ``self_review_submitted_at`` directly on the
``goals`` table. The self-review data later moved to the dedicated
``goal_self_reviews`` table (the split + b6e3a9d4 collapse migrations),
leaving those 9 columns on ``goals`` unused — no model, schema, or route
references them.

The drop is guarded by an inspector: only columns that actually exist are
dropped. A from-scratch migrate carries all 9 (and drops them here); a DB
rebuilt via create_all never had them (no-op). batch_alter_table keeps it
portable (SQLite/PG).

Revision ID: a3c8e1f0b942
Revises: f7a1c4d92b65
Create Date: 2026-06-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a3c8e1f0b942"
down_revision: Union[str, None] = "f7a1c4d92b65"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEAD_COLUMNS = (
    "self_desc_task_execution",
    "self_desc_ownership",
    "self_desc_client_deliverables",
    "self_desc_communication",
    "self_desc_project_management",
    "self_desc_mentoring",
    "self_desc_firm_growth",
    "self_desc_competency_skills",
    "self_review_submitted_at",
)


def upgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("goals")}
    to_drop = [c for c in _DEAD_COLUMNS if c in existing]
    if not to_drop:
        return
    with op.batch_alter_table("goals") as batch_op:
        for col in to_drop:
            batch_op.drop_column(col)


def downgrade() -> None:
    with op.batch_alter_table("goals") as batch_op:
        batch_op.add_column(
            sa.Column("self_review_submitted_at", sa.DateTime(timezone=True), nullable=True)
        )
        for col in _DEAD_COLUMNS[:-1]:
            batch_op.add_column(sa.Column(col, sa.Text(), nullable=True))
