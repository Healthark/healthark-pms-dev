"""
Goal Routes — Core Objective Tracking.

Endpoints:
    GET    /api/v1/goals/           → List goals (own or team)
    GET    /api/v1/goals/{id}       → Get single goal details
    POST   /api/v1/goals/           → Create new goal
    PATCH  /api/v1/goals/{id}       → Update goal details
    DELETE /api/v1/goals/{id}       → Delete a goal

Workflow Actions:
    PATCH  /api/v1/goals/{id}/submit  → Submit draft for approval
    PATCH  /api/v1/goals/{id}/approve → Manager approves/rejects

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: All queries strictly filter by current_user.org_id
    Layer 3 — Role Awareness:   Relationship checks for team/mentee actions
    Layer 4 — Ownership:        Users can only edit their own goals; Mentors can edit mentee goals
    Layer 5 — Gate Checks:      Annual goals respect the annual_goals_edit_enabled flag
"""

from datetime import date, datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased, joinedload, Session

from app.api.dependencies import DbSession, CurrentUser
from app.models.goal_models import Goal, ApprovalStatus, GoalType, POST_APPROVAL_STATES
from app.models.goal_criteria_models import GoalCriterion
from app.models.goal_self_review_models import GoalSelfReview, SelfReviewCycleHalf
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.notification_models import NotificationCategory
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.services.notifications import create_notification
from app.schemas.goal_schemas import (
    GoalCreate,
    GoalUpdate,
    GoalResponse,
    GoalApprovalUpdate,
    GoalBulkApproveRequest,
    GoalBulkApproveResult,
    GoalBulkApproveFailure,
    GoalSelfReviewSubmit,
    GoalSelfReviewDraft,
    GoalMentorReviewSubmit,
    GoalMentorReviewDraft,
    MyGoalAccessResponse,
    TeamGoalResponse,
    TeamGoalListResponse,
    TeamGoalsFilterOptions,
)
from app.schemas.pagination import Page, PaginationParams
from app.core.cycle_utils import (
    cycles_before,
    goal_cycle_name_for_active,
    is_review_window_open,
    get_year_override,
    _cycle_to_fy_label,
    _half_label_of_cycle_string,
    _half_label_of_goal,
)
from app.models.goal_access_override_models import GoalAccessOverride
from app.services.goal_access import (
    active_half_label,
    get_active_override,
    user_has_goal_grant,
)

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────

def _get_goal_with_relations(db: DbSession, goal_id: int, org_id: int) -> Goal:
    """Fetch a goal with eagerly loaded criteria + manager, scoped to the org."""
    goal = (
        db.query(Goal)
        .options(joinedload(Goal.criteria), joinedload(Goal.manager))
        .filter(Goal.id == goal_id, Goal.org_id == org_id, Goal.is_deleted == False)  # noqa: E712
        .first()
    )
    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Goal not found or you don't have access to it.",
        )
    return goal


def _get_settings(db: DbSession, org_id: int) -> SystemSettings:
    """Fetch org settings, raising 500 if not yet initialized."""
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()
    if not settings:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="System settings have not been initialized for this organization.",
        )
    return settings


def _apply_goal_review_visibility(
    resp: GoalResponse,
    db: DbSession,
    org_id: int,
    viewer: User,
    owner_mentor_id: Optional[int],
    active_fy_label: Optional[str],
) -> None:
    """Strip review text the viewer shouldn't see, on the RESPONSE object.

    NEVER mutate the ORM goal's self_reviews/mentor_reviews — they're
    delete-orphan relationships, so filtering them on the model would DELETE
    the rows on flush. This filters the already-built Pydantic response.

    Rules:
      - A draft review is visible only to its author (the owner for
        self-reviews, the mentor for mentor-reviews).
      - Submitted mentor reviews are embargoed from the mentee until the
        goal's FY is published (annual_goals_final_rating_visible). The
        authoring mentor and admins always see them; past FYs always pass
        through (closing the current year never hides a finalized prior year).
    """
    is_owner = resp.user_id == viewer.id
    is_mentor = owner_mentor_id is not None and owner_mentor_id == viewer.id

    if not is_owner:
        resp.self_reviews = [sr for sr in resp.self_reviews if not sr.is_draft]
    if not is_mentor:
        resp.mentor_reviews = [mr for mr in resp.mentor_reviews if not mr.is_draft]

    # Embargo submitted mentor reviews from the mentee until published.
    if is_owner and not is_mentor:
        goal_fy = _cycle_to_fy_label(resp.cycle_name)
        published = True
        if goal_fy is not None and goal_fy == active_fy_label:
            # Within the active FY, visibility is controlled per half.
            override = get_year_override(
                db, org_id, _half_label_of_cycle_string(resp.cycle_name)
            )
            published = bool(override and override.annual_goals_final_rating_visible)
        if not published:
            resp.mentor_reviews = []


def _self_reviewed_state(cycle_code: str) -> str:
    """`{cycle}_self_reviewed` ApprovalStatus value: "h1" → "h1_self_reviewed"."""
    return f"{cycle_code.lower()}_self_reviewed"


def _mentor_reviewed_state(cycle_code: str) -> str:
    """`{cycle}_mentor_reviewed` ApprovalStatus value."""
    return f"{cycle_code.lower()}_mentor_reviewed"


def _self_review_allowed_states(cycle_code: str) -> set[str]:
    """States from which submitting (or drafting) a self-review for
    `cycle_code` is permitted.

    Always includes APPROVED. Plus, for every prior cycle in the same
    cadence, both its self_reviewed and mentor_reviewed states (so a goal
    can skip ahead — e.g. an org that missed Q2 entirely can still file
    Q3 from the q1_mentor_reviewed state)."""
    allowed = {ApprovalStatus.APPROVED.value}
    for prior in cycles_before(cycle_code):
        allowed.add(_self_reviewed_state(prior))
        allowed.add(_mentor_reviewed_state(prior))
    return allowed


