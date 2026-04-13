"""
Project Review Models — Self-Assessment and Multi-Evaluator Feedback.

Two models:
    ProjectReview          — Employee's self-review per project per cycle
                             with 8 competency self-descriptions
    ProjectReviewEvaluator — One row per evaluator per review
                             Primary: 8 comment columns + performance_group + impact_statement
                             Secondary/Peer: impact_statement only

Workflow:
    1. Employee creates self-review (Draft) → fills 8 competencies → Submits
    2. Primary Evaluator sees self-descriptions side-by-side, writes 8 comments
       + performance_group + impact_statement → Submits
       Employee can now see Primary's feedback.
    3. Secondary/Peer write impact_statement only → Submit independently
       Their feedback appears as bonus once Primary has submitted.

8 Competencies:
    1. Task Execution & Problem Solving
    2. Ownership & Accountability
    3. Project Management and Risk Mitigation
    4. Building Client-Ready Deliverables
    5. Communication & Client/Stakeholder Management
    6. Mentoring and Team Development
    7. Firm Growth
    8. Competency and Skills
"""

from enum import Enum as PyEnum
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class ProjectReviewStatus(str, PyEnum):
    """Self-review has only two states — no Approved state."""
    DRAFT = "draft"
    SUBMITTED = "submitted"


class EvaluatorStatus(str, PyEnum):
    """Each evaluator's submission status."""
    DRAFT = "draft"
    SUBMITTED = "submitted"


class PerformanceGroup(str, PyEnum):
    """Fixed list of performance group labels assigned by the Primary evaluator."""
    NEEDS_IMPROVEMENT = "Needs Improvement"
    MEETING_EXPECTATIONS = "Meeting Expectations"
    EXCEEDING_EXPECTATIONS = "Exceeding Expectations"
    MEETING_HIGH_EXPECTATIONS = "Meeting High Expectations"
    EXCEEDING_HIGH_EXPECTATIONS = "Exceeding High Expectations"


class ProjectReview(Base):
    __tablename__ = "project_reviews"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    cycle = Column(String, nullable=False)  # e.g. "H1 FY26"

    status = Column(String, default=ProjectReviewStatus.DRAFT.value, nullable=False)

    # ── 8 Competency Self-Descriptions ───────────────────────────────
    self_desc_task_execution = Column(Text, nullable=True)
    self_desc_ownership = Column(Text, nullable=True)
    self_desc_project_management = Column(Text, nullable=True)
    self_desc_client_deliverables = Column(Text, nullable=True)
    self_desc_communication = Column(Text, nullable=True)
    self_desc_mentoring = Column(Text, nullable=True)
    self_desc_firm_growth = Column(Text, nullable=True)
    self_desc_competency_skills = Column(Text, nullable=True)

    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        # One review per employee per project per cycle
        Index(
            "ix_project_reviews_org_user_proj_cycle",
            "org_id", "user_id", "project_id", "cycle",
            unique=True,
        ),
    )

    # Relationships
    organization = relationship("Organization")
    employee = relationship("User", foreign_keys=[user_id])
    project = relationship("Project")
    evaluators = relationship(
        "ProjectReviewEvaluator",
        back_populates="review",
        cascade="all, delete-orphan",
        order_by="ProjectReviewEvaluator.created_at",
    )


class ProjectReviewEvaluator(Base):
    __tablename__ = "project_review_evaluators"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    project_review_id = Column(
        Integer,
        ForeignKey("project_reviews.id", ondelete="CASCADE"),
        nullable=False,
    )
    evaluator_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Primary, Secondary, or Peer
    evaluator_type = Column(String, nullable=False)

    status = Column(String, default=EvaluatorStatus.DRAFT.value, nullable=False)

    # ── Primary Evaluator Fields ─────────────────────────────────────
    # Performance group — only set by Primary
    performance_group = Column(String, nullable=True)

    # Impact statement — used by ALL evaluator types
    impact_statement = Column(Text, nullable=True)

    # 8 Comment columns — only used by Primary evaluator
    # Secondary/Peer leave these null (they only write impact_statement)
    comment_task_execution = Column(Text, nullable=True)
    comment_ownership = Column(Text, nullable=True)
    comment_project_management = Column(Text, nullable=True)
    comment_client_deliverables = Column(Text, nullable=True)
    comment_communication = Column(Text, nullable=True)
    comment_mentoring = Column(Text, nullable=True)
    comment_firm_growth = Column(Text, nullable=True)
    comment_competency_skills = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        # One evaluation per evaluator per review
        Index(
            "ix_pr_evaluators_review_evaluator",
            "project_review_id", "evaluator_id",
            unique=True,
        ),
    )

    # Relationships
    review = relationship("ProjectReview", back_populates="evaluators")
    evaluator = relationship("User", foreign_keys=[evaluator_id])