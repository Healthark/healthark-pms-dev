from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from app.api.dependencies import DbSession, CurrentUser
from app.models.goal_models import Goal
from app.schemas.goal_schemas import GoalCreate, GoalResponse, GoalUpdate

router = APIRouter()


@router.post("/", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(
    goal_in: GoalCreate,
    db: DbSession,
    current_user: CurrentUser,
):
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
    """
    Returns goals filtered by user.
    Defaults to the current user's own goals.
    Managers/Admins may pass ?user_id= to view a specific employee's goals.
    """
    target_user_id = user_id if user_id else current_user.id

    # Security: non-privileged users can only query their own goals
    if target_user_id != current_user.id and current_user.role not in ["Admin", "Manager", "Principal"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view other users' goals.",
        )

    return (
        db.query(Goal)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == target_user_id,
        )
        .order_by(Goal.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.patch("/{goal_id}", response_model=GoalResponse)
def update_goal(
    goal_id: int,
    goal_in: GoalUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    goal = db.query(Goal).filter(
        Goal.id == goal_id,
        Goal.org_id == current_user.org_id,
    ).first()

    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")

    if goal.user_id != current_user.id and current_user.role not in ["Admin", "Manager", "Principal"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to edit this goal.",
        )

    for field, value in goal_in.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)

    db.commit()
    db.refresh(goal)
    return goal