"""
test-seed.py - DESTRUCTIVE production-level test seed.

Wipes every domain table in FK-safe order, then re-seeds a clean Healthark
org with the fixed 13-person roster + hierarchy agreed for production testing.

WARNING: This DELETES ALL DATA in the database pointed to by DATABASE_URL.
Requires interactive confirmation ("WIPE AND SEED") before proceeding.
Pass --yes to skip the confirmation in deploy automation.

Roster (all role per note below, password=password123):
  Purav Gandhi     drpuravgandhi@healthark.ai  Director       Strategy  Admin+Mgmt  (no mentor)
  Sudeep Krishna   ski@healthark.ai            Director       Strategy  Admin+Mgmt  (no mentor)
  Amol Pandya      amol@healthark.ai           Head HR             HR        Admin+Mgmt  mentor=Purav
  Dhaval Vasavada  dhaval@healthark.ai         Associate Director  IDT       Admin       mentor=Purav
  Shreshta Anantha shreshta@healthark.ai       Associate Director  RWE       Admin       mentor=Sudeep
  Ritu Baliya      ritu@healthark.ai           Associate Director  Strategy  Admin       mentor=Sudeep
  Amol Pandya  → mentor of Devanshi
  Dhaval       → mentor of Aakash, Zaahid
  Shreshta     → mentor of Divya
  Ritu         → mentor of Riya Doshi
  Riya         → mentor of Shivang
  Shivang      → mentor of Dhruv
  Divya Jariwala   divya@healthark.ai          Consultant          RWE       Staff  mentor=Shreshta
  Riya Doshi       riya@healthark.ai           Senior Consultant   Strategy  Staff  mentor=Ritu
  Shivang Bhagat   shivang@healthark.ai        Manager             Strategy  Staff  mentor=Riya
  Dhruv Soni       dhruv.s@healthark.ai        Consultant        Strategy  Staff  mentor=Shivang
  Aakash Pawar     aakash.p@healthark.ai       Senior Consultant IDT       Staff  mentor=Dhaval
  Zaahid Vohra     zaahid@healthark.ai         Consultant        IDT       Staff  mentor=Dhaval
  Devanshi Shukla  devanshi@healthark.ai       Senior HR Exec    HR        Staff  mentor=Amol

Seeded per the requirement:
  - Each user: 1 approved + 1 draft + 1 changes-requested annual goal for the
    current year (H1 2026 → FY26-27).
  - 1 completed project per department (Strategy / IDT / RWE / HR) for FY25-26,
    each with reviewed Project Reviews (PM + secondary evaluator impact),
    completed Annual ("Management") Reviews, and 360 feedback (with remarks).

Run:
  cd backend && python test-seed.py
  cd backend && python test-seed.py --yes   # non-interactive
"""

import hashlib
import hmac
import sys
from datetime import date, datetime, timezone
from urllib.parse import urlparse, urlunparse

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash

from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.system_settings_year_override_models import SystemSettingsYearOverride

from app.models.password_reset_token_models import PasswordResetToken
from app.models.login_attempt_models import LoginAttempt
from app.models.notification_models import Notification
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.goal_self_review_models import GoalSelfReview
from app.models.goal_criteria_models import GoalCriterion
from app.models.goal_models import Goal
from app.models.role_expectation_models import RoleExpectation
from app.models.annual_review_models import AnnualReview
from app.models.project_review_models import ProjectReview, ProjectReviewEvaluator
from app.models.project_models import Project, ProjectAssignment, PROJECT_STATUS_COMPLETED
from app.models.feedback_360_models import Feedback360Review, Feedback360Answer
from app.models.export_audit_log_models import ExportAuditLog


PASSWORD = "password123"

# Current cycle: today is in FY26-27 (fiscal year starts April; FY year = 2026).
# Annual goals are stamped "H1 2026" (healthark goal-cycle shape) and resolve to
# the FY26-27 override. The completed-year review data is FY25-26 (FY year 2025).
GOAL_CYCLE_NAME = "H1 2026"
GOAL_FY_YEAR = 2026
GOAL_APPROVED_AT = datetime(2026, 4, 20, tzinfo=timezone.utc)

CURRENT_FY_LABEL = "FY26-27"
COMPLETED_FY_LABEL = "FY25-26"
COMPLETED_ANNUAL_CYCLE = "FY25-26"
COMPLETED_PROJECT_CYCLE = "H1 FY25-26"
F360_FY = 2025  # FY25-26 → fiscal-year-start integer key used by the 360 module.


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


# ====================================================================== #
# WIPE                                                                    #
# ====================================================================== #

def _wipe_all(db):
    """Delete every domain row in FK-safe (child -> parent) order."""
    print("Wiping existing data...")

    wipe_order = [
        Feedback360Answer,
        Feedback360Review,
        ExportAuditLog,
        PasswordResetToken,
        LoginAttempt,
        Notification,
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
        SystemSettingsYearOverride,
        SystemSettings,
    ]
    for model in wipe_order:
        n = db.query(model).delete(synchronize_session=False)
        print(f"  wiped {n:>4} rows from {model.__tablename__}")

    # Break the User self-FK before deleting so the mentor chain is harmless.
    db.query(User).update({User.mentor_id: None}, synchronize_session=False)
    db.flush()

    for model in (User, Designation, Department, Organization):
        n = db.query(model).delete(synchronize_session=False)
        print(f"  wiped {n:>4} rows from {model.__tablename__}")

    db.commit()


# ====================================================================== #
# ORG + REFERENCE DATA                                                    #
# ====================================================================== #

def _seed_org(db) -> Organization:
    org = Organization(
        name="Healthark",
        domain="healthark.ai",
        enabled_features=[
            "dashboard", "goals", "project_reviews",
            "annual_reviews", "mentoring", "admin", "feedback_360",
        ],
    )
    db.add(org)
    db.flush()
    print(f"  [+] Organization: Healthark ({org.domain})")
    return org