# Canonical linear order of the goal lifecycle (enum declaration order). Used to
# keep approval_status MONOTONIC-FORWARD. After an admin rolls the active cycle
# backward (e.g. H2 → H1), a mentor may back-fill an earlier half whose window
# has reopened. Setting the scalar to that earlier half's *_reviewed state would
# REGRESS it past a later half that is already reviewed, misleading any consumer
# (badges, dashboards) that assumes the scalar only moves forward. The per-cycle
# review ROWS remain the source of truth for which halves are reviewed; the
# scalar just records the furthest milestone reached. In normal forward flow the
# new state is always further along, so _max_status is a no-op there.
_STATUS_ORDER: dict[str, int] = {s.value: i for i, s in enumerate(ApprovalStatus)}


def _max_status(current: str, candidate: str) -> str:
    """Return whichever lifecycle state is further along — never regress."""
    if _STATUS_ORDER.get(candidate, -1) > _STATUS_ORDER.get(current, -1):
        return candidate
    return current


def _assert_annual_gate_open(
    db: Session,
    org_id: int,
    half_label: Optional[str],
    *,
    user_id: int,
    action: str,
) -> None:
    """Raise 403 when annual-goal editing is closed for `half_label` AND the
    caller has no active per-employee grant covering `action`.

    Per-HALF gate: editing is opened/closed per half (H1/H2) on the (org, half)
    override row. On top of that, an Admin can grant a single employee a per-half
    exception (see GoalAccessOverride / the Goal Access admin tab); that grant is
    the fallback checked here when the org-wide half is closed.
      - No resolvable half_label → 400 (we can't tell which half to gate).
      - Org-wide annual_goals_edit_enabled True → open for everyone.
      - Else an active grant for (user, half, action) → open for that employee.
      - Else 403 (default-deny: a half is closed until an Admin opens it).

    `action` is "create" (checks allow_create) or "edit" (checks allow_edit;
    delete piggybacks on edit).
    """
    if not half_label:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot determine the half-cycle for this annual goal.",
        )
    override = get_year_override(db, org_id, half_label)
    if override is not None and override.annual_goals_edit_enabled:
        return  # org-wide window open
    if user_has_goal_grant(db, org_id, user_id, half_label, action):
        return  # per-employee exception granted by an Admin
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            f"Annual goal submissions for {half_label} are currently closed. "
            "Please wait for the Admin to open the submission window."
        ),
    )


def _goal_fy_year(goal: Goal) -> Optional[int]:
    """Extract the 4-digit fiscal start year from `goal.cycle_name`.

    Goal cycle names are stamped at creation as "H1 2026" / "H2 2025"
    (4-digit year, no FY prefix — see goal_cycle_name_for_active). Returns None
    when the goal predates this stamping or has no cycle_name.
    """
    if not goal.cycle_name:
        return None
    for token in goal.cycle_name.split():
        if token.isdigit() and len(token) == 4:
            return int(token)
    return None


# =====================================================================
# CORE CRUD OPERATIONS
# =====================================================================

@router.get("/", response_model=List[GoalResponse])
def list_goals(
    db: DbSession,
    current_user: CurrentUser,
    goal_type: Optional[str] = None,
):
    """
    List the caller's own goals.

    This endpoint is strictly scoped to `Goal.user_id == current_user.id`.
    Mentee goals — even for a mentor — are NOT returned here; use
    GET /goals/team for that view.  Keeping the two endpoints disjoint
    makes it impossible to accidentally mix ownership in the "My Goals" UI.

    Filtering:
        goal_type=annual   — only annual goals
        goal_type=regular  — only regular goals
        (omit goal_type)   — all goals regardless of type
    """
    query = (
        db.query(Goal)
        .options(joinedload(Goal.manager), joinedload(Goal.criteria))
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == current_user.id,
            Goal.is_deleted == False,  # noqa: E712
        )
    )

    if goal_type:
        query = query.filter(Goal.goal_type == goal_type)

    goals = query.order_by(Goal.created_at.desc()).all()

    # Owner-facing list: embargo unpublished mentor reviews + hide mentor-review
    # drafts. Strip on the response (not the ORM — delete-orphan relationships).
    settings = _get_settings(db, current_user.org_id)
    active_fy = _cycle_to_fy_label(settings.active_cycle_name)
    out: list[GoalResponse] = []
    for g in goals:
        resp = GoalResponse.model_validate(g)
        _apply_goal_review_visibility(
            resp, db, current_user.org_id, current_user,
            current_user.mentor_id, active_fy,
        )
        out.append(resp)
    return out


@router.get("/my-access", response_model=MyGoalAccessResponse)
def get_my_goal_access(db: DbSession, current_user: CurrentUser):
    """The caller's own active annual-goal access grants (per-employee gate
    exceptions an Admin set on the Goal Access tab). Drives the My Goals
    Add/Edit affordances when the org-wide half is otherwise closed.

    Always self-scoped — there is no path to read another user's grants here.
    Declared before GET /{goal_id} so "my-access" isn't captured as a goal id.
    """
    settings = _get_settings(db, current_user.org_id)
    active_half = active_half_label(settings)
    active_grant = get_active_override(
        db, current_user.org_id, current_user.id, active_half
    )
    # Every half the caller currently has an edit grant for — lets the client
    # treat a goal thrown back in a non-active half as editable too.
    edit_rows = (
        db.query(GoalAccessOverride.period_label)
        .filter(
            GoalAccessOverride.org_id == current_user.org_id,
            GoalAccessOverride.user_id == current_user.id,
            GoalAccessOverride.allow_edit == True,  # noqa: E712
            GoalAccessOverride.revoked_at.is_(None),
        )
        .all()
    )
    return MyGoalAccessResponse(
        active_period_label=active_half,
        allow_create=bool(active_grant and active_grant.allow_create),
        allow_edit=bool(active_grant and active_grant.allow_edit),
        edit_period_labels=[r[0] for r in edit_rows],
    )


