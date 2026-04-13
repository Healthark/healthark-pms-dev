# Import all models here so Alembic can discover them easily
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.goal_models import Goal
from app.models.system_settings_models import SystemSettings
from app.models.goal_criteria_models import GoalCriterion
from app.models.annual_review_models import AnnualReview