def _seed_reference_data(db, org):
    dept_names = ["Strategy", "IDT", "RWE", "HR"]
    depts = {n: Department(org_id=org.id, name=n) for n in dept_names}
    db.add_all(depts.values())

    desig_specs = [
        # Org-wide ladder.
        ("Consultant",          1),
        ("Senior Consultant",   2),
        ("Manager",             3),
        ("Senior Manager",      4),
        ("Associate Director",  5),
        ("Director",            6),
        # HR track.
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


# ====================================================================== #
# USERS                                                                   #
# ====================================================================== #
#
# (key, full_name, email, dept, designation, role, is_management, mentor_key)
USER_SPECS = [
    ("purav",    "Purav Gandhi",    "drpuravgandhi@healthark.ai", "Strategy", "Director",            "Admin", True,  None),
    ("sudeep",   "Sudeep Krishna",  "ski@healthark.ai",           "Strategy", "Director",            "Admin", True,  None),
    ("amol",     "Amol Pandya",     "amol@healthark.ai",          "HR",       "Head HR",             "Admin", True,  "purav"),
    ("dhaval",   "Dhaval Vasavada", "dhaval@healthark.ai",        "IDT",      "Associate Director",  "Admin", False, "purav"),
    ("shreshta", "Shreshta Anantha","shreshta@healthark.ai",      "RWE",      "Associate Director",  "Admin", False, "sudeep"),
    ("ritu",     "Ritu Baliya",     "ritu@healthark.ai",          "Strategy", "Associate Director",  "Admin", False, "sudeep"),
    ("divya",    "Divya Jariwala",  "divya@healthark.ai",         "RWE",      "Consultant",          "Staff", False, "shreshta"),
    ("riya",     "Riya Doshi",      "riya@healthark.ai",          "Strategy", "Senior Consultant",   "Staff", False, "ritu"),
    ("shivang",  "Shivang Bhagat",  "shivang@healthark.ai",       "Strategy", "Manager",             "Staff", False, "riya"),
    ("dhruv",    "Dhruv Soni",      "dhruv.s@healthark.ai",       "Strategy", "Consultant",          "Staff", False, "shivang"),
    ("aakash",   "Aakash Pawar",    "aakash.p@healthark.ai",      "IDT",      "Senior Consultant",   "Staff", False, "dhaval"),
    ("zaahid",   "Zaahid Vohra",    "zaahid@healthark.ai",        "IDT",      "Consultant",          "Staff", False, "dhaval"),
    ("devanshi", "Devanshi Shukla", "devanshi@healthark.ai",      "HR",       "Senior HR Executive", "Staff", False, "amol"),
]


def _seed_users(db, org, depts, desigs):
    pw = get_password_hash(PASSWORD)
    users = {}
    for i, (key, name, email, dept, desig, role, is_mgmt, _mentor) in enumerate(USER_SPECS, start=1):
        u = User(
            org_id=org.id,
            department_id=depts[dept].id,
            designation_id=desigs[desig].id,
            employee_code=f"HRK-{i:03d}",
            full_name=name,
            email=email,
            role=role,
            is_management=is_mgmt,
            password_hash=pw,
            must_change_password=False,
        )
        db.add(u)
        users[key] = u
    db.flush()

    # Second pass: wire the mentor chain now that every row has an id.
    for spec in USER_SPECS:
        key, mentor_key = spec[0], spec[-1]
        if mentor_key:
            users[key].mentor_id = users[mentor_key].id
    db.flush()

    print("  [+] Users:")
    for key, name, email, dept, desig, role, is_mgmt, mentor_key in USER_SPECS:
        mentor = f"mentor={mentor_key}" if mentor_key else "no mentor"
        mgmt = " +Mgmt" if is_mgmt else ""
        print(f"      - {email:<28} {name:<18} {dept:<8} {desig:<18} {role}{mgmt}, {mentor}")
    return users


# ====================================================================== #
# SYSTEM SETTINGS + PER-YEAR OVERRIDES                                    #
# ====================================================================== #

def _seed_system_settings(db, org, admin_user):
    db.add(SystemSettings(
        org_id=org.id,
        active_cycle_name="H1 FY26-27",
        cycle_type=CycleType.HALF_YEARLY.value,
        fiscal_start_month=4,
        goals_submission_open=True,
        reviews_submission_open=True,
        goals_edit_enabled=True,
        annual_goals_edit_enabled=True,
        annual_reviews_enabled=True,
        annual_review_final_rating_visible=True,
        project_ratings_visible=True,
        updated_by_id=admin_user.id,
    ))

    # Per-FY override rows — the access gates live here now. Open both the
    # current FY (for the goals) and the completed FY (for the reviews/360).
    for fy_label in (CURRENT_FY_LABEL, COMPLETED_FY_LABEL):
        db.add(SystemSettingsYearOverride(
            org_id=org.id,
            fy_label=fy_label,
            annual_reviews_enabled=True,
            annual_review_final_rating_visible=True,
            annual_goals_edit_enabled=True,
            project_ratings_visible=True,
            updated_by_id=admin_user.id,
        ))
    db.flush()
    print("  [+] SystemSettings: H1 FY26-27 (Half Yearly) + overrides FY25-26 / FY26-27 (all gates open)")


# ====================================================================== #
# ROLE EXPECTATIONS                                                       #
# ====================================================================== #

EXPECTATIONS_DATA = {
    "Strategy": {
        "Consultant": {
            "exp_task_execution": "Applies fundamental frameworks with clear guidance and breaks down problems into smaller components.",
            "exp_ownership": "Takes responsibility for assigned tasks and modules, executes independently once goals are defined.",
            "exp_client_deliverables": "Produces accurate, well-formatted outputs with minimal errors.",
            "exp_communication": "Drafts clear and concise meeting notes and written updates.",
            "exp_project_management": "Conducts deep secondary research and takes ownership of specific sector research.",
            "exp_mentoring": "Encourages team building and performs peer reviews.",
            "exp_firm_growth": "Participate in firm activities and initiatives | Contribute to knowledge sharing / development within the firm",
            "exp_competency_skills": "Builds foundational knowledge in a specific sector or domain.",
        },
        "Senior Consultant": {
            "exp_task_execution": "Independently structures and solves moderately complex problems.",
            "exp_ownership": "Owns multiple modules within a project and ensures quality delivery.",
            "exp_client_deliverables": "Develops polished, visually appealing outputs with compelling narratives.",
            "exp_communication": "Leads internal discussions and co-leads client readouts.",
            "exp_project_management": "Develops project management plans and structures research effectively.",
            "exp_mentoring": "Provides guidance to junior team members on project tasks.",
            "exp_firm_growth": "Leads a firm initiative | Contributes to the firm's knowledge base | Plays a major role in finalising proposals.",
            "exp_competency_skills": "Leads a firm initiative and develops deeper industry expertise.",
        },
        "Manager": {
            "exp_task_execution": "Leads problem definition and solution design for complex issues.",
            "exp_ownership": "Understands each team member and leverages their strengths for project success.",
            "exp_client_deliverables": "Crafts compelling, story-driven outputs aligned with client expectations.",
            "exp_communication": "Leads client discussions, readouts, and critical meetings independently.",
            "exp_project_management": "Takes end-to-end ownership of projects or large workstreams.",
            "exp_mentoring": "Coaches team members on advanced skills and career development.",
            "exp_firm_growth": "Identifies opportunities for process improvements | Leads proposals independently | Supports recruitment activities.",
            "exp_competency_skills": "Identifies opportunities for process improvements and leads proposals.",
        },
        "Senior Manager": {
            "exp_task_execution": "Frames the hardest problems and sets the solution approach for the engagement.",
            "exp_ownership": "Owns engagement-level delivery and commercial outcomes end-to-end.",
            "exp_client_deliverables": "Sets the quality bar for all client-facing outputs across the team.",
            "exp_communication": "Owns the senior client relationship and steers steering-committee conversations.",
            "exp_project_management": "Governs multiple engagements, managing risk, budget, and staffing.",
            "exp_mentoring": "Develops Managers and builds the practice's next layer of leaders.",
            "exp_firm_growth": "Leads proposals and practice initiatives | Drives recruitment and capability building.",
            "exp_competency_skills": "Recognized practice leader who shapes the firm's strategy offering.",
        },
        "Associate Director": {
            "exp_task_execution": "Owns the solution approach across a portfolio of engagements and the toughest problems.",
            "exp_ownership": "Accountable for delivery, quality, and commercials across multiple engagements.",
            "exp_client_deliverables": "Sets and enforces the quality and narrative bar across the portfolio.",
            "exp_communication": "Owns senior client relationships and steers steering-committee conversations.",
            "exp_project_management": "Governs staffing, risk, and budget across several concurrent engagements.",
            "exp_mentoring": "Develops Senior Managers and builds the practice's leadership bench.",
            "exp_firm_growth": "Drives proposals, practice strategy, and business development.",
            "exp_competency_skills": "Senior practice leader shaping the firm's strategy capabilities.",
        },
        "Director": {
            "exp_task_execution": "Sets the intellectual agenda for the practice and its hardest engagements.",
            "exp_ownership": "Accountable for practice P&L, delivery quality, and client portfolio.",
            "exp_client_deliverables": "Final arbiter of quality and narrative across the portfolio.",
            "exp_communication": "Trusted advisor to client C-suite and the firm's external face.",
            "exp_project_management": "Governs the full portfolio and resolves cross-engagement conflicts.",
            "exp_mentoring": "Builds the leadership bench and owns succession planning.",
            "exp_firm_growth": "Drives firm strategy, business development, and brand.",
            "exp_competency_skills": "Thought leader who defines the firm's strategic capabilities.",
        },
    },
    "IDT": {
        "Consultant": {
            "exp_task_execution": "Performs simple to medium complexity tasks and breaks down problems.",
            "exp_ownership": "Executes tasks independently once goals are defined.",
            "exp_project_management": "Adheres to timelines and communicates potential delays early.",
            "exp_client_deliverables": "Produces quality code and deliverables with no major defects.",
            "exp_communication": "Drafts clear meeting notes and written communications.",
            "exp_mentoring": "Encourages team building and knowledge sharing.",
            "exp_firm_growth": "Participate in firm activities and initiatives | Contribute to knowledge sharing within the firm.",
            "exp_competency_skills": "Proficient in assigned technology area and produces quality code on time.",
        },
        "Senior Consultant": {
            "exp_task_execution": "Independently structures and solves moderately complex technical problems.",
            "exp_ownership": "Owns multiple modules and guides junior team members.",
            "exp_project_management": "Performs work estimation, planning, and delivery management.",
            "exp_client_deliverables": "Reviews code and leverages expertise to produce high-quality deliverables.",
            "exp_communication": "Leads internal discussions and manages client relationships.",
            "exp_mentoring": "Provides guidance to junior team members and leads coaching.",
            "exp_firm_growth": "Plays a leadership role within the team | Participates in proposals / SoW creation.",
            "exp_competency_skills": "Leads technical eminence and demonstrates SME capability.",
        },
        "Manager": {
            "exp_task_execution": "Leads problem definition and architecture decisions for complex solutions.",
            "exp_ownership": "Independently manages multiple large projects end-to-end.",
            "exp_project_management": "Owns SoW governance and ensures quality, risk, and budget management.",
            "exp_client_deliverables": "Reviews and ensures final deliverables are free from defects.",
            "exp_communication": "Leads client discussions and builds strong stakeholder relationships.",
            "exp_mentoring": "Develops junior team members through structured coaching.",
            "exp_firm_growth": "Acts as a role model | Leads proposals independently | Recruits and retains top talent.",
            "exp_competency_skills": "Acts as role model and drives process improvements.",
        },
        "Senior Manager": {
            "exp_task_execution": "Owns technical strategy and architecture across the engagement portfolio.",
            "exp_ownership": "Accountable for delivery, quality, and commercials across multiple programs.",
            "exp_project_management": "Governs delivery risk, staffing, and budget across programs.",
            "exp_client_deliverables": "Sets engineering standards and the quality bar for the practice.",
            "exp_communication": "Owns senior client technical relationships and escalations.",
            "exp_mentoring": "Develops Managers and builds the engineering leadership bench.",
            "exp_firm_growth": "Leads proposals and practice capability initiatives | Drives hiring.",
            "exp_competency_skills": "Recognized technology leader shaping the IDT practice.",
        },
        "Associate Director": {
            "exp_task_execution": "Owns technical strategy and architecture across the engagement portfolio.",
            "exp_ownership": "Accountable for delivery, quality, and commercials across multiple programs.",
            "exp_project_management": "Governs delivery risk, staffing, and budget across the portfolio.",
            "exp_client_deliverables": "Sets engineering standards and the quality bar for the practice.",
            "exp_communication": "Owns senior client technical relationships and major escalations.",
            "exp_mentoring": "Develops Senior Managers and builds the engineering leadership bench.",
            "exp_firm_growth": "Drives proposals, technology strategy, and hiring for the practice.",
            "exp_competency_skills": "Senior technology leader shaping the IDT practice direction.",
        },
    },
    "RWE": {
        "Consultant": {
            "exp_task_execution": "Performs simple to medium complexity RWE tasks.",
            "exp_ownership": "Completes assigned tasks on time with quality.",
            "exp_project_management": "Communicates timely status and updates to the team.",
            "exp_communication": "Drafts clear research summaries and meeting notes.",
            "exp_client_deliverables": "Produces accurate, well-formatted RWE outputs.",
            "exp_mentoring": "Encourages team building and participates actively.",
            "exp_firm_growth": "Participate in firm activities and initiatives | Contribute to knowledge sharing.",
            "exp_competency_skills": "Proficient in project-specific RWE concepts.",
        },
        "Manager": {
            "exp_task_execution": "Leads RWE methodology design for complex studies.",
            "exp_ownership": "Takes end-to-end ownership of RWE programs.",
            "exp_project_management": "Owns study governance and quality across multiple projects.",
            "exp_communication": "Leads client and clinical stakeholder discussions.",
            "exp_client_deliverables": "Ensures final RWE deliverables are publication-quality.",
            "exp_mentoring": "Coaches team members and leads knowledge building.",
            "exp_firm_growth": "Drives initiatives that enhance the firm's RWE offerings | Leads proposals.",
            "exp_competency_skills": "Thought leader in RWE methodology and scientific rigor.",
        },
        "Associate Director": {
            "exp_task_execution": "Owns RWE methodology strategy across the study portfolio.",
            "exp_ownership": "Accountable for scientific quality, delivery, and commercials across studies.",
            "exp_project_management": "Governs study governance, risk, and staffing across multiple programs.",
            "exp_communication": "Owns senior client and clinical-stakeholder relationships.",
            "exp_client_deliverables": "Sets the publication-quality bar across all RWE deliverables.",
            "exp_mentoring": "Develops Managers and builds the RWE leadership bench.",
            "exp_firm_growth": "Drives RWE practice strategy, proposals, and external eminence.",
            "exp_competency_skills": "Senior scientific leader shaping the firm's RWE capability.",
        },
    },
    "HR": {
        "Senior HR Executive": {
            "exp_task_execution": "Runs core HR processes accurately and resolves routine queries independently.",
            "exp_ownership": "Owns assigned HR programs (onboarding, engagement) end-to-end.",
            "exp_project_management": "Tracks HR program timelines and flags risks proactively.",
            "exp_client_deliverables": "Produces accurate HR reports, decks, and policy drafts.",
            "exp_communication": "Communicates clearly with employees and handles sensitive topics with care.",
            "exp_mentoring": "Supports newer HR team members and shares process knowledge.",
            "exp_firm_growth": "Drives engagement and culture initiatives | Improves HR processes.",
            "exp_competency_skills": "Strong grasp of HR operations and people processes.",
        },
        "Head HR": {
            "exp_task_execution": "Sets the people strategy and HR operating model for the firm.",
            "exp_ownership": "Accountable for the full HR function and people outcomes.",
            "exp_project_management": "Governs firm-wide HR programs and the annual cycle.",
            "exp_client_deliverables": "Owns leadership-facing people analytics and recommendations.",
            "exp_communication": "Trusted advisor to leadership on all people matters.",
            "exp_mentoring": "Builds the HR team and coaches managers on people leadership.",
            "exp_firm_growth": "Drives talent strategy, retention, and organizational design.",
            "exp_competency_skills": "Strategic people leader shaping firm culture and capability.",
        },
    },
}


def _seed_role_expectations(db, org):
    added = 0
    for dept_name, designations_dict in EXPECTATIONS_DATA.items():
        dept = db.query(Department).filter_by(org_id=org.id, name=dept_name).first()
        if not dept:
            continue
        for desig_name, comp in designations_dict.items():
            desig = db.query(Designation).filter_by(org_id=org.id, name=desig_name).first()
            if not desig:
                continue
            db.add(RoleExpectation(
                org_id=org.id, department_id=dept.id, designation_id=desig.id,
                exp_task_execution=comp.get("exp_task_execution", ""),
                exp_ownership=comp.get("exp_ownership", ""),
                exp_project_management=comp.get("exp_project_management", ""),
                exp_client_deliverables=comp.get("exp_client_deliverables", ""),
                exp_communication=comp.get("exp_communication", ""),
                exp_mentoring=comp.get("exp_mentoring", ""),
                exp_firm_growth=comp.get("exp_firm_growth", ""),
                exp_competency_skills=comp.get("exp_competency_skills", ""),
            ))
            added += 1
    db.flush()
    print(f"  [+] Seeded {added} Role Expectations")


# ====================================================================== #
# ANNUAL GOALS — 3 per user (approved / draft / changes_requested)        #
# ====================================================================== #
#
# email-key → {"approved": (title, desc, progress), "draft": (title, desc),
#              "changes_requested": (title, desc, mentor_feedback)}
GOAL_SETS = {
    "purav": {
        "approved": ("FY26-27 Firm Growth & Revenue Plan",
                     "Drive 25% YoY revenue growth and expand the strategy practice into two new therapeutic areas.",
                     "Two TA expansions scoped; Q1 pipeline up 18%."),
        "draft": ("Leadership Succession Framework",
                  "Define and document a succession plan for every practice-lead role."),
        "changes_requested": ("Global Partnership Expansion",
                              "Establish three new global consulting partnerships in FY26-27.",
                              "Specify target geographies and a measurable signed-partnership count."),
    },
    "sudeep": {
        "approved": ("Delivery Excellence Program",
                     "Standardize delivery quality gates across all practices and cut rework by 20%.",
                     "Quality gates piloted on 3 engagements; rework down 12%."),
        "draft": ("Client NPS Improvement Initiative",
                  "Launch a firm-wide client NPS program targeting a score of 60+."),
        "changes_requested": ("Cross-Practice Capability Academy",
                              "Run a quarterly cross-practice upskilling academy.",
                              "Narrow to 2 priority capabilities and define attendance / outcome metrics."),
    },
    "amol": {
        "approved": ("HR Operating Model Revamp",
                     "Roll out the new performance management system org-wide with 90% adoption.",
                     "PMS rollout complete; adoption at 88%."),
        "draft": ("Talent Retention Strategy",
                  "Design a retention program to bring regretted attrition below 8%."),
        "changes_requested": ("Compensation Benchmarking",
                              "Complete a market compensation benchmarking exercise for all bands.",
                              "Clarify which external benchmark dataset and the bands in scope."),
    },
    "dhaval": {
        "approved": ("Clinical Data Platform Delivery",
                     "Lead end-to-end delivery of the clinical data platform for the flagship client.",
                     "Platform delivered to production; client signed off."),
        "draft": ("IDT Engineering Standards",
                  "Establish coding, review, and CI/CD standards for the IDT practice."),
        "changes_requested": ("Data Engineering Hiring Plan",
                              "Build a hiring pipeline for 5 senior data engineers.",
                              "Add target start dates and a sourcing-channel breakdown."),
    },
    "shreshta": {
        "approved": ("RWE Methodology Standardization",
                     "Standardize RWE study protocols and reusable templates across engagements.",
                     "Three protocol templates published and reused on 2 studies."),
        "draft": ("RWE Publication Pipeline",
                  "Drive two peer-reviewed RWE publications this fiscal year."),
        "changes_requested": ("Real-World Data Vendor Evaluation",
                              "Evaluate and onboard a new real-world data vendor.",
                              "Define evaluation criteria and a shortlist of candidate vendors."),
    },
    "ritu": {
        "approved": ("Market Access Strategy Blueprint",
                     "Build a reusable market-access strategy blueprint across priority markets.",
                     "Blueprint built and applied on 2 engagements."),
        "draft": ("Strategy Team Capability Plan",
                  "Define a structured capability-building plan for the strategy team."),
        "changes_requested": ("Strategy Thought-Leadership Series",
                              "Publish a quarterly strategy thought-leadership series.",
                              "Specify topics for the first two editions and the target channels."),
    },
    "divya": {
        "approved": ("RWE Outcomes Study Contribution",
                     "Own the data extraction and analysis workstream for the outcomes study.",
                     "Analysis delivered and integrated into the final report."),
        "draft": ("Statistical Analysis Upskilling",
                  "Complete advanced statistical analysis training and apply it on a live study."),
        "changes_requested": ("Literature Review Automation",
                              "Build a semi-automated literature review workflow.",
                              "Scope this to one therapy area and define the time-saving metric."),
    },
    "riya": {
        "approved": ("Competitive Intelligence Framework",
                     "Build a competitive intelligence framework for the strategy practice.",
                     "Framework delivered and adopted by the team."),
        "draft": ("Client Deck Storyboarding Mastery",
                  "Independently craft full client deck storyboards with minimal review rounds."),
        "changes_requested": ("Secondary Research Playbook",
                              "Create a reusable secondary research playbook.",
                              "Define the sections and a pilot engagement to validate it."),
    },
    "shivang": {
        "approved": ("Engagement Delivery Leadership",
                     "Lead delivery of a strategy engagement end-to-end with full client accountability.",
                     "Engagement delivered on time; client extension secured."),
        "draft": ("Mentoring & Team Development",
                  "Run a structured mentoring program for strategy consultants."),
        "changes_requested": ("Proposal Win-Rate Improvement",
                              "Improve the strategy proposal win rate to 40%.",
                              "Add a baseline win rate and the number of proposals in scope."),
    },
    "dhruv": {
        "approved": ("First Independent Workstream",
                     "Own a complete research workstream on a live engagement.",
                     "Workstream delivered with positive client feedback."),
        "draft": ("Financial Modeling Capability",
                  "Complete a financial-modeling course and apply it on a project."),
        "changes_requested": ("Industry Sector Expertise",
                              "Develop deep expertise in one priority sector.",
                              "Pick the specific sector and define how expertise will be demonstrated."),
    },
    "aakash": {
        "approved": ("Data Pipeline Ownership",
                     "Own the ingestion and transformation pipeline for the clinical data platform.",
                     "Pipeline delivered ahead of schedule; zero critical defects."),
        "draft": ("Platform Performance Optimization",
                  "Reduce data-refresh latency by 30% across the platform."),
        "changes_requested": ("Automated Testing Framework",
                              "Introduce an automated testing framework for IDT deliverables.",
                              "Define coverage targets and which modules are in scope first."),
    },
    "zaahid": {
        "approved": ("ETL Module Delivery",
                     "Deliver the ETL and data-quality module for the clinical data platform.",
                     "Module delivered with full test coverage."),
        "draft": ("Cloud Infrastructure Certification",
                  "Complete a cloud certification and apply it to platform infrastructure."),
        "changes_requested": ("Monitoring & Alerting Setup",
                              "Set up monitoring and alerting across all data jobs.",
                              "Specify the tooling and the key metrics / SLAs to alert on."),
    },
    "devanshi": {
        "approved": ("PMS Rollout Support",
                     "Drive employee onboarding and training for the new performance system.",
                     "Onboarded all employees; training completion at 95%."),
        "draft": ("Employee Engagement Survey",
                  "Design and run a firm-wide engagement survey with an action plan."),
        "changes_requested": ("HR Policy Documentation",
                              "Document and publish the updated HR policy handbook.",
                              "List the specific policies to update and a review owner for each."),
    },
}


def _seed_goals(db, org, users):
    count = 0
    for key, sets in GOAL_SETS.items():
        user = users[key]
        manager = user.mentor  # None for Purav / Sudeep

        a_title, a_desc, a_progress = sets["approved"]
        db.add(Goal(
            org_id=org.id, user_id=user.id,
            manager_id=manager.id if manager else None,
            title=a_title, description=a_desc,
            goal_type="annual", cycle_name=GOAL_CYCLE_NAME,
            approval_status="approved",
            progress_notes=a_progress,
            approved_at=GOAL_APPROVED_AT,
        ))

        d_title, d_desc = sets["draft"]
        db.add(Goal(
            org_id=org.id, user_id=user.id,
            manager_id=manager.id if manager else None,
            title=d_title, description=d_desc,
            goal_type="annual", cycle_name=GOAL_CYCLE_NAME,
            approval_status="draft",
        ))

        c_title, c_desc, c_feedback = sets["changes_requested"]
        db.add(Goal(
            org_id=org.id, user_id=user.id,
            manager_id=manager.id if manager else None,
            title=c_title, description=c_desc,
            goal_type="annual", cycle_name=GOAL_CYCLE_NAME,
            approval_status="changes_requested",
            manager_feedback=c_feedback,
        ))
        count += 3
    db.flush()
    print(f"  [+] Seeded {count} annual goals ({GOAL_CYCLE_NAME} → {CURRENT_FY_LABEL}): "
          f"1 approved + 1 draft + 1 changes_requested per user")


# ====================================================================== #
# PROJECTS (FY25-26, completed) + PROJECT REVIEWS                         #
# ====================================================================== #
#
# code, name, description, dept, pm_key, [member_keys], reports_to_key, secondary_key
PROJECT_SPECS = [
    ("PRJ-STR", "Market Access Strategy Blueprint",
     "Reusable market-access strategy engagement across four priority markets for a specialty therapy.",
     "Strategy", "ritu", ["shivang", "riya", "dhruv"], "sudeep", "purav"),
    ("PRJ-IDT", "Clinical Data Platform Build",
     "End-to-end build of the unified clinical data platform with harmonized schemas and analytics layer.",
     "IDT", "dhaval", ["aakash", "zaahid"], "purav", "sudeep"),
    ("PRJ-RWE", "Real-World Evidence Outcomes Study",
     "Multi-site real-world evidence outcomes study with interim and final statistical readouts.",
     "RWE", "shreshta", ["divya"], "sudeep", "purav"),
    ("PRJ-HR", "Performance Management System Rollout",
     "Firm-wide rollout of the new performance management system: process design, training, and adoption.",
     "HR", "amol", ["devanshi"], "purav", "sudeep"),
]

# Per-member review tier: pg = performance group "1".."5", tier drives the comments.
PROJECT_REVIEW_PLAN = {
    "PRJ-STR": {"ritu": "5", "shivang": "4", "riya": "4", "dhruv": "3"},
    "PRJ-IDT": {"dhaval": "5", "aakash": "4", "zaahid": "3"},
    "PRJ-RWE": {"shreshta": "4", "divya": "3"},
    "PRJ-HR": {"amol": "5", "devanshi": "4"},
}

PROJECT_START = date(2025, 5, 1)
PROJECT_END = date(2026, 1, 31)
PROJECT_COMPLETED_AT = datetime(2026, 2, 15, tzinfo=timezone.utc)


def _review_comments(name: str, pg: str) -> dict:
    """Build the 7 competency comments for a project review, scaled to the
    performance group. Kept terse but coherent for production-test data."""
    strong = pg in ("4", "5")
    if strong:
        return dict(
            comment_task_execution=f"{name} structured complex tasks independently with strong analytical depth.",
            comment_ownership=f"{name} took full end-to-end ownership and unblocked the team proactively.",
            comment_project_management=f"{name} kept a clean plan with early, proactive risk escalation.",
            comment_client_deliverables=f"{name} produced client-ready outputs that needed minimal rework.",
            comment_communication=f"{name} communicated clearly with both internal and client stakeholders.",
            comment_mentoring=f"{name} actively supported and coached junior team members.",
            comment_competency_skills=f"{name} demonstrated strong, growing domain and technical expertise.",
        )
    return dict(
        comment_task_execution=f"{name} completed assigned tasks reliably with guidance.",
        comment_ownership=f"{name} was dependable on assigned modules; initiative is growing.",
        comment_project_management=f"{name} followed the plan well; improving on proactive status updates.",
        comment_client_deliverables=f"{name} produced well-formatted outputs with improving consistency.",
        comment_communication=f"{name} kept clear written updates; verbal confidence is building.",
        comment_mentoring=f"{name} was an active, collaborative participant in the team.",
        comment_competency_skills=f"{name} is building solid foundational skills steadily.",
    )


def _seed_projects_and_reviews(db, org, users, depts):
    completed_by = users["purav"]
    projects = {}

    for code, name, desc, dept, pm_key, member_keys, reports_key, sec_key in PROJECT_SPECS:
        pm = users[pm_key]
        proj = Project(
            org_id=org.id, project_code=code, name=name, description=desc,
            start_date=PROJECT_START, expected_end_date=PROJECT_END,
            reports_to_id=users[reports_key].id,
            secondary_evaluator_id=users[sec_key].id,
            status=PROJECT_STATUS_COMPLETED,
            completed_at=PROJECT_COMPLETED_AT,
            completed_by_id=completed_by.id,
        )
        db.add(proj)
        db.flush()
        projects[code] = proj

        # PM assignment (Primary evaluator) + member assignments.
        db.add(ProjectAssignment(
            org_id=org.id, project_id=proj.id, user_id=pm.id,
            assignment_role=pm.designation.name, department_id=depts[dept].id,
            evaluator_type="Primary", assigned_date=PROJECT_START,
        ))
        for mk in member_keys:
            m = users[mk]
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj.id, user_id=m.id,
                assignment_role=m.designation.name, department_id=m.department.id,
                evaluator_type=None, assigned_date=PROJECT_START,
            ))
    db.flush()

    # Reviews — one reviewed ProjectReview per assigned member (incl. PM).
    secondary_by_code = {s[0]: s[7] for s in PROJECT_SPECS}
    reports_by_code = {s[0]: s[6] for s in PROJECT_SPECS}
    pm_by_code = {s[0]: s[4] for s in PROJECT_SPECS}

    review_count = 0
    for code, plan in PROJECT_REVIEW_PLAN.items():
        proj = projects[code]
        pm_key = pm_by_code[code]
        secondary = users[secondary_by_code[code]]
        for member_key, pg in plan.items():
            member = users[member_key]
            # The PM is reviewed by the project's reports_to senior; everyone
            # else is reviewed by the PM.
            reviewer = users[reports_by_code[code]] if member_key == pm_key else users[pm_key]
            pr = ProjectReview(
                org_id=org.id, user_id=member.id, project_id=proj.id,
                reviewer_id=reviewer.id, cycle=COMPLETED_PROJECT_CYCLE,
                status="reviewed",
                performance_group=pg,
                impact_statement=f"{member.full_name} made a strong, well-rounded contribution to {proj.name}.",
                **_review_comments(member.full_name, pg),
            )
            db.add(pr)
            db.flush()
            # Secondary evaluator impact statement.
            db.add(ProjectReviewEvaluator(
                org_id=org.id, project_review_id=pr.id,
                evaluator_id=secondary.id, evaluator_type="Secondary",
                status="submitted",
                impact_statement=f"From a cross-functional view, {member.full_name} delivered reliably and collaborated well on {proj.name}.",
            ))
            review_count += 1
    db.flush()
    print(f"  [+] Seeded {len(projects)} completed projects (1 per dept) + "
          f"{review_count} reviewed Project Reviews ({COMPLETED_PROJECT_CYCLE}) with secondary impacts")
    return projects


