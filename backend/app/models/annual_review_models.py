"""
AnnualReview Model — The 3-Stage Performance Appraisal.

Lifecycle:
    Stage 1 — Employee Self-Appraisal:
        Employee fills in self_desc_* columns for 6 core competencies,
        selects a self_stars rating (1–5), and submits.
        Status: DRAFT → PENDING_MENTOR

    Stage 2 — Mentor Evaluation:
        Mentor reviews the employee's self-descriptions side-by-side,
        writes mentor_comment_* for each competency, assigns mentor_stars.
        Status: PENDING_MENTOR → PENDING_MANAGEMENT

    Stage 3 — Management Calibration:
        HR/Leadership reviews both scores, optionally overrides with
        management_stars, sets final_stars, and publishes.
        Status: PENDING_MANAGEMENT → COMPLETED
        (final_rating_enabled flips to True)

Design Decisions:
    - Each competency gets its own column pair (self_desc + mentor_comment)
      rather than a JSON blob. This keeps the schema explicit, queryable,
      and type-safe — no runtime key lookups.
    - cycle_name is denormalized from SystemSettings at creation time so
      the review remains tagged to the correct cycle even if the admin
      rotates the active cycle later.
    - One review per user per cycle is enforced by a composite unique index.
"""

from enum import Enum as PyEnum
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class ReviewStatus(str, PyEnum):
    """Tracks which stage the review is currently in."""
    DRAFT                = "draft"
    PENDING_MENTOR       = "pending_mentor"
    PENDING_MANAGEMENT   = "pending_management"
    COMPLETED            = "completed"


class AnnualReview(Base):
    __tablename__ = "annual_reviews"

    id = Column(Integer, primary_key=True, index=True)

    # ── Multi-Tenancy + Identity ─────────────────────────────────────
    org_id    = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    user_id   = Column(Integer, ForeignKey("users.id"), nullable=False)
    mentor_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # ── Cycle Tag ────────────────────────────────────────────────────
    # Denormalized from SystemSettings at creation time so the review
    # stays tagged to the correct cycle permanently.
    cycle_name = Column(String, nullable=False)  # e.g. "FY26", "H1 FY26"

    # ── Workflow Status ──────────────────────────────────────────────
    status = Column(String, default=ReviewStatus.DRAFT.value, nullable=False)

    # ── Stage 1: Employee Self-Appraisal ─────────────────────────────
    self_desc_ownership        = Column(Text, nullable=True)
    self_desc_productivity     = Column(Text, nullable=True)
    self_desc_communication    = Column(Text, nullable=True)
    self_desc_leadership       = Column(Text, nullable=True)
    self_desc_adaptability     = Column(Text, nullable=True)
    self_desc_time_management  = Column(Text, nullable=True)
    self_stars                 = Column(Integer, nullable=True)  # 1–5

    # ── Stage 2: Mentor Evaluation ───────────────────────────────────
    mentor_comment_ownership       = Column(Text, nullable=True)
    mentor_comment_productivity    = Column(Text, nullable=True)
    mentor_comment_communication   = Column(Text, nullable=True)
    mentor_comment_leadership      = Column(Text, nullable=True)
    mentor_comment_adaptability    = Column(Text, nullable=True)
    mentor_comment_time_management = Column(Text, nullable=True)
    mentor_stars                   = Column(Integer, nullable=True)  # 1–5

    # ── Stage 3: Management Calibration ──────────────────────────────
    management_stars      = Column(Integer, nullable=True)  # Optional override
    final_stars           = Column(Integer, nullable=True)  # The official rating
    management_comments   = Column(Text, nullable=True)     # Calibration notes
    final_rating_enabled  = Column(Boolean, default=False)  # True = visible to employee

    # ── Audit Trail ──────────────────────────────────────────────────
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Constraints ──────────────────────────────────────────────────
    __table_args__ = (
        # One review per employee per cycle — prevents accidental duplicates
        Index("ix_annual_reviews_org_user_cycle", "org_id", "user_id", "cycle_name", unique=True),
    )

    # ── Relationships ────────────────────────────────────────────────
    organization = relationship("Organization")
    employee     = relationship("User", foreign_keys=[user_id])
    mentor       = relationship("User", foreign_keys=[mentor_id])