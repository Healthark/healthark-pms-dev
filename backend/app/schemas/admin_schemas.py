"""
Admin Schemas — The Admin Panel's API Contract.

These schemas mirror the TypeScript interfaces in admin.service.ts exactly.
Key mapping note: The frontend uses `active_cycle` while the database stores
`active_cycle_name`. The AdminSettingsResponse schema handles this translation
via a computed field so neither side needs to change.
"""

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ── Reference Data (Dropdowns) ───────────────────────────────────────

class DepartmentBrief(BaseModel):
    """Lightweight department payload for <select> dropdowns."""
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class DesignationBrief(BaseModel):
    """Lightweight designation payload for <select> dropdowns."""
    id: int
    name: str
    level: int

    model_config = ConfigDict(from_attributes=True)


# ── User Schemas ─────────────────────────────────────────────────────

class UserResponse(BaseModel):
    """
    Full user record returned to the Admin table.

    Includes nested department/designation objects so the table can
    display human-readable names without a second lookup.
    """
    id: int
    org_id: int
    employee_code: str
    full_name: str
    email: str
    phone: Optional[str] = None
    role: str
    department_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None
    # Resolved mentor display name. Populated by BOTH /admin/users
    # (paginated) and /admin/users/all (pickers) via a self-join, so the
    # table no longer resolves it client-side from the full user list —
    # which broke once the list became paginated. Both endpoints return
    # an identical, fully-populated shape.
    mentor_name: Optional[str] = None
    is_deleted: bool
    created_at: datetime

    # Nested objects — populated from SQLAlchemy relationships
    department: Optional[DepartmentBrief] = None
    designation: Optional[DesignationBrief] = None

    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    """Payload from the 'Add New User' modal."""
    employee_code: str = Field(..., min_length=1, max_length=20)
    full_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=5, max_length=100)
    phone: Optional[str] = None
    role: str = Field(..., pattern=r"^(Admin|Manager|Principal|Staff)$")
    department_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None
    password: str = Field(..., min_length=8, max_length=128)


class UserUpdate(BaseModel):
    """Payload from the 'Edit User' modal — all fields optional (PATCH semantics)."""
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    phone: Optional[str] = None
    role: Optional[str] = Field(default=None, pattern=r"^(Admin|Manager|Principal|Staff)$")
    employee_code: Optional[str] = Field(default=None, min_length=1, max_length=20)
    department_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None


# ── Admin Settings (Simplified View) ─────────────────────────────────

class AdminSettingsResponse(BaseModel):
    """
    Full settings payload for the Admin Panel's SystemSettingsTab.

    'active_cycle' is the computed cycle name (read-only, system-calculated).
    cycle_type and fiscal_start_month are the editable inputs that drive it.
    """
    id: int
    org_id: int
    active_cycle: Optional[str] = None
    cycle_type: str
    fiscal_start_month: int
    goals_edit_enabled: bool
    annual_goals_edit_enabled: bool
    project_ratings_visible: bool
    annual_reviews_enabled: bool
    annual_review_final_rating_visible: bool
    updated_at: Optional[datetime] = None


class AdminSettingsUpdate(BaseModel):
    """Payload from the SystemSettingsTab save button. All fields optional (PATCH semantics)."""
    cycle_type: Optional[str] = Field(default=None, pattern=r"^(annual|half_yearly|quarterly)$")
    fiscal_start_month: Optional[int] = Field(default=None, ge=1, le=12)
    goals_edit_enabled: Optional[bool] = None
    annual_goals_edit_enabled: Optional[bool] = None
    project_ratings_visible: Optional[bool] = None
    annual_reviews_enabled: Optional[bool] = None
    annual_review_final_rating_visible: Optional[bool] = None


# ── Cycle Roll-out ───────────────────────────────────────────────────
# The active cycle is admin-advanced (manual), not date-derived. These back
# the System Settings "Cycle" card and its confirmation modals.

class CycleEffects(BaseModel):
    """What advancing `from_cycle` → `to_cycle` changes."""
    from_cycle: str
    to_cycle: str
    # True when the FY changes (e.g. H2 FY26-27 → H1 FY27-28) — the heavyweight
    # transition: new annual-review + goal cycles, a fresh all-closed FY config.
    fy_rollover: bool
    # The FE requires a typed confirmation for the (irreversible) FY rollover.
    requires_typed_confirmation: bool


class CycleStatusResponse(BaseModel):
    """Current cycle + the cycle a roll-out would advance to, with effects."""
    active_cycle: str
    next_cycle: str
    # The cycle the org was on before the most recent change — powers the
    # one-click "Roll back" affordance. None when the cycle has never changed.
    previous_cycle: Optional[str] = None
    effects: CycleEffects


