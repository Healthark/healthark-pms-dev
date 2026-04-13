from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class GoalStatus(str, enum.Enum):
    PENDING     = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED   = "completed"
    CANCELLED   = "cancelled"


class ApprovalStatus(str, enum.Enum):
    DRAFT              = "draft"
    SUBMITTED          = "submitted"
    APPROVED           = "approved"
    CHANGES_REQUESTED  = "changes_requested"


class Goal(Base):
    __tablename__ = "goals"

    id         = Column(Integer, primary_key=True, index=True)
    org_id     = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    manager_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    title       = Column(String, nullable=False)
    description = Column(Text, nullable=True)

    # Progress status — controlled by the employee
    status = Column(String, default=GoalStatus.PENDING.value, nullable=False)

    # Approval status — controlled by the approval workflow
    approval_status  = Column(String, default=ApprovalStatus.DRAFT.value, nullable=False)
    # Written by the manager when requesting changes; visible to the employee
    manager_feedback = Column(Text, nullable=True)
    # Written by the employee to log progress, proof of completion, etc.
    progress_notes   = Column(Text, nullable=True)

    start_date = Column(DateTime(timezone=True), nullable=True)
    due_date   = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        Index("ix_goals_org_user", "org_id", "user_id"),
    )

    owner   = relationship("User", foreign_keys=[user_id], backref="goals")
    manager = relationship("User", foreign_keys=[manager_id])

    # Add this relationship inside the Goal class, after the existing relationships:
    criteria = relationship(
        "GoalCriterion",
        back_populates="goal",
        cascade="all, delete-orphan",
        order_by="GoalCriterion.sort_order",
        lazy="joined",  # Eagerly load criteria with every goal query
    )