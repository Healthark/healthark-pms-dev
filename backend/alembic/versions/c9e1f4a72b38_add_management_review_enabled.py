"""add_management_review_enabled

Add a per-FY `management_review_enabled` toggle, decoupling the Management
Review (calibration) stage from `annual_reviews_enabled`. Calibration usually
opens AFTER the employee/mentor submission window closes, so the management-
rating publish is gated by this independent flag.

Added to both `system_settings` (base row — from_attributes fallback + override
seed source) and the per-FY `system_settings_year_overrides` table. Existing
rows backfill to false (default-deny — an Admin opens the management-review
window per fiscal year). batch_alter_table keeps it portable (SQLite/Postgres).

Revision ID: c9e1f4a72b38
Revises: a3c8e1f0b942
Create Date: 2026-06-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9e1f4a72b38"
down_revision: Union[str, None] = "a3c8e1f0b942"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("system_settings", "system_settings_year_overrides")


def upgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(
                sa.Column(
                    "management_review_enabled",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )


def downgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_column("management_review_enabled")