class CycleSetRequest(BaseModel):
    """Manual set / correction payload — a strict cycle label ('H1 FY26-27')."""
    target_cycle: str = Field(..., min_length=1, max_length=50)


# ── Per-Fiscal-Year Override Schemas ─────────────────────────────────
# The four access-control toggles now live on a separate per-FY table.
# The Admin Panel's Year dropdown loads the row for the selected FY and
# the four toggles drive these values.

class YearOption(BaseModel):
    """One entry in a period dropdown (FY or half)."""
    period_label: str        # "FY26-27" (FY dropdown) or "H1 FY26-27" (half)
    is_current: bool         # True for the active FY / active half
    has_override: bool       # False until an Admin has saved at least once


class YearOptionsResponse(BaseModel):
    """Payload of `GET /admin/settings/years`. `years` feeds the Annual Review
    (FY) dropdown; `halves` feeds the Goals & Project (H1/H2) dropdown."""
    years: list[YearOption]
    halves: list[YearOption] = []


class YearSettingsResponse(BaseModel):
    """Per-period settings payload — what the Admin Panel binds toggles to.
    Carries all six flags; the FY section reads the annual-review ones, the
    half section the goal/project ones."""
    period_label: str
    annual_reviews_enabled: bool
    annual_review_final_rating_visible: bool
    annual_goals_edit_enabled: bool
    project_ratings_visible: bool
    annual_goals_final_rating_visible: bool
    management_review_enabled: bool
    is_current: bool
    updated_at: Optional[datetime] = None


class YearSettingsUpdate(BaseModel):
    """PATCH payload — every toggle optional; only the flags sent are written.
    The FY section sends the annual-review flags, the half section the
    goal/project flags."""
    annual_reviews_enabled: Optional[bool] = None
    annual_review_final_rating_visible: Optional[bool] = None
    annual_goals_edit_enabled: Optional[bool] = None
    project_ratings_visible: Optional[bool] = None
    annual_goals_final_rating_visible: Optional[bool] = None
    management_review_enabled: Optional[bool] = None


class YearPreflightEntry(BaseModel):
    in_flight_count: int
    warning: Optional[str] = None


class YearPreflightResponse(BaseModel):
    """Per-period in-flight counts for the save-confirmation modal."""
    period_label: str
    annual_goals_edit_enabled: YearPreflightEntry
    annual_reviews_enabled: YearPreflightEntry
    project_ratings_visible: YearPreflightEntry
    annual_review_final_rating_visible: YearPreflightEntry
    annual_goals_final_rating_visible: YearPreflightEntry
    management_review_enabled: YearPreflightEntry


# ── Admin Broadcast (Notify tab) ─────────────────────────────────────

class AdminNotifyRequest(BaseModel):
    """Body for POST /admin/notify — a manual targeted announcement.

    Recipients are active org users narrowed by the (optional, AND-combined)
    filters below. With no filter set, every active user is targeted:
        * `user_ids`         → restrict to these specific users (any of).
        * `department_ids`   → restrict to these departments (any of).
        * `designation_ids`  → restrict to these designations/job titles (any of).
    `subject`/`body` are backend-authoritative (the UI presets only pre-fill).

    `channel` chooses the delivery mode:
        * "in_app" → write the in-app announcement only.
        * "email"  → send the email only (no in-app row).
        * "both"   → in-app announcement + email."""
    subject: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=4000)
    user_ids: list[int] = Field(default_factory=list)
    department_ids: list[int] = Field(default_factory=list)
    designation_ids: list[int] = Field(default_factory=list)
    channel: Literal["email", "in_app", "both"] = "both"


class AdminNotifyResult(BaseModel):
    """Outcome of a broadcast: recipient count + whether email was dispatched."""
    recipients: int
    emailed: bool


# ── Coverage gaps (mentor/PM removal impact) ─────────────────────────

class CoverageGapUser(BaseModel):
    """A mentee whose mentor link now dangles (mentor was removed)."""
    id: int
    name: str


class CoverageGapProject(BaseModel):
    """An active project with no active Primary (PM) assignment."""
    id: int
    name: str


class CoverageGaps(BaseModel):
    """Live coverage gaps the Admin Panel surfaces as a warning banner.
    Empty lists ⇒ no banner. Drives GET /admin/coverage-gaps."""
    orphaned_mentees: list[CoverageGapUser]
    pm_less_projects: list[CoverageGapProject]
