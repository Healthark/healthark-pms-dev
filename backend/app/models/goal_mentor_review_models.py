"""
GoalMentorReview Model — Mentor's per-half assessment of a mentee's self-review.

After a mentee submits their self-review for H1 or H2, their assigned mentor
fills in a corresponding mentor review covering the same 8 competencies.

Relationship:
    Goal 1 ─ 0..2 ─ GoalMentorReview   (keyed by cycle_half, same as GoalSelfReview)

Uniqueness:
    (goal_id, cycle_half) — at most one mentor review per half per goal.
"""

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


class GoalMentorReview(Base):
    __tablename__ = "goal_mentor_reviews"

    id         = Column(Integer, primary_key=True, index=True)
    goal_id    = Column(
        Integer,
        ForeignKey("goals.id", ondelete="CASCADE"),
        nullable=False,
    )
    org_id     = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    cycle_half = Column(String, nullable=False)  # "H1" or "H2"

    submitted_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # 8 mentor comment fields — mirror the 8 self_desc_* columns on GoalSelfReview.
    mentor_comment_task_execution      = Column(Text, nullable=False)
    mentor_comment_ownership           = Column(Text, nullable=False)
    mentor_comment_client_deliverables = Column(Text, nullable=False)
    mentor_comment_communication       = Column(Text, nullable=False)
    mentor_comment_project_management  = Column(Text, nullable=False)
    mentor_comment_mentoring           = Column(Text, nullable=False)
    mentor_comment_firm_growth         = Column(Text, nullable=False)
    mentor_comment_competency_skills   = Column(Text, nullable=False)

    __table_args__ = (
        Index(
            "ix_goal_mentor_review_unique",
            "goal_id",
            "cycle_half",
            unique=True,
        ),
    )

    goal = relationship("Goal", back_populates="mentor_reviews")
