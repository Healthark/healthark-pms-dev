"""
seed-production.py - DESTRUCTIVE production-database first-load.

Intended for the Supabase Postgres demo environment. Wipes every domain
table in FK-safe order, then re-seeds a clean Healthark org with exactly
3 HR admin users.

WARNING: This will DELETE ALL DATA in the database pointed to by
DATABASE_URL. Requires interactive confirmation ("WIPE AND SEED") before
proceeding. Pass --yes to skip the confirmation in deploy automation.

Final state:
  Organization:  Healthark (domain: healtharkinsights.com)
  Departments:   Strategy, IDT, RWE, Marketing, HR
  Designations:  Consultant, Senior Consultant, Manager, Senior Manager,
                 Associate Director, Director,
                 HR Executive, Senior HR Executive, Head HR
  Users (all role=Admin, password=password123):
    Amol Pandya      amol@healtharkinsights.com      Head HR              is_management=True   (no mentor)
    Devanshi Shukla  devanshi@healtharkinsights.com  Senior HR Executive  mentor=Amol
    Trapti Tiwari    trapti@healtharkinsights.com    HR Executive         mentor=Devanshi

Run:
  cd backend && python seed-production.py
  cd backend && python seed-production.py --yes   # non-interactive
"""

import sys
from urllib.parse import urlparse, urlunparse

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash

from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.system_settings_models import SystemSettings, CycleType

from app.models.password_reset_token_models import PasswordResetToken
from app.models.goal_notification_models import GoalNotification
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.goal_self_review_models import GoalSelfReview
from app.models.goal_criteria_models import GoalCriterion
from app.models.goal_models import Goal
from app.models.role_expectation_models import RoleExpectation
from app.models.annual_review_models import AnnualReview
from app.models.project_review_models import ProjectReview, ProjectReviewEvaluator
from app.models.project_models import Project, ProjectAssignment


PASSWORD = "password123"


def _sanitize_db_url(url: str) -> str:
    """Strip the password from a DB URL so it's safe to print."""
    try:
        parts = urlparse(url)
        if parts.password:
            netloc = parts.netloc.replace(f":{parts.password}@", ":****@")
            parts = parts._replace(netloc=netloc)
        return urlunparse(parts)
    except Exception:
        return "<unparseable DATABASE_URL>"


def _wipe_all(db):
    """Delete every domain row in FK-safe (child -> parent) order."""
    print("Wiping existing data...")

    # Tables that reference users/goals/projects/etc.
    wipe_order = [
        PasswordResetToken,
        GoalNotification,
        GoalMentorReview,
        GoalSelfReview,
        GoalCriterion,
        Goal,
        RoleExpectation,
        AnnualReview,
        ProjectReviewEvaluator,
        ProjectReview,
        ProjectAssignment,
        Project,
        SystemSettings,
    ]
    for model in wipe_order:
        n = db.query(model).delete(synchronize_session=False)
        print(f"  wiped {n:>4} rows from {model.__tablename__}")

    # Break the User self-FK before deleting so any mentor chain is harmless.
    db.query(User).update({User.mentor_id: None}, synchronize_session=False)
    db.flush()

    for model in (User, Designation, Department, Organization):
        n = db.query(model).delete(synchronize_session=False)
        print(f"  wiped {n:>4} rows from {model.__tablename__}")

    db.commit()


def _seed_org(db) -> Organization:
    org = Organization(
        name="Healthark",
        domain="healtharkinsights.com",
        enabled_features=[
            "dashboard", "goals", "project_reviews",
            "annual_reviews", "mentoring", "admin",
        ],
    )
    db.add(org)
    db.flush()
    print(f"  [+] Organization: Healthark ({org.domain})")
    return org


def _seed_reference_data(db, org):
    dept_names = ["Strategy", "IDT", "RWE", "Marketing", "HR"]
    depts = {n: Department(org_id=org.id, name=n) for n in dept_names}
    db.add_all(depts.values())

    desig_specs = [
        # Existing org-wide ladder (mirrors seed.py).
        ("Consultant",          1),
        ("Senior Consultant",   2),
        ("Manager",             3),
        ("Senior Manager",      4),
        ("Associate Director",  5),
        ("Director",            6),
        # New HR-track designations.
        ("HR Executive",        1),
        ("Senior HR Executive", 2),
        ("Head HR",             4),
    ]
    desigs = {
        name: Designation(org_id=org.id, name=name, level=level)
        for name, level in desig_specs
    }
    db.add_all(desigs.values())
    db.flush()

    print(f"  [+] Departments: {', '.join(dept_names)}")
    print(f"  [+] Designations: {', '.join(d[0] for d in desig_specs)}")
    return depts, desigs


