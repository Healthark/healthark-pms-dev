"""add_generic_notifications

Introduces the generic `notifications` table — per-recipient, polymorphic,
two categories (personal | announcement) — that powers cross-module in-app +
email notifications, and drops the goal-specific `goal_notifications` table it
supersedes.

`goal_notifications` had NO create-path in application code (only the seed
ever referenced it), so there is nothing to migrate forward. The downgrade
recreates it verbatim (from e5f4a2c91d38) for full reversibility.

Revision ID: f4d2a9c7b318
Revises: e7c1b3f6a982
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4d2a9c7b318"
down_revision: Union[str, None] = "e7c1b3f6a982"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("recipient_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column(
            "category", sa.String(), nullable=False, server_default="personal"
        ),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("link", sa.String(), nullable=True),
        sa.Column("entity_type", sa.String(), nullable=True),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column(
            "is_read", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["recipient_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_id", "notifications", ["id"])
    op.create_index(
        "ix_notifications_recipient_read",
        "notifications",
        ["recipient_id", "is_read"],
    )
    op.create_index(
        "ix_notifications_recipient_cat_created",
        "notifications",
        ["recipient_id", "category", "created_at"],
    )
    op.create_index("ix_notifications_org", "notifications", ["org_id"])

    # Drop the superseded goal-specific table (no application create-path).
    op.drop_index(
        "ix_goal_notifications_recipient_read", table_name="goal_notifications"
    )
    op.drop_index("ix_goal_notifications_id", table_name="goal_notifications")
    op.drop_table("goal_notifications")


def downgrade() -> None:
    # Recreate goal_notifications exactly as e5f4a2c91d38 defined it.
    op.create_table(
        "goal_notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("recipient_id", sa.Integer(), nullable=False),
        sa.Column("sender_id", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "is_read", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["recipient_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_goal_notifications_id", "goal_notifications", ["id"])
    op.create_index(
        "ix_goal_notifications_recipient_read",
        "goal_notifications",
        ["recipient_id", "is_read"],
    )

    op.drop_index("ix_notifications_org", table_name="notifications")
    op.drop_index(
        "ix_notifications_recipient_cat_created", table_name="notifications"
    )
    op.drop_index("ix_notifications_recipient_read", table_name="notifications")
    op.drop_index("ix_notifications_id", table_name="notifications")
    op.drop_table("notifications")
