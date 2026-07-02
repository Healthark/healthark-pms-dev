"""add_project_is_billable

Adds a boolean `is_billable` column to `projects`, sourced from Keka's
`isBillable` flag. Existing rows backfill to False via the server default
(non-destructive — no wipe/reseed needed); a separate one-off script then
sets the real per-project value by code. Informational for now; surfaced in
the per-employee review-scope admin tab.

Revision ID: e7c2a9f14d63
Revises: c2d9f4a18b7e
Create Date: 2026-07-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e7c2a9f14d63"
down_revision: Union[str, None] = "c2d9f4a18b7e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projects", schema=None) as batch:
        batch.add_column(
            sa.Column(
                "is_billable",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("projects", schema=None) as batch:
        batch.drop_column("is_billable")
