from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)

    # One settings row per organization — enforced at the DB level
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)

    # e.g. "H1 FY26" — the active cycle all new reviews/goals are tagged to
    active_cycle = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("org_id", name="uix_system_settings_org"),
    )