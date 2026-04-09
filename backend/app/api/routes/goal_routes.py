from typing import List, Optional
from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.models.goal_models import Goal, GoalStatus, ApprovalStatus
from app.models.user_models import User
from app.schemas.goal_schemas import (
    GoalCreate, GoalResponse, GoalUpdate,
    GoalApprovalUpdate, TeamGoalResponse,
)

router = APIRouter()


def _require_manager(current_user: User) -> None:
    if current_user.role not in ["Admin", "Manager", "Principal"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager role required.",
        )


# ---------------------------------------------------------------------------
# Employee endpoints
# ---------------------------------------------------------------------------

@router.post("/", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(goal_in: GoalCreate, db: DbSession, current_user: CurrentUser):
    if goal_in.user_id != current_user.id and current_user.role not in ["Admin", "Manager", "Principal"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to assign goals to other users.",
        )

    new_goal = Goal(
        org_id=current_user.org_id,
        user_id=goal_in.user_id,
        manager_id=goal_in.manager_id,
        title=goal_in.title,
        description=goal_in.description,
        status=goal_in.status.value,
        approval_status=ApprovalStatus.DRAFT.value,   # Always starts as draft
        start_date=goal_in.start_date,
        due_date=goal_in.due_date,
    )
    db.add(new_goal)
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

    # Submitted goals are locked until the manager acts on them
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
        Goal.user_id == current_user.id,   # Must be the owner
    ).first()

    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")

    if goal.approval_status not in [ApprovalStatus.DRAFT.value, ApprovalStatus.CHANGES_REQUESTED.value]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft or changes-requested goals can be submitted.",
        )

    goal.approval_status  = ApprovalStatus.SUBMITTED.value
    goal.manager_feedback = None   # Clear previous feedback on resubmit
    db.commit()
    db.refresh(goal)
    return goal


# ---------------------------------------------------------------------------
# Manager endpoints
# ---------------------------------------------------------------------------

@router.get("/team", response_model=List[TeamGoalResponse])
def get_team_goals(db: DbSession, current_user: CurrentUser):
    """
    Returns all non-draft goals belonging to the current manager's mentees.
    Admins see all non-draft goals across the organisation.
    """
    _require_manager(current_user)

    if current_user.role == "Admin":
        user_ids = [
            row[0] for row in db.query(User.id).filter(
                User.org_id == current_user.org_id,
                User.is_deleted == False,
                User.id != current_user.id,
            ).all()
        ]
    else:
        user_ids = [
            row[0] for row in db.query(User.id).filter(
                User.mentor_id == current_user.id,
                User.org_id == current_user.org_id,
                User.is_deleted == False,
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
            start_date=g.start_date, due_date=g.due_date,
            created_at=g.created_at, updated_at=g.updated_at,
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

    # Verify the caller is the assigned mentor of the goal's owner, or an Admin
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()
    if current_user.role != "Admin" and (goal_owner is None or goal_owner.mentor_id != current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned mentor for this goal's owner.",
        )

    goal.approval_status  = approval_in.approval_status.value
    goal.manager_feedback = approval_in.feedback
    db.commit()
    db.refresh(goal)
    return goal