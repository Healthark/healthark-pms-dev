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
    """Lightweight designation payload for <select> dropdowns.

    `department_id` is the role's home department — roles are department-scoped,
    so the frontend filters the role dropdown by the selected department and
    infers the department from a chosen role. Null only for legacy/unscoped
    rows that predate scoping."""
    id: int
    name: str
    # Nullable: a role may be intentionally unleveled (blank in the competency
    # matrix) — it then maps to no level column in the framework.
    level: Optional[int] = None
    department_id: Optional[int] = None

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
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)


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
    annual_review_mentor_rating_visible: bool
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
    annual_review_mentor_rating_visible: Optional[bool] = None
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
    annual_review_mentor_rating_visible: YearPreflightEntry
    annual_goals_final_rating_visible: YearPreflightEntry
    management_review_enabled: YearPreflightEntry


# ── Admin Broadcast (Notify tab) ─────────────────────────────────────

class AdminNotifyRequest(BaseModel):
    """Body for POST /admin/notify — a manual targeted announcement.

    Recipients are active org users narrowed by the (optional, AND-combined)
    filters below. With no filter set, every active user is targeted:
        * `user_ids`         → restrict to these specific users (any of).
        * `department_ids`   → restrict to these departments (any of).
    `subject`/`body` are backend-authoritative (the UI presets only pre-fill).

    `channel` chooses the delivery mode:
        * "in_app" → write the in-app announcement only.
        * "email"  → send the email only (no in-app row).
        * "both"   → in-app announcement + email."""
    subject: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=4000)
    user_ids: list[int] = Field(default_factory=list)
    department_ids: list[int] = Field(default_factory=list)
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


# ── Goal Access Overrides (per-employee gate exceptions) ─────────────

class GoalAccessGrantUpdate(BaseModel):
    """PATCH body for granting / adjusting one employee's annual-goal access for
    a half (defaults to the active half). Only the flags sent are written."""
    allow_create: Optional[bool] = None
    allow_edit: Optional[bool] = None
    note: Optional[str] = Field(default=None, max_length=500)
    period_label: Optional[str] = None  # defaults to the active half


class GoalAccessRevokeRequest(BaseModel):
    """POST body for revoking an employee's grant (defaults to the active half)."""
    period_label: Optional[str] = None


class GoalAccessGrantResponse(BaseModel):
    """One active grant row, enriched with employee + granter display names for
    the admin overview / detail views."""
    user_id: int
    user_name: str
    employee_code: str
    period_label: str
    allow_create: bool
    allow_edit: bool
    note: Optional[str] = None
    granted_by_name: Optional[str] = None
    granted_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AdminGoalBrief(BaseModel):
    """A goal row in the admin Goal Access view — enough to pick which approved
    goal to throw back to draft."""
    id: int
    title: str
    approval_status: str
    cycle_name: Optional[str] = None
    period_label: Optional[str] = None  # canonical half ("H1 FY26-27")
    can_revert: bool  # True iff currently 'approved' (the only revertible state)

    model_config = ConfigDict(from_attributes=True)


class GoalAccessDetailResponse(BaseModel):
    """GET /admin/goal-access/{user_id} — the employee's active grants plus their
    active-FY annual goals, so the Admin can toggle access and throw specific
    goals back from one screen."""
    user_id: int
    user_name: str
    employee_code: str
    active_period_label: Optional[str] = None
    grants: list[GoalAccessGrantResponse]
    goals: list[AdminGoalBrief]


# ── Project Review Eligibility (per-project, org-wide) ───────────────

class ReviewEligibilityProject(BaseModel):
    """One active project with its current review-eligibility — a row in the
    Review Eligibility tab's checkbox list. `is_billable` is context;
    `review_eligible` drives the checkbox."""
    project_id: int
    project_name: str
    project_code: str
    is_billable: bool
    review_eligible: bool

    model_config = ConfigDict(from_attributes=True)


class ReviewEligibilityProjectUpdate(BaseModel):
    """One project's desired eligibility in the PATCH payload."""
    project_id: int
    review_eligible: bool


class ReviewEligibilityUpdate(BaseModel):
    """PATCH /admin/review-eligibility — desired eligibility for a set of
    projects. Only the listed projects are changed."""
    projects: list[ReviewEligibilityProjectUpdate]


class ReviewEligibilityUpdateResult(BaseModel):
    """PATCH /admin/review-eligibility response — how many projects changed."""
    updated: int


# ── Competency Framework (admin editor) ──────────────────────────────
# The editor works per department. A "competency" is the group of rows sharing
# (department, key); label/is_reviewable/display_order are shared across its
# levels, expectation is per (competency, level) cell.

class FrameworkCell(BaseModel):
    """One (competency, level) cell — the editable expectation."""
    model_config = ConfigDict(from_attributes=True)
    competency_id: int
    expectation: Optional[str] = None


