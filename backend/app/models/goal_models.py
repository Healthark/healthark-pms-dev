from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class ApprovalStatus(str, enum.Enum):
    DRAFT              = "draft"
    SUBMITTED          = "submitted"
    APPROVED           = "approved"
    CHANGES_REQUESTED  = "changes_requested"


class GoalType(str, enum.Enum):
    REGULAR = "regular"
    YEARLY  = "yearly"


class Goal(Base):
    __tablename__ = "goals"

    id         = Column(Integer, primary_key=True, index=True)
    org_id     = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    manager_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    title       = Column(String, nullable=False)
    description = Column(Text, nullable=True)

    # Classifies the goal as a full-year objective or a regular project goal.
    # Yearly goals are created once per FY, gate-controlled by the Admin,
    # and stamped with a cycle_name ("FY26") at creation time.
    goal_type  = Column(String, nullable=False, default=GoalType.REGULAR.value)
    # Bare fiscal-year label stamped at creation for yearly goals, e.g. "FY26".
    # Null for regular goals. Enables future filtering like "all FY26 goals".
    cycle_name     = Column(String, nullable=True)
    # Optional URL to a Google Drive folder or external reference document.
    attachment_url = Column(String, nullable=True)

    # Approval status — controlled by the approval workflow.
    # Progress tracking is driven entirely by criteria completion (progress_percent),
    # so there is no separate employee-controlled progress state.
    approval_status  = Column(String, default=ApprovalStatus.DRAFT.value, nullable=False)
    # Written by the manager when requesting changes; visible to the employee
    manager_feedback = Column(Text, nullable=True)
    # Written by the employee to log progress, proof of completion, etc.
    progress_notes   = Column(Text, nullable=True)

    start_date  = Column(DateTime(timezone=True), nullable=True)
    due_date    = Column(DateTime(timezone=True), nullable=True)
    # Stamped the moment the goal transitions to APPROVED. Null until then.
    # Enables filtering like "goals approved in H1 FY26" for future dashboards.
    approved_at = Column(DateTime(timezone=True), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        Index("ix_goals_org_user", "org_id", "user_id"),
        # Supports future filtered queries: "all FY26 yearly goals for this org"
        Index("ix_goals_org_type_cycle", "org_id", "goal_type", "cycle_name"),
    )

    owner   = relationship("User", foreign_keys=[user_id], backref="goals")
    manager = relationship("User", foreign_keys=[manager_id])

    criteria = relationship(
        "GoalCriterion",
        back_populates="goal",
        cascade="all, delete-orphan",
        order_by="GoalCriterion.sort_order",
        lazy="joined",
    )

    # 0..2 self-reviews per goal (one per fiscal-year half).
    # Always loaded together — they are small and the UI renders both rows
    # in the H1 / H2 cycle dropdown every time a goal card is shown.
    self_reviews = relationship(
        "GoalSelfReview",
        back_populates="goal",
        cascade="all, delete-orphan",
        order_by="GoalSelfReview.cycle_half",
        lazy="joined",
    )

    # 0..2 mentor reviews per goal — one per fiscal-year half, submitted by
    # the mentor after reading the mentee's corresponding self-review.
    mentor_reviews = relationship(
        "GoalMentorReview",
        back_populates="goal",
        cascade="all, delete-orphan",
        order_by="GoalMentorReview.cycle_half",
        lazy="joined",
    )

    @property
    def manager_name(self):
        """
        Display name of the mentor this goal was routed to at creation time.
        None when the goal owner has no mentor assigned — the frontend
        renders that as "No Mentor Assigned".
        """
        return self.manager.full_name if self.manager else None