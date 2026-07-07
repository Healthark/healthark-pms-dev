"""add support tickets (Report an Issue intake)

Introduces the in-app support form that replaces the old Google-Sheet embed:

  1. ``support_tickets`` — one row per submitted issue. `submitter_name` is a
     snapshot of the reporter's name at submit time so the admin queue still
     shows who filed it after a rename / soft-delete. `pms_page` / `tab` are
     free strings (the frontend constrains them to the real page/tab set via a
     dropdown) so adding a page or tab needs no migration.
  2. ``support_ticket_photos`` — 0..N base64 image data URIs per ticket, stored
     inline (this deployment has no object storage). Size/MIME/count are capped
     at the API layer. Kept on a child table so the Responses *list* query can
     skip the blobs and return just a count.

Purely additive — no existing table or flow is touched.

Revision ID: e4a7c2f19b83
Revises: d1f7a2c9e4b6
Create Date: 2026-07-07
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "e4a7c2f19b83"
down_revision: Union[str, None] = "d1f7a2c9e4b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("submitter_name", sa.String(), nullable=False),
        sa.Column("pms_page", sa.String(), nullable=False),
        sa.Column("tab", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_support_tickets_id", "support_tickets", ["id"])
    op.create_index(
        "ix_support_tickets_org_created",
        "support_tickets",
        ["org_id", "created_at"],
    )

    op.create_table(
        "support_ticket_photos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "ticket_id",
            sa.Integer(),
            sa.ForeignKey("support_tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("data_uri", sa.Text(), nullable=False),
        sa.Column("filename", sa.String(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_support_ticket_photos_id", "support_ticket_photos", ["id"])
    op.create_index(
        "ix_support_ticket_photos_ticket",
        "support_ticket_photos",
        ["ticket_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_support_ticket_photos_ticket", table_name="support_ticket_photos")
    op.drop_index("ix_support_ticket_photos_id", table_name="support_ticket_photos")
    op.drop_table("support_ticket_photos")
    op.drop_index("ix_support_tickets_org_created", table_name="support_tickets")
    op.drop_index("ix_support_tickets_id", table_name="support_tickets")
    op.drop_table("support_tickets")
