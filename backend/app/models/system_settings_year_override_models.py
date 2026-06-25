"""
SystemSettingsYearOverride — Per-Fiscal-Year Access Configuration.

This table holds one row per `(org_id, period_label)` for the access-control
toggles. A PERIOD is either a fiscal year ("FY26-27") or a half ("H1 FY26-27"):

    - Annual-review flags (reviewed once a year) are keyed per FISCAL YEAR:
      annual_reviews_enabled, annual_review_final_rating_visible,
      management_review_enabled.
    - Goal + project-review flags (reviewed twice a year) are keyed per HALF:
      annual_goals_edit_enabled, annual_goals_final_rating_visible,
      project_ratings_visible.

(Each row physically carries all six columns; only the flags relevant to its
period type are read — see FY_OVERRIDE_FLAGS / HALF_OVERRIDE_FLAGS in
cycle_utils.)

Lookup convention: gating helpers call `get_year_override(org_id, period_label)`
with the FY label (review gates) or the half label (goal/project gates).
Missing row = default-deny; past-period reads still pass through per the legacy
visibility semantics.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class SystemSettingsYearOverride(Base):
    __tablename__ = "system_settings_year_overrides"

    id = Column(Integer, primary_key=True, index=True)

    # ── Multi-Tenancy ────────────────────────────────────────────────
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)

    # ── Period Key ───────────────────────────────────────────────────
    # A bare-FY label ("FY26-27") for annual-review flags, OR a half label
    # ("H1 FY26-27") for goal/project flags. Annual-review rows resolve the FY
    # via `_fy_label_of_review`; goal/project rows resolve the half via
    # `_half_label_of_goal` / `_half_label_of_project_review` in `cycle_utils`.
    period_label = Column(String, nullable=False)

    # ── Access Control Toggles (per year) ────────────────────────────
    # Gate: state-changing annual review endpoints (submit self-review,
    # mentor eval, management rating) check this for the review's FY.
    annual_reviews_enabled = Column(Boolean, default=False, nullable=False)
    # Visibility: final_performance_rating exposure to the employee.
    # Past-FY reads ignore this and always show the rating.
    annual_review_final_rating_visible = Column(Boolean, default=False, nullable=False)
    # Gate: annual goal create/edit endpoints check this for the goal's FY.
    annual_goals_edit_enabled = Column(Boolean, default=False, nullable=False)
    # Visibility: project_review.performance_group exposure to the rated
    # employee. Past-FY reads always pass through.
    project_ratings_visible = Column(Boolean, default=False, nullable=False)
    # Visibility: a goal's submitted mentor reviews exposure to the mentee
    # (goal-side equivalent of annual_review_final_rating_visible). Drafts are
    # never shown regardless; past-FY reads always pass through.
    annual_goals_final_rating_visible = Column(Boolean, default=False, nullable=False)
    # Gate: the management-rating publish (calibration stage) checks this for
    # the review's FY. Separate from annual_reviews_enabled so calibration can
    # open AFTER the employee/mentor window closes. Default-deny.
    management_review_enabled = Column(Boolean, default=False, nullable=False)

    # ── Audit Trail ──────────────────────────────────────────────────
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Constraints ──────────────────────────────────────────────────
    __table_args__ = (
        # Exactly one override row per (org, period) — the lookup contract.
        UniqueConstraint("org_id", "period_label", name="uq_settings_year_org_fy"),
    )

    # ── Relationships ────────────────────────────────────────────────
    organization = relationship("Organization")
    updated_by = relationship("User", foreign_keys=[updated_by_id])