@router.post("/", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(
    goal_in: GoalCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Create a new goal.

    For annual goals (goal_type="annual"):
        - annual_goals_edit_enabled must be True (Admin gate)
        - cycle_name is auto-stamped from the active_cycle_name in settings,
          stripped to the bare FY label ("H1 FY26" → "FY26").  This makes the
          goal permanently queryable by fiscal year even after the cycle rotates.

    For regular goals:
        - No gate check; follows existing project-cycle submission rules.
    """
    # Goals are always created for yourself; your own mentor approves them
    # (no on-behalf-of creation — mentors/admins act on goals, not author them).
    target_user_id = current_user.id
    target_manager_id = current_user.mentor_id

    # Goals require mentor approval, so a user with no mentor (e.g. CEO/founders)
    # cannot create goals — they would get stuck at the approve step forever.
    if target_manager_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Cannot create goals for a user who has no mentor assigned. "
                "Goals require mentor approval — contact an admin to assign a mentor first."
            ),
        )

    # Even if mentor_id is set, the FK can point at a soft-deleted user when
    # admin deactivates a mentor without reassigning their mentees. That
    # routes approval to a dead account — block here with the same message.
    mentor_is_live = db.query(User.id).filter(
        User.id == target_manager_id,
        User.is_deleted == False,  # noqa: E712
    ).first() is not None
    if not mentor_is_live:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The assigned mentor is no longer active. "
                "Contact an admin to reassign a mentor before creating goals."
            ),
        )

    # ── Gate check + cycle stamping for annual goals ───────────────────
    cycle_name: Optional[str] = None
    if goal_in.goal_type == GoalType.ANNUAL:
        settings = _get_settings(db, current_user.org_id)
        # Stamp the half-yearly cycle from the active cycle ("H1 2026").
        # Stamp BEFORE gating so the per-FY check keys off the goal's own FY.
        cycle_name = goal_cycle_name_for_active(settings.active_cycle_name)
        _assert_annual_gate_open(
            db,
            current_user.org_id,
            _half_label_of_cycle_string(cycle_name),
            user_id=current_user.id,
            action="create",
        )

    # ── Build the Goal record ──────────────────────────────────────────
    new_goal = Goal(
        org_id=current_user.org_id,
        user_id=target_user_id,
        manager_id=target_manager_id,
        title=goal_in.title,
        description=goal_in.description,
        attachment_url=goal_in.attachment_url,
        goal_type=goal_in.goal_type.value,
        cycle_name=cycle_name,
        start_date=goal_in.start_date,
        due_date=goal_in.due_date,
        approval_status=ApprovalStatus.DRAFT.value,
    )
    db.add(new_goal)
    db.flush()  # Generates new_goal.id required by criteria FK

    if goal_in.criteria:
        criteria_objects = [
            GoalCriterion(
                goal_id=new_goal.id,
                org_id=current_user.org_id,
                title=c.title,
                sort_order=i,
            )
            for i, c in enumerate(goal_in.criteria)
        ]
        db.add_all(criteria_objects)

    db.commit()
    return _get_goal_with_relations(db, new_goal.id, current_user.org_id)


def _mentee_ids_for(db: DbSession, current_user: User) -> list[int]:
    """IDs of the current user's active direct mentees (same tenant).
    Empty list when the caller mentors nobody."""
    rows = db.query(User.id).filter(
        User.mentor_id == current_user.id,
        User.org_id == current_user.org_id,
        User.is_deleted == False,  # noqa: E712
    ).all()
    return [r[0] for r in rows]


def _team_goals_base_query(db: DbSession, current_user: User, mentee_ids: list[int]):
    """Base team-goals query joined to the owner (aliased) so we can
    search / filter / sort on the owner's display name in SQL. Scoped to
    the mentor's mentees + non-draft goals (drafts are owner-private).

    Returns (query, Owner) so callers reference the alias for filtering
    and ordering. Owner's department/designation are eager-loaded for the
    owner_* injection that TeamGoalResponse.from_attributes reads.
    """
    Owner = aliased(User)
    query = (
        db.query(Goal)
        .options(
            joinedload(Goal.owner).joinedload(User.department),
            joinedload(Goal.owner).joinedload(User.designation),
            joinedload(Goal.manager),
            joinedload(Goal.criteria),
        )
        .join(Owner, Goal.user_id == Owner.id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id.in_(mentee_ids),
            Goal.approval_status != ApprovalStatus.DRAFT.value,
            Goal.is_deleted == False,  # noqa: E712
        )
    )
    return query, Owner


def _inject_owner_fields(goals: list[Goal]) -> None:
    """Stamp owner_name/department/designation onto each ORM goal so
    TeamGoalResponse.from_attributes reads them as plain attributes."""
    for g in goals:
        g.owner_name = g.owner.full_name if g.owner else "Unknown"
        g.owner_department_name = (
            g.owner.department.name if g.owner and g.owner.department else None
        )
        g.owner_designation_name = (
            g.owner.designation.name if g.owner and g.owner.designation else None
        )


_TEAM_GOALS_SORT_COLUMNS = {
    "title": lambda O: Goal.title,
    "owner_name": lambda O: O.full_name,
    # fy_year is derived from cycle_name ("H1 2026"); we sort on cycle_name
    # which orders by year well enough for the picker (exact year sort would
    # need a SQL substring extraction — not worth it for a rarely-used sort).
    "fy_year": lambda O: Goal.cycle_name,
    "approval_status": lambda O: Goal.approval_status,
}


@router.get("/team", response_model=Page[TeamGoalListResponse])
def list_team_goals(
    db: DbSession,
    current_user: CurrentUser,
    pg: PaginationParams = Depends(),
    goal_type: Optional[str] = None,
    search: Optional[str] = Query(None, description="Matches goal title or mentee name"),
    year: Optional[int] = Query(None, description="Fiscal start year (from cycle_name)"),
    mentee: Optional[str] = Query(None, description="Exact mentee (owner) full name"),
    status_filter: Optional[str] = Query(
        None, alias="status", description="Exact approval_status value"
    ),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
):
    """
    Paginated annual goals for the current user's direct mentees — the
    exclusive data source for the Team Goals tab table.

    Server-side search / year / mentee / status filtering + sort + offset
    pagination. Only the assigned mentor sees a mentee's goals (no Admin
    bypass). Drafts are never shown (owner-private until submitted).
    Filter-dropdown options come from GET /goals/team/filter-options; the
    Bulk Approve modal pulls its full actionable set from
    GET /goals/team/pending.
    """
    mentee_ids = _mentee_ids_for(db, current_user)
    if not mentee_ids:
        return Page[TeamGoalListResponse](
            items=[], total=0, page=pg.page, per_page=pg.per_page
        )

    query, Owner = _team_goals_base_query(db, current_user, mentee_ids)

    if goal_type:
        query = query.filter(Goal.goal_type == goal_type)
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(or_(Goal.title.ilike(term), Owner.full_name.ilike(term)))
    if year is not None:
        query = query.filter(Goal.cycle_name.ilike(f"%{year}%"))
    if mentee:
        query = query.filter(Owner.full_name == mentee)
    if status_filter:
        query = query.filter(Goal.approval_status == status_filter)

    total = query.with_entities(func.count(Goal.id)).order_by(None).scalar() or 0

    col_fn = _TEAM_GOALS_SORT_COLUMNS.get(sort_by) if sort_by else None
    if col_fn is not None:
        sort_col = col_fn(Owner)
        direction = sort_col.desc() if sort_dir == "desc" else sort_col.asc()
        query = query.order_by(direction, Goal.id.asc())
    else:
        query = query.order_by(Goal.created_at.desc(), Goal.id.asc())

    goals = query.offset(pg.offset).limit(pg.limit).all()
    _inject_owner_fields(goals)

    return Page[TeamGoalListResponse](
        items=[TeamGoalListResponse.model_validate(g) for g in goals],
        total=total,
        page=pg.page,
        per_page=pg.per_page,
    )


@router.get("/team/filter-options", response_model=TeamGoalsFilterOptions)
def team_goals_filter_options(
    db: DbSession,
    current_user: CurrentUser,
    goal_type: Optional[str] = None,
):
    """Distinct fiscal years + mentee names across the mentor's non-draft
    team goals. Populates the Team Goals tab's Year + Mentee dropdowns."""
    mentee_ids = _mentee_ids_for(db, current_user)
    if not mentee_ids:
        return TeamGoalsFilterOptions(years=[], mentees=[])

    query, Owner = _team_goals_base_query(db, current_user, mentee_ids)
    if goal_type:
        query = query.filter(Goal.goal_type == goal_type)

    rows = query.with_entities(Goal.cycle_name, Owner.full_name).all()

    years: set[int] = set()
    mentees: set[str] = set()
    for cycle_name, owner_name in rows:
        if owner_name:
            mentees.add(owner_name)
        if cycle_name:
            for token in cycle_name.split():
                if token.isdigit() and len(token) == 4:
                    years.add(int(token))
                    break

    return TeamGoalsFilterOptions(
        years=sorted(years, reverse=True),
        mentees=sorted(mentees),
    )


@router.get("/team/pending", response_model=List[TeamGoalListResponse])
def list_pending_team_goals(
    db: DbSession,
    current_user: CurrentUser,
    goal_type: Optional[str] = None,
):
    """All team goals awaiting mentor action (pending_approval +
    changes_requested), non-paginated. Feeds the Bulk Approve modal so a
    mentor can approve across every page in one shot. The actionable set
    is naturally small (most goals are already approved), so returning it
    un-paginated is safe."""
    mentee_ids = _mentee_ids_for(db, current_user)
    if not mentee_ids:
        return []

    query, _Owner = _team_goals_base_query(db, current_user, mentee_ids)
    if goal_type:
        query = query.filter(Goal.goal_type == goal_type)
    query = query.filter(
        Goal.approval_status.in_([
            ApprovalStatus.PENDING_APPROVAL.value,
            ApprovalStatus.CHANGES_REQUESTED.value,
        ])
    )

    goals = query.order_by(Goal.created_at.desc(), Goal.id.asc()).all()
    _inject_owner_fields(goals)
    return [TeamGoalListResponse.model_validate(g) for g in goals]


# =====================================================================
# ADMIN — ALL GOALS (org-wide, read-only)
# =====================================================================

@router.get("/all", response_model=List[TeamGoalListResponse])
def list_all_goals(
    db: DbSession,
    current_user: CurrentUser,
    fy_year: Optional[int] = Query(None, ge=2000, le=2100),
):
    """Admin-only: org-wide annual goals (every employee) — the read-only
    "All Goals" tab, the goals equivalent of the project-reviews All Reviews
    tab. Pass ``fy_year`` (e.g. 2026) to load just one fiscal year; the tab
    sends the selected Year so the browser only fetches that year, then groups
    by employee + filters/paginates client-side. Drafts (owner-private),
    soft-deleted goals, and deactivated owners are excluded.
    """
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can view all goals.",
        )

    Owner = aliased(User)
    query = (
        db.query(Goal)
        .options(
            joinedload(Goal.owner).joinedload(User.department),
            joinedload(Goal.owner).joinedload(User.designation),
            joinedload(Goal.manager),
            joinedload(Goal.criteria),
        )
        .join(Owner, Goal.user_id == Owner.id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.approval_status != ApprovalStatus.DRAFT.value,
            Goal.is_deleted == False,  # noqa: E712
            Owner.is_deleted == False,  # noqa: E712
        )
    )
    # Year filter — goal cycle_name is "H1 2026"/"H2 2026", so match both
    # halves of the requested fiscal year.
    if fy_year is not None:
        query = query.filter(
            Goal.cycle_name.in_([f"H1 {fy_year}", f"H2 {fy_year}"])
        )

    goals = query.order_by(Owner.full_name.asc(), Goal.created_at.desc()).all()
    _inject_owner_fields(goals)
    return [TeamGoalListResponse.model_validate(g) for g in goals]


