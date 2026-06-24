"""
CycleRolloutLog — audit trail for manual cycle advancement.

One row per roll-out / manual set of the org's active cycle. The active cycle
is admin-advanced (see the /admin/cycle endpoints); this records who moved it,
from what, to what, and how.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class CycleRolloutLog(Base):
    __tablename__ = "cycle_rollout_log"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)

    # Cycle labels before/after the change (e.g. "H1 FY26-27" → "H2 FY26-27").
    from_cycle = Column(String, nullable=False)
    to_cycle = Column(String, nullable=False)
    # "rollout" (one-click advance to the next cycle) | "set" (manual jump /
    # correction to an arbitrary cycle).
    kind = Column(String, nullable=False)

    rolled_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    organization = relationship("Organization")
    rolled_by = relationship("User", foreign_keys=[rolled_by_id])
