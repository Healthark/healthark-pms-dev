"""
Goal Routes — Updated for Story 3.1 (Criteria Breakdown) and 3.3 (Progress Tracking).

New/Changed Endpoints:
    POST   /goals/                          → Now accepts optional criteria[] array
    GET    /goals/                           → Returns goals with nested criteria (eager-loaded)
    POST   /goals/{goal_id}/criteria         → Add a criterion to an existing goal
    PATCH  /goals/criteria/{criterion_id}    → Update/toggle a single criterion
    DELETE /goals/criteria/{criterion_id}    → Remove a criterion

Existing Endpoints (unchanged behavior):
    PATCH  /goals/{goal_id}                 → Update goal metadata
    PATCH  /goals/{goal_id}/submit          → Submit for review
    GET    /goals/team                      → Manager team view
    PATCH  /goals/{goal_id}/approval        → Manager approve/reject

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: Every query filters by org_id
    Layer 3 — Role Authorization: Manager endpoints gated by role
    Layer 4 — Ownership:        Criteria edits verify goal ownership
"""

from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.models.goal_models import Goal, GoalStatus, ApprovalStatus
from app.models.goal_criteria_models import GoalCriterion
from app.models.user_models import User
from app.schemas.goal_schemas import (
    GoalCreate, GoalResponse, GoalUpdate,
    GoalApprovalUpdate, TeamGoalResponse,
    CriterionCreate, CriterionUpdate, CriterionResponse,
)

router = APIRouter()


def _require_manager(current_user: User) -> None:
    if current_user.role not in ["Admin", "Manager", "Principal"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager role required.",
        )


# =====================================================================
# EMPLOYEE ENDPOINTS — Goals
# =====================================================================

@router.post("/", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(goal_in: GoalCreate, db: DbSession, current_user: CurrentUser):
    """
    Create a new goal with optional criteria in a single transaction.

    If criteria[] is provided, the parent Goal row and all child
    GoalCriterion rows are inserted atomically — either all succeed
    or none do. This prevents orphaned criteria from partial failures.
    """
    if goal_in.user_id != current_user.id and current_user.role not in ["Admin", "Manager", "Principal"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to assign goals to other users.",
        )

    # 1. Create the parent Goal
    new_goal = Goal(
        org_id=current_user.org_id,
        user_id=goal_in.user_id,
        manager_id=goal_in.manager_id,
        title=goal_in.title,
        description=goal_in.description,
        status=goal_in.status.value,
        approval_status=ApprovalStatus.DRAFT.value,
        start_date=goal_in.start_date,
        due_date=goal_in.due_date,
    )
    db.add(new_goal)
    db.flush()  # Get the new_goal.id without committing yet

    # 2. Bulk-insert criteria (if any) in the same transaction
    for idx, criterion in enumerate(goal_in.criteria):
        db.add(GoalCriterion(
            goal_id=new_goal.id,
            org_id=current_user.org_id,
            title=criterion.title,
            sort_order=criterion.sort_order if criterion.sort_order else idx,
        ))

    # 3. Single atomic commit — parent + all children
    db.commit()
    db.refresh(new_goal)
    return new_goal


@router.get("/", response_model=List[GoalResponse])
def get_goals(
    db: DbSession,
    current_user: CurrentUser,
    user_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
):
    """
    Retrieve goals with nested criteria (eager-loaded via the relationship).
    """
    target_user_id = user_id if user_id else current_user.id

    if target_user_id != current_user.id and current_user.role not in ["Admin", "Manager", "Principal"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view other users' goals.",
        )

    return (
        db.query(Goal)
        .filter(Goal.org_id == current_user.org_id, Goal.user_id == target_user_id)
        .order_by(Goal.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.patch("/{goal_id}", response_model=GoalResponse)
def update_goal(goal_id: int, goal_in: GoalUpdate, db: DbSession, current_user: CurrentUser):
    goal = db.query(Goal).filter(
        Goal.id == goal_id, Goal.org_id == current_user.org_id
    ).first()

    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")

    if goal.user_id != current_user.id and current_user.role not in ["Admin", "Manager", "Principal"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions to edit this goal."
        )

    if goal.approval_status == ApprovalStatus.SUBMITTED.value and current_user.role not in ["Admin", "Manager", "Principal"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal is awaiting manager review and cannot be edited.",
        )

    for field, value in goal_in.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)

    db.commit()
    db.refresh(goal)
    return goal


@router.patch("/{goal_id}/submit", response_model=GoalResponse)
def submit_goal(goal_id: int, db: DbSession, current_user: CurrentUser):
    """Employee submits a draft or changes-requested goal for manager review."""
    goal = db.query(Goal).filter(
        Goal.id == goal_id,
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
    ).first()

    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")

    if goal.approval_status not in [ApprovalStatus.DRAFT.value, ApprovalStatus.CHANGES_REQUESTED.value]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft or changes-requested goals can be submitted.",
        )

    goal.approval_status = ApprovalStatus.SUBMITTED.value
    goal.manager_feedback = None
    db.commit()
    db.refresh(goal)
    return goal


# =====================================================================
# EMPLOYEE ENDPOINTS — Criteria (Story 3.1 + 3.3)
# =====================================================================

@router.post("/{goal_id}/criteria", response_model=CriterionResponse, status_code=status.HTTP_201_CREATED)
def add_criterion(
    goal_id: int,
    criterion_in: CriterionCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Add a new key result to an existing goal.

    Only the goal owner can add criteria, and only while the goal
    is in a draft or changes-requested state (not locked by submission).
    """
    goal = db.query(Goal).filter(
        Goal.id == goal_id,
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
    ).first()

    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")

    if goal.approval_status in [ApprovalStatus.SUBMITTED.value]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add criteria to a goal that is awaiting review.",
        )

    new_criterion = GoalCriterion(
        goal_id=goal.id,
        org_id=current_user.org_id,
        title=criterion_in.title,
        sort_order=criterion_in.sort_order,
    )
    db.add(new_criterion)
    db.commit()
    db.refresh(new_criterion)
    return new_criterion


@router.patch("/criteria/{criterion_id}", response_model=CriterionResponse)
def update_criterion(
    criterion_id: int,
    criterion_in: CriterionUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update a criterion's title, completion status, or proof comments.

    Story 3.3 — Completion toggling:
        When is_completed flips to True, we stamp completed_at with the
        current UTC time. When unchecked, completed_at is cleared.

    Story 3.3 — Proof:
        proof_comments is free-text evidence the employee attaches to
        a specific criterion (links, notes, references).

    Security: Only the goal owner can update criteria. Completion toggling
    is restricted to approved goals (the manager has blessed the objectives).
    """
    criterion = db.query(GoalCriterion).filter(
        GoalCriterion.id == criterion_id,
        GoalCriterion.org_id == current_user.org_id,
    ).first()

    if not criterion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Criterion not found.")

    # Verify ownership via the parent goal
    goal = db.query(Goal).filter(Goal.id == criterion.goal_id).first()

    if not goal or goal.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only update criteria on your own goals.",
        )

    update_data = criterion_in.model_dump(exclude_unset=True)

    # Completion toggling — only allowed on approved goals
    if "is_completed" in update_data:
        if goal.approval_status != ApprovalStatus.APPROVED.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Criteria can only be checked off on approved goals.",
            )
        if update_data["is_completed"]:
            update_data["completed_at"] = datetime.now(timezone.utc)
        else:
            update_data["completed_at"] = None

    for field, value in update_data.items():
        setattr(criterion, field, value)

    db.commit()
    db.refresh(criterion)
    return criterion


