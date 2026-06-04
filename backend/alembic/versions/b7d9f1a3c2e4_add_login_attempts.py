"""add login_attempts

Brute-force throttle ledger for /auth/login. One row per FAILED attempt,
keyed by the submitted (lowercased) email + a sliding-window count. Mirrors
the DB-backed rate-limit approach already used for password resets.

create_table / create_index keep it portable across Postgres (prod) and
SQLite (dev/tests).

Revision ID: b7d9f1a3c2e4
Revises: c3f1a8d29b4e
Create Date: 2026-06-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7d9f1a3c2e4"
down_revision: Union[str, None] = "c3f1a8d29b4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "login_attempts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_login_attempts_email_created",
        "login_attempts",
        ["email", "created_at"],
    )
    op.create_index(op.f("ix_login_attempts_id"), "login_attempts", ["id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_login_attempts_id"), table_name="login_attempts")
    op.drop_index(
        "ix_login_attempts_email_created", table_name="login_attempts"
    )
    op.drop_table("login_attempts")
