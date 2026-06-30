"""
SystemSettings Schemas — The Contract Between Frontend and Backend.

These schemas enforce strict validation on every system settings request.
The CycleType enum is imported from the model layer (single source of truth)
to ensure the API and database always agree on valid values.
"""

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

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
    goals_edit_enabled: bool
    # True when the Admin has opened the annual-goal submission window.
    # Exposed here so the frontend can show/hide the "Add Goal" button
    # and disable the edit pencil on draft annual goals without an extra API call.
    annual_goals_edit_enabled: bool
    project_ratings_visible: bool
    annual_reviews_enabled: bool
    annual_review_final_rating_visible: bool
    # Per-FY visibility of the mentor's rating to the mentee — split out from the
    # final-rating gate. One of YEAR_OVERRIDE_FLAGS, so it MUST be a field here —
    # get_system_settings overlays it via setattr from the active FY's row.
    annual_review_mentor_rating_visible: bool
    # Per-FY goal mentor-review embargo. One of YEAR_OVERRIDE_FLAGS, so it MUST
    # be a field here — get_system_settings overlays each flag from the active
    # FY's override row via setattr, and a missing field raises at runtime.
    annual_goals_final_rating_visible: bool
    # Per-FY management-review (calibration) gate. One of YEAR_OVERRIDE_FLAGS,
    # so it MUST be a field here — get_system_settings overlays it via setattr.
    management_review_enabled: bool

    updated_by_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

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
    annual_goals_edit_enabled: bool = False


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
    goals_edit_enabled: Optional[bool] = None
    annual_goals_edit_enabled: Optional[bool] = None
    project_ratings_visible: Optional[bool] = None
    annual_reviews_enabled: Optional[bool] = None
    annual_review_final_rating_visible: Optional[bool] = None
    annual_review_mentor_rating_visible: Optional[bool] = None
