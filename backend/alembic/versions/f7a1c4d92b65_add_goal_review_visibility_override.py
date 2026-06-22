"""add_goal_review_visibility_override

Add annual_goals_final_rating_visible to the per-FY override table so the goal
mentor-review embargo (the mentee sees a goal's mentor reviews only once
published) can be configured per fiscal year — mirroring
annual_review_final_rating_visible. The column already exists on system_settings
(legacy, previously unwired); this adds the per-FY override and backfills
existing rows to false. batch_alter_table keeps it portable (SQLite/Postgres).

Revision ID: f7a1c4d92b65
Revises: d5e8c1f93a27
Create Date: 2026-06-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f7a1c4d92b65"
down_revision: Union[str, None] = "d5e8c1f93a27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("system_settings_year_overrides") as batch_op:
        batch_op.add_column(
            sa.Column(
                "annual_goals_final_rating_visible",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("system_settings_year_overrides") as batch_op:
        batch_op.drop_column("annual_goals_final_rating_visible")