# ====================================================================== #
# ANNUAL ("MANAGEMENT") REVIEWS — FY25-26, completed for all users        #
# ====================================================================== #

STRONG_SELF = (
    "Owned my workstreams end-to-end with clear accountability, delivered "
    "client-ready artifacts with minimal rework, flagged and mitigated risks "
    "proactively, and supported the team on methodology and delivery."
)
STRONG_MENTOR = (
    "Consistently takes charge without prompting and maintains full "
    "accountability. Artifacts land in client-ready shape and the team looks "
    "to them for guidance. Strong trajectory."
)
SOLID_SELF = (
    "Completed assigned work reliably, flagged issues early, and improved "
    "deliverable quality through the year while building more independence."
)
SOLID_MENTOR = (
    "Dependable on assigned work with growing initiative. Artifact quality is "
    "improving cycle over cycle and planning independence is developing well."
)
LEAD_SELF = (
    "Led multiple workstreams and practice initiatives in parallel, maintained "
    "full accountability across engagements, coached the team, and drove "
    "firm-level initiatives on growth and capability building."
)
LEAD_MENTOR = (
    "Exceptional leadership across every dimension — drives client and firm "
    "outcomes simultaneously, builds team capability, and sets a very high "
    "standard. A clear role model for the practice."
)

# email-key → (self_text, mentor_text, rating). Top management (no mentor)
# skip the mentor stage; rating is applied to self / management / final.
ANNUAL_PLAN = {
    "purav":    (LEAD_SELF,   LEAD_MENTOR,   1),
    "sudeep":   (LEAD_SELF,   LEAD_MENTOR,   1),
    "amol":     (LEAD_SELF,   LEAD_MENTOR,   1),
    "dhaval":   (STRONG_SELF, STRONG_MENTOR, 1),
    "shreshta": (STRONG_SELF, STRONG_MENTOR, 2),
    "ritu":     (STRONG_SELF, STRONG_MENTOR, 1),
    "divya":    (SOLID_SELF,  SOLID_MENTOR,  3),
    "riya":     (STRONG_SELF, STRONG_MENTOR, 2),
    "shivang":  (STRONG_SELF, STRONG_MENTOR, 2),
    "dhruv":    (SOLID_SELF,  SOLID_MENTOR,  3),
    "aakash":   (STRONG_SELF, STRONG_MENTOR, 1),
    "zaahid":   (SOLID_SELF,  SOLID_MENTOR,  3),
    "devanshi": (STRONG_SELF, STRONG_MENTOR, 2),
}


