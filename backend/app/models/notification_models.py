"""
Notification Model — Generic cross-module in-app + email notifications.

Supersedes the goal-specific GoalNotification with a polymorphic, per-recipient
row used by every module (goals, reviews, projects, mentoring) and by org-wide
announcements. One row per recipient — fan-out to N users = N rows.

Two categories, surfaced as separate tabs in the Topbar bell:
    - PERSONAL:      events targeted at one user ("your goal was approved",
                     "your review awaits your mentor", …). May carry an actor.
    - ANNOUNCEMENT:  system-wide / admin broadcasts ("goal submission is open",
                     the new-financial-year reminder). actor_id is typically
                     null.

`entity_type`/`entity_id` are a deliberately FK-less polymorphic reference:
notifications outlive the rows they point at, and a deleted entity simply
yields a dead deep-link the frontend already tolerates.
"""

import enum

from sqlalchemy import (
    Boolean,
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

# How long a stored notification lives before it's eligible for automatic
# removal. Enforced two ways (no scheduler exists): a lazy purge on the
# Topbar-summary read path, and a reusable CLI (app.scripts.purge_notifications)
# that can be wired to cron. Both import this single source of truth.
NOTIFICATION_RETENTION_DAYS = 100


class NotificationCategory(str, enum.Enum):
    """Which Topbar tab a notification belongs to."""
    PERSONAL = "personal"
    ANNOUNCEMENT = "announcement"


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)

    # The user who sees this notification. Fan-out = one row per recipient.
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # The user whose action triggered it. NULL for system / announcement rows
    # (and intentionally NULL for any anonymity-sensitive source).
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # 'personal' | 'announcement' — see NotificationCategory.
    category = Column(
        String, nullable=False, default=NotificationCategory.PERSONAL.value
    )
    # Stable machine key for the event, e.g. "goal_approved", "mentor_reassigned".
    type = Column(String, nullable=False)

    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    # Relative in-app deep-link, e.g. "/annual-goals?tab=team". Null = no nav.
    # Emails prefix this with APP_BASE_URL.
    link = Column(String, nullable=True)

    # FK-less polymorphic reference to the originating row (goal / annual_review
    # / project / user). No FK on purpose — notifications must survive their
    # source being deleted.
    entity_type = Column(String, nullable=True)
    entity_id = Column(Integer, nullable=True)

    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    recipient = relationship("User", foreign_keys=[recipient_id])
    actor = relationship("User", foreign_keys=[actor_id])

    __table_args__ = (
        # Hot path: "my unread notifications".
        Index("ix_notifications_recipient_read", "recipient_id", "is_read"),
        # The Topbar summary: newest-first slice per (recipient, tab).
        Index(
            "ix_notifications_recipient_cat_created",
            "recipient_id",
            "category",
            "created_at",
        ),
        Index("ix_notifications_org", "org_id"),
    )
