"""
Competency Model — per (department, level) competency definitions.

Replaces the fixed 7–8 competency slots that were hard-coded as columns on
RoleExpectation (``exp_*``) and ProjectReview (``comment_*``). Each department
can now define its own competency set per level (``Designation.level``), so the
expectations framework and the project-review form adapt to the reviewee's
department and level.

Rows with ``department_id`` and ``level`` NULL are the ORG DEFAULT set — the
fallback used for any (department, level) that has not defined its own
framework. This is the current 7–8 competencies, seeded on migration, so every
un-migrated department keeps the exact framework it has today.

Soft-deleted (``is_deleted``) rather than hard-deleted: historical reviews and
expectation rows store competency ids inside a JSON blob, so a removed
competency must still resolve its label when an old review is rendered.

NOTE (additive foundation): this table and the backfilled JSON columns exist
but are not yet wired into the live read/write flows — the existing ``exp_*`` /
``comment_*`` columns still drive every current surface. The cutover to
reading/writing the dynamic set happens in a follow-up.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Competency(Base):
    __tablename__ = "competencies"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)

    # NULL department_id + NULL level = the org-wide DEFAULT set (the fallback
    # for any (department, level) that has not defined its own competencies).
    department_id = Column(
        Integer, ForeignKey("departments.id"), nullable=True, index=True
    )
    level = Column(Integer, nullable=True)  # matches Designation.level (1..9)

    key = Column(String, nullable=False)      # stable slug — seed + backfill join key
    label = Column(String, nullable=False)
    display_order = Column(Integer, nullable=False, default=0)

    # Whether the PM writes a per-competency comment on this in a project
    # review. Expectation-only competencies (e.g. firm_growth today) are
    # is_reviewable=False — they appear in the expectations panel but not as a
    # comment box on the review form.
    is_reviewable = Column(Boolean, nullable=False, default=True)
    is_deleted = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        # Lookup by (org, department, level). No DB unique index on
        # (…, key): NULL department_id/level (the default set) makes unique
        # indexes behave inconsistently across Postgres and SQLite. Uniqueness
        # is instead a property of the writers — the one-time migration seed
        # inserts each key exactly once, and the future seed/admin management
        # path will get-or-create by (org, department, level, key).
        Index(
            "ix_competency_org_dept_level",
            "org_id", "department_id", "level",
        ),
    )

    organization = relationship("Organization")
    department = relationship("Department")
