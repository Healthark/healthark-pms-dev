"""
GoalSelfReview Model — Per-half self-reflection on an approved yearly goal.

A yearly goal has an FY scope (e.g. FY 2026), and within that FY the
employee is expected to reflect on their own delivery TWICE: once for
the first half (H1) and once for the second half (H2).  Each half is a
separate, one-shot submission captured here.

Relationship:
    Goal 1 ─ 0..2 ─ GoalSelfReview   (keyed by cycle_half)

Uniqueness:
    (goal_id, cycle_half) — at most one row per half per goal.
"""

import enum

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database import Base


class SelfReviewCycleHalf(str, enum.Enum):
    """Which half of the fiscal year this self-review covers."""
    H1 = "H1"
    H2 = "H2"


class GoalSelfReview(Base):
    __tablename__ = "goal_self_reviews"

    id         = Column(Integer, primary_key=True, index=True)
    goal_id    = Column(
        Integer,
        ForeignKey("goals.id", ondelete="CASCADE"),
        nullable=False,
    )
    org_id     = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    # "H1" or "H2" — which half of the goal's fiscal year this review covers.
    cycle_half = Column(String, nullable=False)

    # Stamped once at submission; the presence of this row (and its
    # timestamp) is the single source of truth for "submitted for this half".
    submitted_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # 8 competency responses — all required at submission time.
    self_desc_task_execution      = Column(Text, nullable=False)
    self_desc_ownership           = Column(Text, nullable=False)
    self_desc_client_deliverables = Column(Text, nullable=False)
    self_desc_communication       = Column(Text, nullable=False)
    self_desc_project_management  = Column(Text, nullable=False)
    self_desc_mentoring           = Column(Text, nullable=False)
    self_desc_firm_growth         = Column(Text, nullable=False)
    self_desc_competency_skills   = Column(Text, nullable=False)

    __table_args__ = (
        # A goal can have at most one submission per half.  Enforcing at
        # the DB layer keeps accidental double-submits out even if route
        # logic regresses.
        Index(
            "ix_goal_self_review_unique",
            "goal_id",
            "cycle_half",
            unique=True,
        ),
    )

    goal = relationship("Goal", back_populates="self_reviews")
