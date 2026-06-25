"""rename year-override fy_label to period_label

The per-FY override table now holds one row per PERIOD — an FY label
("FY26-27") for the annual-review flags, OR a half label ("H1 FY26-27") for the
goal/project flags (reviewed twice a year). Rename the key column accordingly.

No data migration: existing FY rows keep their annual-review flags; goal/project
access is default-deny (no half rows yet) until an Admin opens each half.

Revision ID: e3d7a1c9f482
Revises: d7b2f9c4e185
Create Date: 2026-06-24
"""
from typing import Sequence, Union

from alembic import op

revision: str = "e3d7a1c9f482"
down_revision: Union[str, None] = "d7b2f9c4e185"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("system_settings_year_overrides") as batch_op:
        batch_op.alter_column("fy_label", new_column_name="period_label")


def downgrade() -> None:
    with op.batch_alter_table("system_settings_year_overrides") as batch_op:
        batch_op.alter_column("period_label", new_column_name="fy_label")
