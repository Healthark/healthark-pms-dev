from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index, Text, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum

# Architect Note: We use a strict Enum so the database rejects invalid states
class GoalStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class Goal(Base):
    __tablename__ = "goals"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    
    # The employee who owns this goal
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # The mentor/manager who approved or assigned it (Optional)
    manager_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    
    status = Column(String, default=GoalStatus.PENDING.value, nullable=False)
    
    start_date = Column(DateTime(timezone=True), nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Multi-Tenant Performance Index
    __table_args__ = (
        Index("ix_goals_org_user", "org_id", "user_id"),
    )

    owner = relationship("User", foreign_keys=[user_id], backref="goals")
    manager = relationship("User", foreign_keys=[manager_id])