from typing import List
from fastapi import APIRouter, HTTPException, status
from app.api.dependencies import DbSession, CurrentUser
from app.models.goal_models import Goal
from app.schemas.goal_schemas import GoalCreate, GoalResponse, GoalUpdate

router = APIRouter()

@router.post("/", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(
    goal_in: GoalCreate,
    db: DbSession,
    current_user: CurrentUser  # <-- The Architect's Lock!
):
    """
    Create a new performance goal.
    """
    # 1. Security Check: Are you allowed to assign this goal?
    # (For now, we just ensure the user being assigned is in the same Org)
    if goal_in.user_id != current_user.id and current_user.role not in ["Admin", "Manager", "Principal"]:
         raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to assign goals to other users."
        )

    # 2. Map the Pydantic Schema into a SQLAlchemy Model
    new_goal = Goal(
        org_id=current_user.org_id, # Tenant Isolation: Force the org_id to match the creator
        user_id=goal_in.user_id,
        manager_id=goal_in.manager_id,
        title=goal_in.title,
        description=goal_in.description,
        status=goal_in.status.value, # Enum extraction
        start_date=goal_in.start_date,
        due_date=goal_in.due_date
    )
    
    # 3. Save to database
    db.add(new_goal)
    db.commit()
    db.refresh(new_goal)
    
    return new_goal


@router.get("/", response_model=List[GoalResponse])
def get_goals(
    db: DbSession,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100
):
    """
    Retrieve all goals for the user's organization.
    """
    # Tenant Isolation: Notice how we ONLY query goals where the org_id matches our logged-in user.
    # This prevents Company A from ever seeing Company B's data.
    goals = (
        db.query(Goal)
        .filter(Goal.org_id == current_user.org_id)
        .offset(skip)
        .limit(limit)
        .all()
    )
    return goals

@router.patch("/{goal_id}", response_model=GoalResponse)
def update_goal(
    goal_id: int,
    goal_in: GoalUpdate, # Uses the schema where everything is Optional
    db: DbSession,
    current_user: CurrentUser
):
    """
    Update a goal's progress, status, or details.
    """
    # 1. Find the goal and ensure it belongs to the user's organization
    goal = db.query(Goal).filter(
        Goal.id == goal_id,
        Goal.org_id == current_user.org_id
    ).first()

    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")

    # 2. Security: Only the owner or a Manager/Admin can edit the goal
    if goal.user_id != current_user.id and current_user.role not in ["Admin", "Manager", "Principal"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to edit this goal"
        )

    # 3. Update the fields dynamically
    # Pydantic's model_dump(exclude_unset=True) is magic. It only extracts 
    # the exact fields the frontend actually sent us.
    update_data = goal_in.model_dump(exclude_unset=True)
    
    for field, value in update_data.items():
        setattr(goal, field, value)

    # 4. Save and return
    db.commit()
    db.refresh(goal)
    return goal