def _seed_users(db, org, depts, desigs):
    pw = get_password_hash(PASSWORD)
    hr_dept = depts["HR"]

    amol = User(
        org_id=org.id,
        department_id=hr_dept.id,
        designation_id=desigs["Head HR"].id,
        employee_code="HRK-001",
        full_name="Amol Pandya",
        email="amol@healtharkinsights.com",
        role="Admin",
        is_management=True,
        password_hash=pw,
        must_change_password=False,
    )
    devanshi = User(
        org_id=org.id,
        department_id=hr_dept.id,
        designation_id=desigs["Senior HR Executive"].id,
        employee_code="HRK-002",
        full_name="Devanshi Shukla",
        email="devanshi@healtharkinsights.com",
        role="Admin",
        is_management=False,
        password_hash=pw,
        must_change_password=False,
    )
    trapti = User(
        org_id=org.id,
        department_id=hr_dept.id,
        designation_id=desigs["HR Executive"].id,
        employee_code="HRK-003",
        full_name="Trapti Tiwari",
        email="trapti@healtharkinsights.com",
        role="Admin",
        is_management=False,
        password_hash=pw,
        must_change_password=False,
    )
    db.add_all([amol, devanshi, trapti])
    db.flush()

    devanshi.mentor_id = amol.id
    trapti.mentor_id = devanshi.id
    db.flush()

    print("  [+] Users:")
    print(f"      - {amol.email}      (Head HR, is_management=True)")
    print(f"      - {devanshi.email}  (Senior HR Executive, mentor=Amol)")
    print(f"      - {trapti.email}    (HR Executive, mentor=Devanshi)")

    return {"amol": amol, "devanshi": devanshi, "trapti": trapti}


def _seed_system_settings(db, org, admin_user):
    db.add(SystemSettings(
        org_id=org.id,
        active_cycle_name="H1 FY26-27",
        cycle_type=CycleType.HALF_YEARLY.value,
        fiscal_start_month=4,
        goals_submission_open=True,
        reviews_submission_open=True,
        annual_goals_edit_enabled=True,
        updated_by_id=admin_user.id,
    ))
    db.flush()
    print("  [+] SystemSettings: H1 FY26-27 (Half Yearly)")


def _print_summary(users):
    print()
    print("=" * 60)
    print("Seeded production data — login with password: password123")
    print("=" * 60)
    print(f"  Amol Pandya     | {users['amol'].email}     | Head HR              | Admin + Management")
    print(f"  Devanshi Shukla | {users['devanshi'].email} | Senior HR Executive  | Admin (mentee of Amol)")
    print(f"  Trapti Tiwari   | {users['trapti'].email}   | HR Executive         | Admin (mentee of Devanshi)")
    print("=" * 60)


def seed_production(skip_confirm: bool = False):
    print(f"Target database: {_sanitize_db_url(settings.DATABASE_URL)}")
    print("!!! THIS WILL DELETE ALL DATA in the target database !!!")
    if not skip_confirm:
        if input("Type 'WIPE AND SEED' to continue: ").strip() != "WIPE AND SEED":
            print("Aborted.")
            return

    db = SessionLocal()
    try:
        _wipe_all(db)
        org = _seed_org(db)
        depts, desigs = _seed_reference_data(db, org)
        users = _seed_users(db, org, depts, desigs)
        _seed_system_settings(db, org, users["amol"])
        db.commit()

        # Hard guarantee the operator asked for: only these 3 users exist.
        user_count = db.query(User).count()
        org_count = db.query(Organization).count()
        assert user_count == 3, f"expected exactly 3 users, found {user_count}"
        assert org_count == 1, f"expected exactly 1 organization, found {org_count}"

        _print_summary(users)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_production(skip_confirm="--yes" in sys.argv)
