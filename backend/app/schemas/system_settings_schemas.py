"""
SystemSettings Schemas — The Contract Between Frontend and Backend.

These schemas enforce strict validation on every system settings request.
The CycleType enum is imported from the model layer (single source of truth)
to ensure the API and database always agree on valid values.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import date, datetime

from app.models.system_settings_models import CycleType


# ── Response Schema ──────────────────────────────────────────────────
# What we send BACK to the React frontend. This is the most-used schema
# since both the Topbar (GET) and Admin panel (after PATCH) consume it.
class SystemSettingsResponse(BaseModel):
    id: int
    org_id: int

    active_cycle_name: str
    cycle_type: CycleType
    fiscal_start_month: int
    cycle_start_date: Optional[date] = None
    cycle_end_date: Optional[date] = None

    goals_submission_open: bool
    reviews_submission_open: bool
    project_ratings_visible: bool

    updated_by_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    # Architect Note: from_attributes=True tells Pydantic to read directly
    # from SQLAlchemy model attributes instead of expecting a plain dict.
    model_config = ConfigDict(from_attributes=True)


# ── Create Schema ────────────────────────────────────────────────────
# Used only during org onboarding / seed script to initialize settings.
# org_id is NOT accepted here — it is forced from current_user.org_id
# on the backend (Multi-Tenancy Golden Rule).
class SystemSettingsCreate(BaseModel):
    active_cycle_name: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Display label for the active cycle, e.g. 'H1 FY26'"
    )
    cycle_type: CycleType = CycleType.ANNUAL
    fiscal_start_month: int = Field(
        default=4,
        ge=1,
        le=12,
        description="Month (1-12) the fiscal year starts"
    )
    cycle_start_date: Optional[date] = None
    cycle_end_date: Optional[date] = None
    goals_submission_open: bool = False
    reviews_submission_open: bool = False


# ── Update Schema ────────────────────────────────────────────────────
# Everything is Optional — Pydantic's model_dump(exclude_unset=True)
# ensures only fields the Admin actually sent are written to the DB.
class SystemSettingsUpdate(BaseModel):
    active_cycle_name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=50,
        description="Display label for the active cycle"
    )
    cycle_type: Optional[CycleType] = None
    fiscal_start_month: Optional[int] = Field(
        default=None,
        ge=1,
        le=12,
        description="Month (1-12) the fiscal year starts"
    )
    cycle_start_date: Optional[date] = None
    cycle_end_date: Optional[date] = None
    goals_submission_open: Optional[bool] = None
    reviews_submission_open: Optional[bool] = None