def _seed_annual_reviews(db, org, users):
    for key, (self_text, mentor_text, rating) in ANNUAL_PLAN.items():
        user = users[key]
        mentor = user.mentor
        ar = AnnualReview(
            org_id=org.id, user_id=user.id,
            mentor_id=mentor.id if mentor else None,
            cycle_name=COMPLETED_ANNUAL_CYCLE,
            status="completed",
            self_overall_review=self_text,
            self_performance_rating=rating,
            management_performance_rating=rating,
            final_performance_rating=rating,
            management_comments="Strong contribution across all dimensions this cycle.",
            final_rating_enabled=True,
        )
        # Top management has no mentor — leave the mentor stage blank.
        if mentor is not None:
            ar.mentor_overall_review = mentor_text
            ar.mentor_performance_rating = rating
        db.add(ar)
    db.flush()
    print(f"  [+] Seeded {len(ANNUAL_PLAN)} completed Annual (Management) Reviews ({COMPLETED_ANNUAL_CYCLE})")


# ====================================================================== #
# 360 FEEDBACK — FY25-26, with remarks                                    #
# ====================================================================== #

_F360_KEYS = [
    "collab_inclusive_env", "empathy_consideration", "empower_support_autonomy",
    "empower_recognition", "equity_fair_treatment", "growth_dev_feedback",
    "impact_outcomes", "values_integrity", "comm_clarity", "comm_alignment",
    "core_expertise", "domain_knowledge",
]


