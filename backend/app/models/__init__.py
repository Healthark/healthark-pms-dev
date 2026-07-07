# Import all models here so Alembic can discover them easily
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.goal_models import Goal
from app.models.system_settings_models import SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.goal_criteria_models import GoalCriterion
from app.models.goal_self_review_models import GoalSelfReview, SelfReviewCycleHalf
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.notification_models import Notification, NotificationCategory
from app.models.annual_review_models import AnnualReview
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import ProjectReview, ProjectReviewEvaluator
from app.models.role_expectation_models import RoleExpectation
from app.models.competency_models import Competency
from app.models.password_reset_token_models import PasswordResetToken
from app.models.export_audit_log_models import ExportAuditLog
from app.models.login_attempt_models import LoginAttempt
from app.models.cycle_rollout_log_models import CycleRolloutLog
from app.models.goal_access_override_models import GoalAccessOverride
from app.models.support_models import SupportTicket, SupportTicketPhoto
