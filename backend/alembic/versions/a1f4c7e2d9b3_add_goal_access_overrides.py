"""add_goal_access_overrides

Introduces `goal_access_overrides` — a per-employee exception to the org-wide,
per-half annual-goal edit gate. One row per (org_id, user_id, period_label)
carrying:

    - allow_create  (may add new annual goals for that half)
    - allow_edit    (may edit draft/changes-requested goals for that half)

plus grant/revoke audit columns (granted_by_id/granted_at,
revoked_by_id/revoked_at). Default-deny: with no active row an employee is
bound by the org-wide per-half gate exactly as before, so this migration is
purely additive (no backfill).

Revision ID: a1f4c7e2d9b3
Revises: e3d7a1c9f482
Create Date: 2026-06-30
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1f4c7e2d9b3"
down_revision: Union[str, None] = "e3d7a1c9f482"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "goal_access_overrides",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("period_label", sa.String(), nullable=False),
        sa.Column(
            "allow_create",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "allow_edit",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("granted_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column("revoked_by_id", sa.Integer(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["granted_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["revoked_by_id"], ["users.id"]),
        sa.UniqueConstraint(
            "org_id", "user_id", "period_label", name="uq_goal_access_org_user_period"
        ),
    )
    op.create_index(
        "ix_goal_access_overrides_org_id",
        "goal_access_overrides",
        ["org_id"],
        unique=False,
    )
    op.create_index(
        "ix_goal_access_overrides_user_id",
        "goal_access_overrides",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_goal_access_overrides_user_id", table_name="goal_access_overrides"
    )
    op.drop_index(
        "ix_goal_access_overrides_org_id", table_name="goal_access_overrides"
    )
    op.drop_table("goal_access_overrides")