def _all_q(values):
    assert len(values) == len(_F360_KEYS), "Need 12 ratings."
    return dict(zip(_F360_KEYS, values))


def _seed_feedback_360(db, org, users):
    secret = settings.FEEDBACK_HASH_SECRET.encode("utf-8")

    def _hash(reviewer_id, target_id, fy):
        msg = f"{reviewer_id}|{target_id}|{fy}".encode("utf-8")
        return hmac.new(secret, msg, hashlib.sha256).hexdigest()

    def _did_work(reviewer_id, target_id):
        r = {pid for (pid,) in db.query(ProjectAssignment.project_id)
             .filter(ProjectAssignment.user_id == reviewer_id,
                     ProjectAssignment.org_id == org.id).all()}
        if not r:
            return False
        t = {pid for (pid,) in db.query(ProjectAssignment.project_id)
             .filter(ProjectAssignment.user_id == target_id,
                     ProjectAssignment.org_id == org.id).all()}
        return bool(r & t)

    def _f360(reviewer_key, target_key, ratings, remark=None):
        reviewer, target = users[reviewer_key], users[target_key]
        review = Feedback360Review(
            org_id=org.id,
            target_user_id=target.id,
            fy_year=F360_FY,
            reviewer_hash=_hash(reviewer.id, target.id, F360_FY),
            worked_with=_did_work(reviewer.id, target.id),
            remarks=remark,
        )
        db.add(review)
        db.flush()
        for k, v in ratings.items():
            db.add(Feedback360Answer(review_id=review.id, question_key=k, rating=v))

    # ── Ritu — full demo: 3 worked-with (project peers) + 3 not-worked-with ──
    _f360("shivang", "ritu", _all_q([5, 4, 5, 5, 4, 4, 5, 5, 5, 4, 4, 5]),
          remark="Ritu set a clear direction and made space for the team to own their workstreams.")
    _f360("riya", "ritu", _all_q([4, 5, 4, 4, 4, 5, 4, 5, 4, 4, 4, 4]),
          remark="Always approachable and gave sharp, actionable feedback on my decks.")
    _f360("dhruv", "ritu", _all_q([5, 4, 4, 4, 5, 4, 5, 5, 5, 5, 4, 5]),
          remark="Pushed me to take ownership early and backed me when it mattered.")
    _f360("dhaval", "ritu", _all_q([4, 4, 4, 4, 4, 4, 5, 5, 5, 4, 5, 4]),
          remark="Strong cross-practice partner; reliable and easy to align with.")
    _f360("shreshta", "ritu", _all_q([4, 4, 3, 4, 4, 4, 4, 4, 4, 4, 4, 5]))
    _f360("amol", "ritu", _all_q([4, 5, 4, 4, 4, 4, 4, 5, 4, 4, 4, 4]))

    # ── Shivang — worked-with cohort visible (3 project peers) ──
    _f360("ritu", "shivang", _all_q([4, 4, 4, 4, 4, 4, 5, 5, 4, 4, 5, 5]),
          remark="Dependable engagement lead — owned delivery and grew into the role this year.")
    _f360("riya", "shivang", _all_q([5, 4, 5, 4, 4, 5, 5, 5, 4, 5, 5, 5]),
          remark="Great to work alongside; coordinated the workstream smoothly.")
    _f360("dhruv", "shivang", _all_q([5, 5, 5, 5, 4, 5, 4, 5, 4, 4, 5, 5]),
          remark="A patient mentor who genuinely invests in the people he leads.")

    # ── Purav — leadership, no project → not-worked-with cohort only ──
    _f360("ritu", "purav", _all_q([5, 5, 5, 5, 5, 4, 5, 5, 4, 5, 5, 5]),
          remark="Sets a clear, ambitious vision and trusts the practice leads to execute.")
    _f360("dhaval", "purav", _all_q([5, 4, 4, 5, 5, 4, 5, 5, 4, 4, 5, 5]),
          remark="Decisive and supportive — removes blockers fast.")
    _f360("shreshta", "purav", _all_q([5, 5, 5, 4, 5, 5, 4, 5, 4, 5, 4, 5]),
          remark="Always makes time for people despite the demands of leadership.")
    _f360("amol", "purav", _all_q([4, 5, 4, 5, 5, 4, 5, 5, 4, 4, 5, 4]))

    # ── Sudeep — leadership, no project → not-worked-with cohort only ──
    _f360("ritu", "sudeep", _all_q([5, 4, 5, 5, 4, 5, 5, 5, 5, 4, 5, 5]),
          remark="Raises the delivery bar for everyone and is fair in how he calibrates.")
    _f360("shreshta", "sudeep", _all_q([5, 5, 4, 4, 5, 5, 4, 5, 4, 5, 4, 5]),
          remark="Deeply invested in quality and in growing the next layer of leaders.")
    _f360("amol", "sudeep", _all_q([4, 5, 5, 4, 5, 4, 5, 5, 4, 4, 5, 4]),
          remark="Thoughtful and steady; a strong partner on firm-wide decisions.")
    _f360("dhaval", "sudeep", _all_q([5, 4, 4, 5, 4, 5, 5, 5, 4, 5, 4, 5]))

    # ── Consultants — 360 for FY25-26 (Management Review already seeded ──
    # for every user in _seed_annual_reviews). Each consultant-tier IC is a
    # target here so the full FY25-26 review package (project review +
    # management review + 360) is complete for them too.
    #
    # The leadership trio (no shared project → not-worked-with) guarantees a
    # 3-reviewer cohort so every consultant clears the anonymity threshold and
    # renders a remark card. Project teammates add a worked-with cohort where
    # the team is large enough (Riya, Dhruv on the 4-person Strategy project).
    LEADERSHIP = ["purav", "sudeep", "amol"]
    consultant_360 = {
        "riya":   ["ritu", "shivang", "dhruv"],
        "dhruv":  ["ritu", "shivang", "riya"],
        "aakash": ["dhaval", "zaahid"],
        "zaahid": ["dhaval", "aakash"],
        "divya":  ["shreshta"],
    }
    # (worked-with remark on the first teammate, not-worked-with remark on the
    # first leadership reviewer) — each cohort that clears the 3-reviewer
    # threshold then surfaces one anonymous remark card.
    consultant_remarks = {
        "riya":   ("Riya brought sharp structure to the workstream and lifted the team's output.",
                   "Strong analytical IC who communicates findings crisply."),
        "dhruv":  ("Dhruv grew quickly this year and owned his workstream end-to-end.",
                   "Reliable and eager to learn — a solid trajectory."),
        "aakash": ("Aakash delivered a clean, well-tested data pipeline ahead of schedule.",
                   "Dependable engineer with strong fundamentals."),
        "zaahid": ("Zaahid owned the ETL module well and acts on feedback quickly.",
                   "Steady contributor; quality improves every cycle."),
        "divya":  ("Divya produced careful, accurate analysis and collaborated openly.",
                   "Thorough and conscientious — a pleasure to work with."),
    }
    _RATING_TEMPLATES = [
        [5, 4, 5, 4, 4, 5, 5, 5, 4, 4, 5, 5],
        [4, 5, 4, 4, 5, 4, 4, 5, 4, 5, 4, 4],
        [4, 4, 4, 5, 4, 4, 5, 4, 5, 4, 4, 5],
        [5, 5, 4, 4, 4, 5, 4, 5, 4, 4, 5, 4],
        [4, 4, 5, 4, 5, 4, 4, 4, 5, 4, 4, 5],
        [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
    ]
    for ti, (target, teammates) in enumerate(consultant_360.items()):
        worked_remark, lead_remark = consultant_remarks[target]
        for ri, reviewer in enumerate(teammates):
            _f360(reviewer, target,
                  _all_q(_RATING_TEMPLATES[(ti + ri) % len(_RATING_TEMPLATES)]),
                  remark=worked_remark if ri == 0 else None)
        for ri, reviewer in enumerate(LEADERSHIP):
            _f360(reviewer, target,
                  _all_q(_RATING_TEMPLATES[(ti + ri + 2) % len(_RATING_TEMPLATES)]),
                  remark=lead_remark if ri == 0 else None)

    db.flush()
    print(f"  [+] Seeded 360 feedback (FY{F360_FY % 100}-{(F360_FY + 1) % 100}) with remarks: "
          "Ritu (both cohorts), Shivang (worked-with), Purav & Sudeep (not-worked-with), "
          "+ all consultants (Divya/Riya/Dhruv/Aakash/Zaahid)")


# ====================================================================== #
# SUMMARY + ENTRYPOINT                                                    #
# ====================================================================== #

def _print_summary(users):
    print()
    print("=" * 64)
    print("Seeded production-test data — login with password: password123")
    print("=" * 64)
    for key, name, email, dept, desig, role, is_mgmt, mentor_key in USER_SPECS:
        mgmt = "+Mgmt" if is_mgmt else ""
        mentor = users[mentor_key].full_name if mentor_key else "—"
        print(f"  {name:<18} {email:<28} {dept:<8} {desig:<18} {role:<5}{mgmt:<6} mentor: {mentor}")
    print("=" * 64)


def seed_test(skip_confirm: bool = False):
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
        _seed_system_settings(db, org, users["purav"])
        _seed_role_expectations(db, org)
        _seed_goals(db, org, users)
        _seed_projects_and_reviews(db, org, users, depts)
        _seed_annual_reviews(db, org, users)
        _seed_feedback_360(db, org, users)
        db.commit()

        # Guarantees the operator asked for.
        user_count = db.query(User).count()
        org_count = db.query(Organization).count()
        goal_count = db.query(Goal).count()
        assert user_count == len(USER_SPECS), f"expected {len(USER_SPECS)} users, found {user_count}"
        assert org_count == 1, f"expected exactly 1 organization, found {org_count}"
        assert goal_count == len(USER_SPECS) * 3, f"expected {len(USER_SPECS) * 3} goals, found {goal_count}"

        _print_summary(users)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_test(skip_confirm="--yes" in sys.argv)