@router.get("/{goal_id}", response_model=GoalResponse)
def get_goal(
    goal_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get a single goal by ID, including its nested criteria.
    Access restricted to the owner, their mentor, or org Admins.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    is_manager = current_user.role == "Admin" or (
        goal_owner and goal_owner.mentor_id == current_user.id
    )
    is_owner = goal.user_id == current_user.id

    if not (is_owner or is_manager):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to view this goal.",
        )

    resp = GoalResponse.model_validate(goal)
    settings = _get_settings(db, current_user.org_id)
    _apply_goal_review_visibility(
        resp,
        db,
        current_user.org_id,
        current_user,
        goal_owner.mentor_id if goal_owner else None,
        _cycle_to_fy_label(settings.active_cycle_name),
    )
    return resp


@router.patch("/{goal_id}", response_model=GoalResponse)
def update_goal(
    goal_id: int,
    goal_in: GoalUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update a goal's properties. Owner-only — mentors influence a goal via
    Request Changes (the owner then edits); admins are view-only.

    Locked once approved (the review cycle runs against the approved goal).
    Annual goals also require the annual goal-setting window
    (annual_goals_edit_enabled) to be open. Editing a pending_approval or
    changes_requested goal resets it to DRAFT, so it must be re-submitted for
    a fresh review rather than the mentor approving content changed after the
    fact.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)

    # Only the owner can edit. Mentors act via Request Changes; admins read-only.
    if goal.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the goal's owner can edit it.",
        )

    # Approved / in-review goals are locked.
    if goal.approval_status in POST_APPROVAL_STATES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An approved goal can no longer be edited.",
        )

    # Annual goal-setting window must be open.
    if goal.goal_type == GoalType.ANNUAL.value:
        _assert_annual_gate_open(
            db,
            current_user.org_id,
            _half_label_of_goal(goal),
            user_id=current_user.id,
            action="edit",
        )

    update_data = goal_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(goal, field, value)

    # Editing after submission (pending_approval) or a change request returns
    # the goal to DRAFT so it goes through submit → approve again.
    if goal.approval_status in (
        ApprovalStatus.PENDING_APPROVAL.value,
        ApprovalStatus.CHANGES_REQUESTED.value,
    ):
        goal.approval_status = ApprovalStatus.DRAFT.value

    db.commit()
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(
    goal_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Soft-delete a goal (sets is_deleted=True so its criteria + self/mentor
    review history survive). Owner-only, and only while the goal is still a
    DRAFT — once it has been submitted for approval it can no longer be
    deleted (submit/approval owns the lifecycle from there). Annual goals
    also require the annual goal-setting window to be open.
    """
    goal = db.query(Goal).filter(
        Goal.id == goal_id,
        Goal.org_id == current_user.org_id,
        Goal.is_deleted == False,  # noqa: E712
    ).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found.")

    # Only the owner can delete (mentors/admins cannot).
    if goal.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the goal's owner can delete it.",
        )

    # Deletable only in DRAFT. Once submitted (pending_approval /
    # changes_requested / approved / any review state) it is off-limits.
    if goal.approval_status != ApprovalStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a draft goal can be deleted.",
        )

    # Gate check for annual goal deletion (same window as create/edit).
    if goal.goal_type == GoalType.ANNUAL.value:
        _assert_annual_gate_open(
            db,
            current_user.org_id,
            _half_label_of_goal(goal),
            user_id=current_user.id,
            action="edit",
        )

    # Soft-delete — preserves criteria + review history.
    goal.is_deleted = True
    db.commit()
    return None


# =====================================================================
# WORKFLOW OPERATIONS (Submit & Approve)
# =====================================================================

@router.patch("/{goal_id}/submit", response_model=GoalResponse)
def submit_goal(
    goal_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Move a goal from DRAFT → SUBMITTED.

    Intentionally has no gate check for annual_goals_edit_enabled:
    a user who completed their goal before the window closed should
    still be able to submit it for mentor review.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    # Only the owner submits their own goal (mentors approve; admins view).
    if goal.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the goal's owner can submit it.",
        )

    # Defense-in-depth: if the goal owner's mentor was unassigned after the
    # draft was created, block submission — no one can approve it otherwise.
    if not goal_owner or goal_owner.mentor_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Cannot submit a goal for a user who has no mentor assigned. "
                "Goals require mentor approval — contact an admin to assign a mentor first."
            ),
        )

    if goal.approval_status != ApprovalStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft goals can be submitted.",
        )

    goal.approval_status = ApprovalStatus.PENDING_APPROVAL.value

    # Notify the assigned mentor that a goal now awaits their approval. In-app
    # only — mirrors submit_goal_self_review's mentor ping; the open-window
    # announcement covers the broader "submit your goals" nudge. Added to the
    # session here so it commits atomically with the status change. Skip when
    # the submitter IS the mentor (e.g. an admin-mentor clearing their own
    # queue) so no one notifies themselves.
    if goal_owner.mentor_id != current_user.id:
        create_notification(
            db,
            org_id=current_user.org_id,
            recipient_id=goal_owner.mentor_id,
            category=NotificationCategory.PERSONAL.value,
            type="goal_submitted_for_approval",
            title="Goal awaiting your approval",
            body=f'{goal_owner.full_name} submitted the goal "{goal.title}" for your approval.',
            link="/annual-goals?tab=team",
            entity_type="goal",
            entity_id=goal.id,
            actor_id=current_user.id,
        )

    db.commit()
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.patch("/{goal_id}/approve", response_model=GoalResponse)
def approve_goal(
    goal_id: int,
    approval_in: GoalApprovalUpdate,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    The goal owner's assigned mentor approves or rejects a submitted goal.

    When approved:
        - approval_status → APPROVED
        - approved_at     → current UTC timestamp
          This timestamp enables future period-based filtering:
          e.g. "goals approved during H1 FY26" for dashboards and reports.

    When changes are requested:
        - approval_status → CHANGES_REQUESTED
        - manager_feedback is set with the mentor's comments
        - approved_at remains None (goal was never approved)
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    # Only the goal owner's assigned mentor may approve or reject.
    # Admin role does NOT grant approval authority — Admins manage system
    # settings, not individual goal reviews.  If an Admin is also the
    # assigned mentor for this user they can still approve via that relationship.
    if not goal_owner or goal_owner.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Only the assigned mentor can approve or request changes on this goal. "
                "Contact the goal owner's mentor."
            ),
        )

    if goal.approval_status != ApprovalStatus.PENDING_APPROVAL.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal is not currently awaiting approval.",
        )

    goal.approval_status = approval_in.approval_status.value
    goal.manager_feedback = approval_in.feedback

    # Stamp the approval timestamp only on the APPROVED transition.
    # CHANGES_REQUESTED leaves approved_at as None — the goal was not approved.
    if approval_in.approval_status == ApprovalStatus.APPROVED:
        goal.approved_at = datetime.now(timezone.utc)

    # Notify the goal owner of the mentor's decision. Added to the session
    # here → committed atomically with the status change below.
    if approval_in.approval_status == ApprovalStatus.APPROVED:
        create_notification(
            db,
            org_id=current_user.org_id,
            recipient_id=goal.user_id,
            category=NotificationCategory.PERSONAL.value,
            type="goal_approved",
            title="Goal approved",
            body=f'{current_user.full_name} approved your goal "{goal.title}".',
            link="/annual-goals?tab=my",
            entity_type="goal",
            entity_id=goal.id,
            actor_id=current_user.id,
            email=True,
            background_tasks=background_tasks,
            recipient_email=goal_owner.email,
            cta_label="View goal",
            email_subject=f"Goal Approved: {goal.title}",
            recipient_name=goal_owner.full_name,
            email_intro=(
                f'{current_user.full_name} has approved your goal "{goal.title}".'
            ),
            email_details=[
                ("Goal Name", goal.title),
                ("Approved By", current_user.full_name),
                ("Approved On", goal.approved_at.strftime("%b %d, %Y")),
                ("Status", "Approved"),
            ],
            snapshot_title="Goal Snapshot",
        )
    else:  # CHANGES_REQUESTED — in-app only.
        create_notification(
            db,
            org_id=current_user.org_id,
            recipient_id=goal.user_id,
            category=NotificationCategory.PERSONAL.value,
            type="goal_changes_requested",
            title="Changes requested",
            body=f'{current_user.full_name} requested changes on your goal "{goal.title}".',
            link="/annual-goals?tab=my",
            entity_type="goal",
            entity_id=goal.id,
            actor_id=current_user.id,
        )

    db.commit()
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.post("/{goal_id}/self-review-reminder", status_code=status.HTTP_204_NO_CONTENT)
def remind_goal_self_review(
    goal_id: int,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Mentor nudges a mentee to complete the self-review on an approved goal
    (in-app + email). Manual action from the Team Goals tab.

    Gates:
        - Caller must be the goal owner's assigned mentor.
        - Goal must be in a post-approval state — a self-review is only
          relevant once the goal is approved.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    if not goal_owner or goal_owner.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assigned mentor can send a self-review reminder.",
        )

    if goal.approval_status not in POST_APPROVAL_STATES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Self-review reminders apply only to approved goals.",
        )

    create_notification(
        db,
        org_id=current_user.org_id,
        recipient_id=goal.user_id,
        category=NotificationCategory.PERSONAL.value,
        type="self_review_reminder",
        title="Reminder: complete your self-review",
        body=(
            f'{current_user.full_name} is reminding you to complete your '
            f'self-review for "{goal.title}". Open Annual Goals → My Goals '
            f"to submit it."
        ),
        link="/annual-goals?tab=my",
        entity_type="goal",
        entity_id=goal.id,
        actor_id=current_user.id,
        email=True,
        background_tasks=background_tasks,
        recipient_email=goal_owner.email,
        cta_label="Complete self-review",
        email_subject=f"Reminder: Complete your self-review for {goal.title}",
        recipient_name=goal_owner.full_name,
        email_intro=(
            f'{current_user.full_name} is reminding you to complete your '
            f'self-review for "{goal.title}". To submit it, open Annual Goals '
            f"→ My Goals in your dashboard, or use the button below."
        ),
        email_details=[
            ("Review Name", goal.title),
            ("Reminded By", current_user.full_name),
            ("Status", "Pending Action"),
        ],
        snapshot_title="Review Snapshot",
    )
    db.commit()
    return None


@router.post("/bulk-approve", response_model=GoalBulkApproveResult)
def bulk_approve_goals(
    payload: GoalBulkApproveRequest,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Mentor-side bulk approval. Loads the requested goals (org-scoped),
    validates each one independently against the same rules as the single-
    goal /approve endpoint (mentor must own the relationship; goal must be
    PENDING_APPROVAL), and approves the valid set in a single transaction.

    Returns a per-goal outcome rather than failing the whole batch — so the
    UI can show "approved 8 of 10" when a goal slips state between modal
    open and submit (e.g. another tab approved it first, or the mentee
    edited it back to draft).
    """
    requested_ids = list(dict.fromkeys(payload.goal_ids))  # de-dup, preserve order

    goals = (
        db.query(Goal)
        .filter(
            Goal.id.in_(requested_ids),
            Goal.org_id == current_user.org_id,
            Goal.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    by_id = {g.id: g for g in goals}

    # Pre-fetch all owners in one query so we can do mentor-relationship
    # checks without N round-trips.
    owner_ids = {g.user_id for g in goals}
    owners = db.query(User).filter(User.id.in_(owner_ids)).all() if owner_ids else []
    owner_by_id = {u.id: u for u in owners}

    approved_ids: list[int] = []
    failures: list[GoalBulkApproveFailure] = []
    now = datetime.now(timezone.utc)

    for goal_id in requested_ids:
        goal = by_id.get(goal_id)
        if goal is None:
            failures.append(GoalBulkApproveFailure(
                goal_id=goal_id,
                reason="Goal not found or not in your organization.",
            ))
            continue

        owner = owner_by_id.get(goal.user_id)
        if owner is None or owner.mentor_id != current_user.id:
            failures.append(GoalBulkApproveFailure(
                goal_id=goal_id,
                reason="You are not the assigned mentor for this goal's owner.",
            ))
            continue

        if goal.approval_status != ApprovalStatus.PENDING_APPROVAL.value:
            failures.append(GoalBulkApproveFailure(
                goal_id=goal_id,
                reason="Goal is not currently awaiting approval.",
            ))
            continue

        goal.approval_status = ApprovalStatus.APPROVED.value
        goal.manager_feedback = None
        goal.approved_at = now
        approved_ids.append(goal_id)

        # Same owner notification as the single-goal /approve path.
        create_notification(
            db,
            org_id=current_user.org_id,
            recipient_id=goal.user_id,
            category=NotificationCategory.PERSONAL.value,
            type="goal_approved",
            title="Goal approved",
            body=f'{current_user.full_name} approved your goal "{goal.title}".',
            link="/annual-goals?tab=my",
            entity_type="goal",
            entity_id=goal.id,
            actor_id=current_user.id,
            email=True,
            background_tasks=background_tasks,
            recipient_email=owner.email,
            cta_label="View goal",
        )

    db.commit()
    return GoalBulkApproveResult(approved_ids=approved_ids, failures=failures)


@router.patch(
    "/{goal_id}/self-review/{cycle_half}",
    response_model=GoalResponse,
)
def submit_goal_self_review(
    goal_id: int,
    cycle_half: SelfReviewCycleHalf,
    payload: GoalSelfReviewSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Owner submits their self-review on an APPROVED goal for ONE half
    of the fiscal year (H1 or H2). Advances the goal's approval_status
    to H1_SELF_REVIEWED or H2_SELF_REVIEWED.

    Gates:
        - Only the goal owner may submit.
        - State machine: H1 self requires status APPROVED.
                         H2 self requires status in {APPROVED, H1_SELF_REVIEWED,
                                                     H1_MENTOR_REVIEWED}.
        - Time window: today must be in the (cycle_half, goal.fy_year)
          window — see cycle_utils.is_review_window_open. H1 reviews can
          be backfilled during H2 of the same FY; H2 cannot be pre-empted;
          neither can cross a fiscal-year boundary.
        - One-shot per (goal_id, cycle_half) — DB unique index is the
          final guard; the state machine prevents the case in normal flow.

    On success the updated goal is returned with the full self_reviews
    list (so the frontend can re-render both H1 and H2 rows).
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)

    if goal.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the goal owner can submit a self-review.",
        )

    # Status gate — which states are allowed to *start* this transition?
    half = cycle_half.value
    allowed_states = _self_review_allowed_states(half)
    if goal.approval_status not in allowed_states:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Self-review for {half} cannot be submitted from the "
                f"current state ({goal.approval_status})."
            ),
        )

    # Time-window gate — which calendar moment allows this submission?
    settings = _get_settings(db, current_user.org_id)
    fy_year = _goal_fy_year(goal)
    if fy_year is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal has no fiscal year on record; cannot submit reviews.",
        )
    if not is_review_window_open(half, fy_year, settings.active_cycle_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The review window for {half} FY{fy_year % 100:02d}-"
                f"{(fy_year + 1) % 100:02d} is not currently open."
            ),
        )

    # If a draft row already exists for this half, promote it to submitted
    # (clear is_draft, overwrite text). If a non-draft row exists, the
    # state machine should have caught it — defensive belt-and-suspenders.
    existing = next(
        (sr for sr in goal.self_reviews if sr.cycle_half == half),
        None,
    )
    if existing is not None and not existing.is_draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Self-review for {half} has already been submitted for this goal.",
        )

    if existing is not None:
        # Promote draft → submitted; stamp the real submission time (the row's
        # server_default submitted_at was set when the draft was created).
        existing.self_overall_review = payload.self_overall_review
        existing.is_draft = False
        existing.submitted_at = datetime.now(timezone.utc)
    else:
        review = GoalSelfReview(
            goal_id=goal.id,
            org_id=current_user.org_id,
            cycle_half=half,
            self_overall_review=payload.self_overall_review,
            is_draft=False,
        )
        db.add(review)
    # Advance the goal's lifecycle state.
    goal.approval_status = _max_status(goal.approval_status, _self_reviewed_state(half))

    # Notify the owner's CURRENT mentor that a self-review is ready to review
    # (in-app). Skip when there's no live mentor (unassigned / soft-deleted).
    mentor = (
        db.query(User)
        .filter(User.id == current_user.mentor_id, User.is_deleted == False)  # noqa: E712
        .first()
        if current_user.mentor_id
        else None
    )
    if mentor is not None:
        create_notification(
            db,
            org_id=current_user.org_id,
            recipient_id=mentor.id,
            category=NotificationCategory.PERSONAL.value,
            type="goal_self_review_submitted",
            title="Self-review submitted",
            body=(
                f'{current_user.full_name} submitted their {half} self-review '
                f'on "{goal.title}".'
            ),
            link="/annual-goals?tab=team",
            entity_type="goal",
            entity_id=goal.id,
            actor_id=current_user.id,
        )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A self-review for {half} was just submitted for this goal.",
        )
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.patch(
    "/{goal_id}/self-review/{cycle_half}/draft",
    response_model=GoalResponse,
)
def save_goal_self_review_draft(
    goal_id: int,
    cycle_half: SelfReviewCycleHalf,
    payload: GoalSelfReviewDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Owner saves an in-progress self-review without submitting. Same auth +
    state + time-window gates as the submit endpoint, but the row is
    written with ``is_draft=True`` and the goal's ``approval_status`` is
    NOT advanced. Reopening the form re-uses the draft. The Submit
    endpoint clears ``is_draft`` and advances state.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)

    if goal.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the goal owner can save a self-review draft.",
        )

    half = cycle_half.value
    allowed_states = _self_review_allowed_states(half)
    if goal.approval_status not in allowed_states:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Self-review for {half} cannot be drafted from the current "
                f"state ({goal.approval_status})."
            ),
        )

    settings = _get_settings(db, current_user.org_id)
    fy_year = _goal_fy_year(goal)
    if fy_year is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal has no fiscal year on record; cannot draft reviews.",
        )
    if not is_review_window_open(half, fy_year, settings.active_cycle_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The review window for {half} FY{fy_year % 100:02d}-"
                f"{(fy_year + 1) % 100:02d} is not currently open."
            ),
        )

    existing = next(
        (sr for sr in goal.self_reviews if sr.cycle_half == half),
        None,
    )
    if existing is not None and not existing.is_draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Self-review for {half} has already been submitted; drafts "
                f"can no longer be saved."
            ),
        )

    if existing is not None:
        existing.self_overall_review = payload.self_overall_review
        existing.is_draft = True
    else:
        draft = GoalSelfReview(
            goal_id=goal.id,
            org_id=current_user.org_id,
            cycle_half=half,
            self_overall_review=payload.self_overall_review,
            is_draft=True,
        )
        db.add(draft)
    db.commit()
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.patch(
    "/{goal_id}/mentor-review/{cycle_half}",
    response_model=GoalResponse,
)
def submit_goal_mentor_review(
    goal_id: int,
    cycle_half: SelfReviewCycleHalf,
    payload: GoalMentorReviewSubmit,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Mentor submits their review of a mentee's self-review for one half.
    Advances the goal's approval_status to H1_MENTOR_REVIEWED or
    H2_MENTOR_REVIEWED.

    Gates:
        - Caller must be the goal owner's assigned mentor.
        - State machine: H1 mentor requires status H1_SELF_REVIEWED.
                         H2 mentor requires status H2_SELF_REVIEWED.
          (The state machine implies the mentee has self-reviewed first;
          the explicit row check below is a defensive belt-and-suspenders.)
        - Time window: today must be in the (cycle_half, goal.fy_year)
          window — same rule as self-review.
        - One-shot per (goal_id, cycle_half) — DB unique index is the
          final guard.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    if not goal_owner or goal_owner.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assigned mentor can submit a mentor review.",
        )

    half = cycle_half.value
    # The goal must be in the review phase (approved-or-later). WHICH half can be
    # submitted is governed by the review window + the mentee's submitted
    # self-review ROW (checked below), NOT by the linear scalar — so a mentor can
    # still file an earlier half after an admin rolls the active cycle backward,
    # where the scalar may already sit at a later cycle's state.
    if goal.approval_status not in POST_APPROVAL_STATES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Mentor review for {half} cannot be submitted until the goal is "
                f"approved (current state: {goal.approval_status})."
            ),
        )

    # Time-window gate.
    settings = _get_settings(db, current_user.org_id)
    fy_year = _goal_fy_year(goal)
    if fy_year is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal has no fiscal year on record; cannot submit reviews.",
        )
    if not is_review_window_open(half, fy_year, settings.active_cycle_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The review window for {half} FY{fy_year % 100:02d}-"
                f"{(fy_year + 1) % 100:02d} is not currently open."
            ),
        )

    # The authoritative "mentee has self-reviewed first" gate: the mentee's row
    # for this half must exist AND be submitted (not a draft) before the mentor
    # can submit. Row-based (not scalar-based) so it holds even after an admin
    # rolls the active cycle backward to a half the scalar has already passed.
    mentee_review = next(
        (sr for sr in goal.self_reviews if sr.cycle_half == half and not sr.is_draft),
        None,
    )
    if mentee_review is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The mentee has not yet submitted their self-review for {half}.",
        )
    existing = next(
        (mr for mr in goal.mentor_reviews if mr.cycle_half == half),
        None,
    )
    if existing is not None and not existing.is_draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mentor review for {half} has already been submitted.",
        )

    if existing is not None:
        # Promote draft → submitted; stamp the real submission time (the row's
        # server_default submitted_at was set when the draft was created).
        existing.mentor_overall_review = payload.mentor_overall_review
        existing.is_draft = False
        existing.submitted_at = datetime.now(timezone.utc)
        # Re-attribute to whoever actually submits — covers the case where a
        # new mentor picks up a draft the previous mentor started.
        existing.mentor_id = current_user.id
    else:
        mentor_review = GoalMentorReview(
            goal_id=goal.id,
            org_id=current_user.org_id,
            cycle_half=half,
            mentor_overall_review=payload.mentor_overall_review,
            is_draft=False,
            mentor_id=current_user.id,
        )
        db.add(mentor_review)
    # Advance the goal's lifecycle state.
    goal.approval_status = _max_status(goal.approval_status, _mentor_reviewed_state(half))

    # Notify the goal owner their mentor review is in (in-app + email).
    create_notification(
        db,
        org_id=current_user.org_id,
        recipient_id=goal.user_id,
        category=NotificationCategory.PERSONAL.value,
        type="goal_mentor_review_submitted",
        title="Mentor review submitted",
        body=(
            f'{current_user.full_name} completed the {half} mentor review on '
            f'your goal "{goal.title}".'
        ),
        link="/annual-goals?tab=my",
        entity_type="goal",
        entity_id=goal.id,
        actor_id=current_user.id,
        email=True,
        background_tasks=background_tasks,
        recipient_email=goal_owner.email,
        cta_label="View review",
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A mentor review for {half} was just submitted for this goal.",
        )
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.patch(
    "/{goal_id}/mentor-review/{cycle_half}/draft",
    response_model=GoalResponse,
)
def save_goal_mentor_review_draft(
    goal_id: int,
    cycle_half: SelfReviewCycleHalf,
    payload: GoalMentorReviewDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Mentor saves an in-progress mentor review without submitting. The row is
    written with ``is_draft=True`` and the goal's ``approval_status`` is NOT
    advanced.

    Unlike submit, drafting does NOT require the mentee to have submitted their
    self-review — a mentor can start drafting as soon as the goal is approved
    and this half is active. It still requires: the caller is the assigned
    mentor, the half's review window is open, and no *submitted* mentor review
    exists yet.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    if not goal_owner or goal_owner.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assigned mentor can save a mentor-review draft.",
        )

    half = cycle_half.value
    # Drafting is allowed once the goal is in the review phase (approved-or-later);
    # the mentee's self-review need NOT be submitted yet (that gates SUBMIT only).
    # WHICH half is active is enforced by the review-window check below — so this
    # stays correct after an admin rolls the active cycle backward to an earlier
    # half whose mentor review was never filed (the scalar may sit at a later state).
    if goal.approval_status not in POST_APPROVAL_STATES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Mentor review for {half} can only be drafted once the goal is "
                f"approved (current state: {goal.approval_status})."
            ),
        )

    settings = _get_settings(db, current_user.org_id)
    fy_year = _goal_fy_year(goal)
    if fy_year is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal has no fiscal year on record; cannot draft reviews.",
        )
    if not is_review_window_open(half, fy_year, settings.active_cycle_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The review window for {half} FY{fy_year % 100:02d}-"
                f"{(fy_year + 1) % 100:02d} is not currently open."
            ),
        )

    existing = next(
        (mr for mr in goal.mentor_reviews if mr.cycle_half == half),
        None,
    )
    if existing is not None and not existing.is_draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Mentor review for {half} has already been submitted; drafts "
                f"can no longer be saved."
            ),
        )

    if existing is not None:
        existing.mentor_overall_review = payload.mentor_overall_review
        existing.is_draft = True
        existing.mentor_id = current_user.id
    else:
        draft = GoalMentorReview(
            goal_id=goal.id,
            org_id=current_user.org_id,
            cycle_half=half,
            mentor_overall_review=payload.mentor_overall_review,
            is_draft=True,
            mentor_id=current_user.id,
        )
        db.add(draft)
    db.commit()
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


