"""
Support ticket models — the in-app "Report an Issue" intake.

Replaces the old Google-Sheet embed on the Support page. Any authenticated
user submits a ticket describing a problem they hit; Admins read the queue
from the Support page's "Responses" view.

Photos are stored inline as base64 data URIs on a child row (one row per
photo) rather than on the ticket itself. Two reasons:
    1. The Responses *list* never needs the blob — it only shows a photo
       count — so keeping photos off the ticket row means the list query
       stays lean (no megabytes of base64 dragged along per row).
    2. The detail view loads the photos for a single ticket on demand.

The deployment has no object storage / persistent disk (Render's FS is
ephemeral), so inlining a size-capped data URI in the DB is the pragmatic
store. Per-photo and per-ticket caps are enforced at the API layer
(app.schemas.support_schemas) so a runaway upload can't bloat the row.

`submitter_name` is snapshotted at submit time: the reporter's account may
be renamed or soft-deleted later, and the Responses queue should still show
who filed the ticket. `user_id` keeps the live link for anything that needs
it (it's nullable-safe via SET NULL should the user ever be hard-deleted).
"""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base

# Ticket lifecycle states. Deliberately a FREE set — an admin can move a
# ticket to any state at any time (not a forced pending→in_progress→completed
# ladder). Stored as a plain string with a CHECK constraint below.
SUPPORT_STATUSES = ("pending", "in_progress", "completed")
DEFAULT_SUPPORT_STATUS = "pending"


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)

    # Reporter. Kept as a live FK for joins, but the queue renders
    # `submitter_name` (snapshot) so a later rename/soft-delete doesn't
    # blank out who filed it.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    submitter_name = Column(String, nullable=False)

    # Where in the app the issue was hit. `pms_page` is the top-level page
    # (e.g. "Annual Goals"); `tab` is the sub-tab within it (e.g. "Team
    # Goals") and is optional — some pages have no sub-tabs. Stored as free
    # strings (the frontend constrains them to the real page/tab set via a
    # dropdown) so adding a page/tab is a UI change with no migration.
    pms_page = Column(String, nullable=False)
    tab = Column(String, nullable=True)

    # The issue itself. `description` is required; `remarks` is an optional
    # extra note.
    description = Column(Text, nullable=False)
    remarks = Column(Text, nullable=True)

    # Admin-managed lifecycle. New tickets start "pending"; an admin can
    # freely set any of SUPPORT_STATUSES from the Responses queue.
    status = Column(
        String,
        nullable=False,
        server_default=DEFAULT_SUPPORT_STATUS,
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    submitter = relationship("User", foreign_keys=[user_id])
    photos = relationship(
        "SupportTicketPhoto",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="SupportTicketPhoto.sort_order",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed')",
            name="ck_support_tickets_status",
        ),
        # Hot path: the admin queue lists a whole org newest-first.
        Index("ix_support_tickets_org_created", "org_id", "created_at"),
    )


class SupportTicketPhoto(Base):
    __tablename__ = "support_ticket_photos"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(
        Integer,
        ForeignKey("support_tickets.id", ondelete="CASCADE"),
        nullable=False,
    )

    # A base64 image data URI ("data:image/png;base64,…"). Size + MIME are
    # validated at the API boundary (SupportPhotoIn); the DB just holds the
    # opaque string.
    data_uri = Column(Text, nullable=False)
    # Original filename, best-effort — used as the download name / alt text.
    filename = Column(String, nullable=True)
    # Preserves the order the user attached them in.
    sort_order = Column(Integer, nullable=False, default=0)

    ticket = relationship("SupportTicket", back_populates="photos")

    __table_args__ = (
        Index("ix_support_ticket_photos_ticket", "ticket_id"),
    )