class FrameworkCompetency(BaseModel):
    """A competency (row) with its per-level expectation cells. For the org
    default set the single cell is keyed "default"; for a department the cells
    are keyed by level (as a string)."""
    key: str
    label: str
    is_reviewable: bool
    display_order: int
    cells: dict[str, FrameworkCell]


class FrameworkResponse(BaseModel):
    """The framework for a department (or the org default set), for the admin
    matrix editor + role→level panel."""
    is_default: bool
    department_id: Optional[int] = None
    levels: list[int] = []
    competencies: list[FrameworkCompetency] = []
    designations: list[DesignationBrief] = []


class FrameworkCompetencyCreate(BaseModel):
    """Add a competency. department_id null = the org default set."""
    department_id: Optional[int] = None
    label: str = Field(..., min_length=1, max_length=200)
    is_reviewable: bool = True


class FrameworkCompetencyUpdate(BaseModel):
    """Rename / retoggle / reorder a competency (identified by department + key).
    Applies across the competency's level rows."""
    department_id: Optional[int] = None
    key: str
    label: Optional[str] = Field(default=None, min_length=1, max_length=200)
    is_reviewable: Optional[bool] = None
    display_order: Optional[int] = None


class FrameworkCellUpdate(BaseModel):
    """Set one cell's expectation text (competency_id in the path)."""
    expectation: Optional[str] = Field(default=None, max_length=10000)


class FrameworkLevelAdd(BaseModel):
    """Add a level column to a department (creates empty cells for its
    competencies)."""
    department_id: int
    level: int = Field(..., ge=1, le=20)


class DesignationLevelUpdate(BaseModel):
    """Set a designation's level (role→level mapping)."""
    level: int = Field(..., ge=1, le=20)


# ── Bulk save (the whole matrix at once — the admin editor's Save button) ──

class FrameworkBulkCell(BaseModel):
    """One desired (level, expectation) cell. `level` is null for the org
    default set's single column."""
    level: Optional[int] = Field(default=None, ge=1, le=20)
    expectation: Optional[str] = Field(default=None, max_length=10000)


class FrameworkBulkCompetency(BaseModel):
    """A desired competency row. `key` null = a NEW competency (the server
    assigns a unique slug from the label). `is_deleted` marks an EXISTING
    competency for soft-deletion. label/is_reviewable/display_order apply to all
    of the competency's per-level rows; `cells` carries the per-level text."""
    key: Optional[str] = None
    label: str = Field(..., min_length=1, max_length=200)
    is_reviewable: bool = True
    display_order: int = Field(..., ge=0)
    is_deleted: bool = False
    cells: list[FrameworkBulkCell] = Field(default_factory=list)


class FrameworkBulkDesignation(BaseModel):
    """Role→level mapping entry. `level` null clears the mapping."""
    id: int
    level: Optional[int] = Field(default=None, ge=1, le=20)


class FrameworkBulkSave(BaseModel):
    """Declarative desired state for one department's framework (or the org
    default set when `department_id` is null), applied in a single transaction.

    Deletion is EXPLICIT (via each competency's `is_deleted`) — a competency
    merely absent from the list is left untouched, so a partial payload can
    never silently wipe data. New competencies carry `key=null`."""
    department_id: Optional[int] = None
    competencies: list[FrameworkBulkCompetency] = Field(default_factory=list)
    designations: list[FrameworkBulkDesignation] = Field(default_factory=list)


# ── Organization structure (admin "Departments & Roles" tab) ────────────
# Department + designation CRUD. Soft-delete via is_active; designation LEVEL
# is intentionally NOT settable here (the Competency Framework tab owns it);
# re-parenting a role to another department is out of scope for v1.

class DepartmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class DepartmentUpdate(BaseModel):
    """Rename a department."""
    name: str = Field(..., min_length=1, max_length=120)


class DesignationCreate(BaseModel):
    """Create a role under a department. `level` is intentionally NOT accepted:
    new roles are born at the default level and re-levelled in the Competency
    Framework tab, which remains level's single writer."""
    name: str = Field(..., min_length=1, max_length=120)
    department_id: int


class DesignationUpdate(BaseModel):
    """Rename a role. Level is owned by the Competency Framework tab, and
    re-parenting to another department is out of scope for v1."""
    name: str = Field(..., min_length=1, max_length=120)


class OrgDesignation(BaseModel):
    """A role row for the Organization tab — includes is_active + how many
    active users still reference it (blast-radius surfacing on deactivate)."""
    id: int
    name: str
    level: Optional[int] = None
    department_id: Optional[int] = None
    is_active: bool
    active_user_count: int = 0


class OrgDepartment(BaseModel):
    id: int
    name: str
    is_active: bool
    active_user_count: int = 0
    designations: list[OrgDesignation] = Field(default_factory=list)


class OrgStructureResponse(BaseModel):
    """Full org structure for the admin tab: every department (incl. inactive)
    with its roles, plus any legacy roles not scoped to a department."""
    departments: list[OrgDepartment] = Field(default_factory=list)
    unscoped_designations: list[OrgDesignation] = Field(default_factory=list)