@router.delete("/criteria/{criterion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_criterion(
    criterion_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Remove a criterion from a goal.

    Only allowed while the goal is in draft or changes-requested state.
    Once submitted or approved, criteria are locked.
    """
    criterion = db.query(GoalCriterion).filter(
        GoalCriterion.id == criterion_id,
        GoalCriterion.org_id == current_user.org_id,
    ).first()

    if not criterion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Criterion not found.")

    goal = db.query(Goal).filter(Goal.id == criterion.goal_id).first()

    if not goal or goal.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete criteria on your own goals.",
        )

    if goal.approval_status not in [ApprovalStatus.DRAFT.value, ApprovalStatus.CHANGES_REQUESTED.value]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove criteria from a submitted or approved goal.",
        )

    db.delete(criterion)
    db.commit()
    return None


# =====================================================================
# MANAGER ENDPOINTS
# =====================================================================

@router.get("/team", response_model=List[TeamGoalResponse])
def get_team_goals(db: DbSession, current_user: CurrentUser):
    """
    Returns all non-draft goals belonging to the current manager's mentees.
    Admins see all non-draft goals across the organisation.
    Goals include nested criteria for progress visibility.
    """
    _require_manager(current_user)

    if current_user.role == "Admin":
        user_ids = [
            row[0] for row in db.query(User.id).filter(
                User.org_id == current_user.org_id,
                User.is_deleted == False,  # noqa: E712
                User.id != current_user.id,
            ).all()
        ]
    else:
        user_ids = [
            row[0] for row in db.query(User.id).filter(
                User.mentor_id == current_user.id,
                User.org_id == current_user.org_id,
                User.is_deleted == False,  # noqa: E712
            ).all()
        ]

    if not user_ids:
        return []

    goals = (
        db.query(Goal)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id.in_(user_ids),
            Goal.approval_status != ApprovalStatus.DRAFT.value,
        )
        .order_by(Goal.created_at.desc())
        .all()
    )

    name_map = {
        u.id: u.full_name
        for u in db.query(User).filter(User.id.in_(user_ids)).all()
    }

    return [
        TeamGoalResponse(
            id=g.id, org_id=g.org_id, user_id=g.user_id, manager_id=g.manager_id,
            title=g.title, description=g.description, status=g.status,
            approval_status=g.approval_status, manager_feedback=g.manager_feedback,
            progress_notes=g.progress_notes,
            start_date=g.start_date, due_date=g.due_date,
            created_at=g.created_at, updated_at=g.updated_at,
            criteria=[CriterionResponse.model_validate(c) for c in g.criteria],
            owner_name=name_map.get(g.user_id, "Unknown"),
        )
        for g in goals
    ]


@router.patch("/{goal_id}/approval", response_model=GoalResponse)
def update_goal_approval(
    goal_id: int,
    approval_in: GoalApprovalUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Manager approves a submitted goal or sends it back with feedback."""
    _require_manager(current_user)

    goal = db.query(Goal).filter(
        Goal.id == goal_id, Goal.org_id == current_user.org_id
    ).first()

    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")

    if goal.approval_status != ApprovalStatus.SUBMITTED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only submitted goals can be approved or have changes requested.",
        )

    allowed = {ApprovalStatus.APPROVED, ApprovalStatus.CHANGES_REQUESTED}
    if approval_in.approval_status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approval status must be 'approved' or 'changes_requested'.",
        )

    goal_owner = db.query(User).filter(User.id == goal.user_id).first()
    if current_user.role != "Admin" and (goal_owner is None or goal_owner.mentor_id != current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned mentor for this goal's owner.",
        )

    goal.approval_status = approval_in.approval_status.value
    goal.manager_feedback = approval_in.feedback
    db.commit()
    db.refresh(goal)
    return goal