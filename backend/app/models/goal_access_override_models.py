"""
GoalAccessOverride — per-employee exception to the closed annual-goal gate.

The annual-goal edit window is opened/closed org-wide per half on
`system_settings_year_overrides`. This table layers a per-EMPLOYEE exception on
top, so an Admin can let one person keep working while the half is otherwise
closed — without reopening the gate for everyone.

One row per `(org_id, user_id, period_label)` where `period_label` is a HALF
label ("H1 FY26-27"):
    - allow_create → may create new annual goals for that half despite the
      closed global gate. Keyed to the ACTIVE half (new goals stamp the active
      cycle), so it stops affecting new goals once the cycle rolls over.
    - allow_edit   → may edit draft / changes-requested annual goals for that
      half despite the closed global gate. Set by the "throw a goal back to
      draft" admin action, keyed to the THROWN-BACK goal's own half.

A grant is ACTIVE while `revoked_at IS NULL`. Revoking stamps `revoked_at` and
flips both flags False, preserving the row for audit. The gate
(`goal_routes._assert_annual_gate_open`) consults the active row for the
operation's half; everything is default-deny when no active grant exists.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class GoalAccessOverride(Base):
    __tablename__ = "goal_access_overrides"

    id = Column(Integer, primary_key=True, index=True)

    # ── Multi-Tenancy + Target ───────────────────────────────────────
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    # The employee the grant applies to.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # ── Period Key ───────────────────────────────────────────────────
    # HALF label the grant covers, e.g. "H1 FY26-27" — matches the half the
    # gate keys off (annual goals are stamped to the half they belong to).
    period_label = Column(String, nullable=False)

    # ── Access Flags ─────────────────────────────────────────────────
    # May create new annual goals for this half despite the closed global gate.
    allow_create = Column(Boolean, default=False, nullable=False)
    # May edit draft / changes-requested annual goals for this half despite the
    # closed global gate. Set by the throw-back-to-draft admin action.
    allow_edit = Column(Boolean, default=False, nullable=False)

    # Optional admin note ("reopening goal after manager feedback").
    note = Column(Text, nullable=True)

    # ── Audit Trail ──────────────────────────────────────────────────
    granted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    granted_at = Column(DateTime(timezone=True), server_default=func.now())
    revoked_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Constraints ──────────────────────────────────────────────────
    __table_args__ = (
        # One grant row per (org, employee, half) — the lookup contract.
        UniqueConstraint(
            "org_id", "user_id", "period_label", name="uq_goal_access_org_user_period"
        ),
    )

    # ── Relationships ────────────────────────────────────────────────
    user = relationship("User", foreign_keys=[user_id])
    granted_by = relationship("User", foreign_keys=[granted_by_id])
    revoked_by = relationship("User", foreign_keys=[revoked_by_id])
