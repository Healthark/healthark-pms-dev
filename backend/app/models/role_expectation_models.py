"""
RoleExpectation Model — Reference Data for PM Evaluations.

Maps Department × Designation to expected behaviors per competency.
Example: Strategy × Consultant → 8 competency expectation paragraphs.

3 Departments (Strategy, IDT, RWE) × 3 Designations (Consultant,
Senior Consultant, Manager) = 9 rows.

The PM sees these expectations as reference context while evaluating
a team member, so they know what "good" looks like for that role.
"""

from sqlalchemy import (
    Column, Integer, DateTime, ForeignKey, Index, JSON
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class RoleExpectation(Base):
    __tablename__ = "role_expectations"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    designation_id = Column(Integer, ForeignKey("designations.id"), nullable=False)

    # ── Dynamic expectations ─────────────────────────────────────────
    # {competency_id: expectation_text}, keyed by Competency.id. Retained as a
    # vestigial column; expectation text now lives on the competency framework
    # (Competency.expectation), which is the source of truth for all read
    # surfaces. The fixed exp_* columns this replaced were dropped (see
    # migration). Nothing reads this today.
    expectations = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        # One expectation row per department × designation per org
        Index(
            "ix_role_exp_org_dept_desig",
            "org_id", "department_id", "designation_id",
            unique=True,
        ),
    )

    # Relationships
    organization = relationship("Organization")
    department = relationship("Department")
    designation = relationship("Designation")