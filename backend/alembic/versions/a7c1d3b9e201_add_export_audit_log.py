"""add_export_audit_log

Adds the export_audit_log table that records every HR/management Excel
export. One row is inserted (status='started') before the workbook is
built; the same row is updated to succeeded/failed after streaming.

Revision ID: a7c1d3b9e201
Revises: f6c8e2a01b94
Create Date: 2026-05-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7c1d3b9e201"
down_revision: Union[str, None] = "f6c8e2a01b94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "export_audit_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("export_type", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=False),
        sa.Column("fy_filter", sa.String(), nullable=True),
        sa.Column("target_user_id", sa.Integer(), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.String(),
            server_default=sa.text("'started'"),
            nullable=False,
        ),
        sa.Column("file_name", sa.String(), nullable=True),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("user_agent", sa.String(), nullable=True),
        sa.Column("ip_address", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_export_audit_log_id", "export_audit_log", ["id"])
    op.create_index(
        "ix_export_audit_org_requested",
        "export_audit_log",
        ["org_id", "requested_at"],
    )
    op.create_index(
        "ix_export_audit_org_user",
        "export_audit_log",
        ["org_id", "user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_export_audit_org_user", "export_audit_log")
    op.drop_index("ix_export_audit_org_requested", "export_audit_log")
    op.drop_index("ix_export_audit_log_id", "export_audit_log")
    op.drop_table("export_audit_log")
