"""
GoalMentorReview Model — Mentor's per-half assessment of a mentee's self-review.

After a mentee submits their self-review for H1 or H2, their assigned mentor
fills in a single freeform paragraph reflecting on the mentee's delivery
that half. Firm Growth and Competency & Skills role expectations are
surfaced on the form as reference, not as separate input fields.

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
    Boolean,
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

    # The mentor who actually authored THIS half's review, snapshotted at
    # write time. Distinct from Goal.manager_id, which tracks the mentee's
    # *current* mentor and is re-pointed on reassignment — so once a mentee
    # changes mentors mid-cycle, this column is the only record of who wrote
    # the earlier half's review. Nullable: legacy rows predate the column
    # (backfilled best-effort from the goal's manager_id) and a review can
    # exist without a resolvable author.
    mentor_id  = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )

    submitted_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Single freeform paragraph mirroring the mentee's self-review shape.
    # Replaces the previous 8 per-competency mentor_comment_* columns.
    mentor_overall_review = Column(Text, nullable=False)

    # When True, the mentor has saved a draft but hasn't submitted yet.
    # Mentees don't see draft rows — only the final submission. Submit
    # flips this to False and advances the goal's approval_status.
    is_draft = Column(Boolean, default=False, nullable=False)

    __table_args__ = (
        Index(
            "ix_goal_mentor_review_unique",
            "goal_id",
            "cycle_half",
            unique=True,
        ),
    )

    goal = relationship("Goal", back_populates="mentor_reviews")
    mentor = relationship("User", foreign_keys=[mentor_id])

    @property
    def mentor_name(self):
        """Display name of the mentor who authored this half's review, or None
        for legacy rows with no resolvable author."""
        return self.mentor.full_name if self.mentor else None
