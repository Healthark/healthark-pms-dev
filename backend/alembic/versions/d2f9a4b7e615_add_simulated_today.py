"""add_simulated_today

Adds the Date Simulation column on `system_settings`. When non-null,
cycle/review-window code treats this date as "today" instead of the real
wall date. Gated by the ALLOW_DATE_SIMULATION env flag at the API layer.

New column on `system_settings`:
    simulated_today — Optional[date]; NULL = no simulation (default)

Revision ID: d2f9a4b7e615
Revises: c1e9a5d3f742
Create Date: 2026-05-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d2f9a4b7e615"
down_revision: Union[str, None] = "c1e9a5d3f742"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.add_column(
            sa.Column("simulated_today", sa.Date(), nullable=True),
        )


def downgrade() -> None:
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.drop_column("simulated_today")
