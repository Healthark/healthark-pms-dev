"""add_annual_review_mentor_rating_visible

Splits annual-review rating visibility into two independent per-FY gates:
the existing `annual_review_final_rating_visible` now governs ONLY the
management (final) rating, while a new `annual_review_mentor_rating_visible`
governs whether the mentee can see their mentor's rating once the mentor
submits. Both flags are keyed per fiscal year.

Adds the new boolean column (default-deny, False) to both the org-wide
`system_settings` singleton and the per-period `system_settings_year_overrides`
table, mirroring `annual_review_final_rating_visible`. Existing rows backfill
to False via the server default, so the mentor rating stays hidden until an
admin opens it per FY.

Revision ID: c2d9f4a18b7e
Revises: b8e3f1a07c52
Create Date: 2026-07-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2d9f4a18b7e"
down_revision: Union[str, None] = "b8e3f1a07c52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMN = "annual_review_mentor_rating_visible"
_TABLES = ("system_settings", "system_settings_year_overrides")


def upgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table, schema=None) as batch:
            batch.add_column(
                sa.Column(
                    _COLUMN,
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )


def downgrade() -> None:
    for table in reversed(_TABLES):
        with op.batch_alter_table(table, schema=None) as batch:
            batch.drop_column(_COLUMN)
