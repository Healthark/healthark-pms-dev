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
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.models.goal_models import Goal, GoalStatus, ApprovalStatus
from app.models.goal_criteria_models import GoalCriterion
from app.models.user_models import User
from app.schemas.goal_schemas import (
    GoalCreate,
    GoalUpdate,
    GoalResponse,
    GoalApprovalUpdate,
)

router = APIRouter()

# ── Dependency Helpers ───────────────────────────────────────────────

def _get_goal_with_relations(db: DbSession, goal_id: int, org_id: int) -> Goal:
    """Helper to fetch a goal with eagerly loaded criteria."""
    goal = (
        db.query(Goal)
        .options(joinedload(Goal.criteria))
        .filter(Goal.id == goal_id, Goal.org_id == org_id)
        .first()
    )
    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Goal not found or you don't have access to it.",
        )
    return goal


# =====================================================================
# CORE CRUD OPERATIONS
# =====================================================================

@router.get("/", response_model=List[GoalResponse])
def list_goals(
    db: DbSession,
    current_user: CurrentUser,
    team_only: bool = False,
    status_filter: Optional[str] = None,
):
    """
    List goals.
    - If team_only=False (default), lists the current user's own goals.
    - If team_only=True, lists goals belonging to the user's mentees (or all org goals if Admin).
    """
    query = db.query(Goal).filter(Goal.org_id == current_user.org_id)

    if team_only:
        # Check relationship instead of string role
        if current_user.role == "Admin":
            users = db.query(User).filter(User.org_id == current_user.org_id).all()
            team_ids = [u.id for u in users]
        else:
            team = db.query(User).filter(User.mentor_id == current_user.id, User.org_id == current_user.org_id).all()
            team_ids = [u.id for u in team]
            
        if not team_ids:
            return []  # User has no mentees, so no team goals exist
            
        query = query.filter(Goal.user_id.in_(team_ids))
    else:
        query = query.filter(Goal.user_id == current_user.id)

    if status_filter:
        query = query.filter(Goal.status == status_filter)

    return query.order_by(Goal.created_at.desc()).all()


@router.post("/", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(
    goal_in: GoalCreate,
    db: DbSession,
    current_user: CurrentUser,
    user_id: Optional[int] = None,
):
    """
    Create a new goal.
    - By default, creates a goal for the current user.
    - If user_id is provided, creates a goal for that user (requires mentor relationship or Admin).
    """
    if user_id and user_id != current_user.id:
        target_user = db.query(User).filter(User.id == user_id, User.org_id == current_user.org_id).first()
        if not target_user:
            raise HTTPException(status_code=404, detail="Target user not found.")
        
        # Check if Admin or the mentor of the target user
        if current_user.role != "Admin" and target_user.mentor_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to create goals for this user.",
            )
        target_user_id = user_id
        target_manager_id = target_user.mentor_id
    else:
        target_user_id = current_user.id
        target_manager_id = current_user.mentor_id

    # Create the root Goal object
    new_goal = Goal(
        org_id=current_user.org_id,
        user_id=target_user_id,
        manager_id=target_manager_id,
        title=goal_in.title,
        description=goal_in.description,
        start_date=goal_in.start_date,
        due_date=goal_in.due_date,
        status=GoalStatus.PENDING.value,
        approval_status=ApprovalStatus.DRAFT.value,
    )
    db.add(new_goal)
    db.flush()  # Generates the new_goal.id required for the criteria foreign keys

    # Bulk create associated criteria
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

    # Determine if the caller is an Admin or the mentor for the goal owner
    is_manager = current_user.role == "Admin" or (goal_owner and goal_owner.mentor_id == current_user.id)
    is_owner = goal.user_id == current_user.id

    if not (is_owner or is_manager):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to view this goal.",
        )

    return goal


@router.patch("/{goal_id}", response_model=GoalResponse)
def update_goal(
    goal_id: int,
    goal_in: GoalUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update a goal's properties.
    Cannot be edited if APPROVED, unless the caller is the user's mentor or Admin.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    # Determine if the caller is an Admin or the mentor for the goal owner
    is_manager = current_user.role == "Admin" or (goal_owner and goal_owner.mentor_id == current_user.id)
    is_owner = goal.user_id == current_user.id

    if not (is_owner or is_manager):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to edit this goal.",
        )

    # Business Logic: Approved goals are locked for the employee.
    if goal.approval_status == ApprovalStatus.APPROVED.value and not is_manager:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approved goals cannot be edited. Contact your mentor.",
        )

    # Dynamic Field Updates
    update_data = goal_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(goal, field, value)

    # If the user edits a goal that previously had changes requested,
    # reset it back to draft mode so they can submit it again.
    if is_owner and goal.approval_status == ApprovalStatus.CHANGES_REQUESTED.value:
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
    Permanently delete a goal.
    Only the owner (in draft stage) or their mentor/Admin can delete.
    """
    goal = db.query(Goal).filter(Goal.id == goal_id, Goal.org_id == current_user.org_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found.")
        
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    # Determine if the caller is an Admin or the mentor for the goal owner
    is_manager = current_user.role == "Admin" or (goal_owner and goal_owner.mentor_id == current_user.id)
    is_owner = goal.user_id == current_user.id

    if not (is_owner or is_manager):
        raise HTTPException(status_code=403, detail="Permission denied.")

    # Employees cannot delete goals once they are submitted or approved
    if is_owner and not is_manager and goal.approval_status != ApprovalStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a goal that has already been submitted for approval.",
        )

    db.delete(goal)
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
    Moves a goal from DRAFT to SUBMITTED.
    Once submitted, the employee can no longer edit it.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()
    
    is_manager = current_user.role == "Admin" or (goal_owner and goal_owner.mentor_id == current_user.id)
    is_owner = goal.user_id == current_user.id

    if not (is_owner or is_manager):
        raise HTTPException(status_code=403, detail="Permission denied.")

    if goal.approval_status != ApprovalStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft goals can be submitted.",
        )

    goal.approval_status = ApprovalStatus.SUBMITTED.value
    db.commit()
    
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.patch("/{goal_id}/approve", response_model=GoalResponse)
def approve_goal(
    goal_id: int,
    approval_in: GoalApprovalUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Mentor/Admin approves or rejects a submitted goal.
    Provides optional manager feedback.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    # Verify relationship (must be Admin or the goal owner's mentor)
    if current_user.role != "Admin" and (not goal_owner or goal_owner.mentor_id != current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to approve goals for this user."
        )

    if goal.approval_status != ApprovalStatus.SUBMITTED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal is not currently awaiting approval.",
        )

    # Apply the approval status from the request schema
    goal.approval_status = approval_in.approval_status.value
    goal.manager_feedback = approval_in.feedback

    db.commit()
    return _get_goal_with_relations(db, goal.id, current_user.org_id)