"""
seed.py — Deterministic dev seed.

Regenerated after the following model changes:
  - Goal.status (progress status) removed.
  - GoalSelfReview introduced as a separate table keyed by (goal_id, cycle_half).
  - Goal.manager_name exposed via property for the Mentor column.

Users, departments, designations, system settings, and role expectations are
preserved from prior seeds — so existing login credentials keep working.
Projects and all downstream artifacts (project reviews, annual reviews,
yearly goals, self-reviews) are refreshed with a new portfolio
(PRJ-101..PRJ-104) so testers can see this run produced the new data.

Accounts (all passwords: password123):
  Healthark Admin: admin@healthark.com
  Mentors:         priya@ / david@ / vikram@healthark.com
  Mentees:         arjun@, neha@ (→ priya),
                   rahul@, meera@ (→ david),
                   ananya@, karan@ (→ vikram)

Run:
  python seed.py
"""

from datetime import date, datetime, timezone

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import ProjectReview, ProjectReviewEvaluator
from app.models.annual_review_models import AnnualReview
from app.models.goal_models import Goal
from app.models.goal_self_review_models import GoalSelfReview
from app.models.role_expectation_models import RoleExpectation


def seed_database():
    print("Starting database seeding process...")
    db = SessionLocal()

    try:
        # ================================================================== #
        # 1. ORGANIZATIONS                                                    #
        # ================================================================== #

        org = db.query(Organization).filter(Organization.name == "Healthark").first()
        if not org:
            org = Organization(
                name="Healthark",
                domain="healthark.com",
                enabled_features=[
                    "dashboard",
                    "goals",
                    "project_reviews",
                    "annual_reviews",
                    "mentoring",
                    "admin",
                ],
            )
            db.add(org)
            db.commit()
            db.refresh(org)
            print("  [+] Created Organization: Healthark (full suite)")
        else:
            print("  [~] Organization 'Healthark' already exists, skipping...")

        miltenyi_org = db.query(Organization).filter(Organization.name == "Miltenyi").first()
        if not miltenyi_org:
            miltenyi_org = Organization(
                name="Miltenyi",
                domain="miltenyi.com",
                enabled_features=[
                    "dashboard",
                    "goals",
                    "project_reviews",
                    "annual_reviews",
                    "mentoring",
                    "admin",
                ],
            )
            db.add(miltenyi_org)
            db.commit()
            db.refresh(miltenyi_org)
            print("  [+] Created Organization: Miltenyi (full suite)")
        else:
            print("  [~] Organization 'Miltenyi' already exists, skipping...")

        # ================================================================== #
        # 2. DEPARTMENTS & DESIGNATIONS                                       #
        # ================================================================== #

        if db.query(Department).filter(Department.org_id == org.id).count() == 0:
            dept_strategy  = Department(org_id=org.id, name="Strategy")
            dept_idt       = Department(org_id=org.id, name="IDT")
            dept_rwe       = Department(org_id=org.id, name="RWE")
            dept_marketing = Department(org_id=org.id, name="Marketing")

            desig_consultant        = Designation(org_id=org.id, name="Consultant",          level=1)
            desig_senior_consultant = Designation(org_id=org.id, name="Senior Consultant",   level=2)
            desig_manager           = Designation(org_id=org.id, name="Manager",             level=3)
            desig_senior_manager    = Designation(org_id=org.id, name="Senior Manager",      level=4)
            desig_associate_director = Designation(org_id=org.id, name="Associate Director", level=5)
            desig_director          = Designation(org_id=org.id, name="Director",            level=6)

            db.add_all([
                dept_strategy, dept_idt, dept_rwe, dept_marketing,
                desig_consultant, desig_senior_consultant, desig_manager,
                desig_senior_manager, desig_associate_director, desig_director,
            ])
            db.commit()
            print("  [+] Created Healthark Departments & Designations")
        else:
            print("  [~] Healthark Reference data already exists, skipping...")

        if db.query(Department).filter(Department.org_id == miltenyi_org.id).count() == 0:
            dept_rnd = Department(org_id=miltenyi_org.id, name="R&D")
            dept_mfg = Department(org_id=miltenyi_org.id, name="Manufacturing")
            dept_com = Department(org_id=miltenyi_org.id, name="Commercial")

            desig_scientist    = Designation(org_id=miltenyi_org.id, name="Scientist",        level=1)
            desig_sr_scientist = Designation(org_id=miltenyi_org.id, name="Senior Scientist", level=2)
            desig_lead         = Designation(org_id=miltenyi_org.id, name="Team Lead",        level=3)
            desig_dir          = Designation(org_id=miltenyi_org.id, name="Director",         level=4)

            db.add_all([
                dept_rnd, dept_mfg, dept_com,
                desig_scientist, desig_sr_scientist, desig_lead, desig_dir,
            ])
            db.commit()
            print("  [+] Created Miltenyi Departments & Designations")
        else:
            print("  [~] Miltenyi Reference data already exists, skipping...")

        # ================================================================== #
        # 3. USERS — Healthark                                                #
        # ================================================================== #

        dept_strategy  = db.query(Department).filter_by(org_id=org.id, name="Strategy").first()
        dept_idt       = db.query(Department).filter_by(org_id=org.id, name="IDT").first()
        dept_rwe       = db.query(Department).filter_by(org_id=org.id, name="RWE").first()
        dept_marketing = db.query(Department).filter_by(org_id=org.id, name="Marketing").first()

        desig_consultant        = db.query(Designation).filter_by(org_id=org.id, name="Consultant").first()
        desig_senior_consultant = db.query(Designation).filter_by(org_id=org.id, name="Senior Consultant").first()
        desig_manager           = db.query(Designation).filter_by(org_id=org.id, name="Manager").first()
        desig_senior_manager    = db.query(Designation).filter_by(org_id=org.id, name="Senior Manager").first()
        desig_director          = db.query(Designation).filter_by(org_id=org.id, name="Director").first()

        pw = get_password_hash("password123")

        admin_user = db.query(User).filter(User.org_id == org.id, User.email == "admin@healthark.com").first()

        if not admin_user:
            admin_user = User(
                org_id=org.id, department_id=dept_marketing.id, designation_id=desig_director.id,
                employee_code="EMP-000", full_name="Sarah Admin", email="admin@healthark.com",
                role="Admin", password_hash=pw,
            )
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
            print("  [+] Created: admin@healthark.com")

            priya = User(org_id=org.id, department_id=dept_strategy.id, designation_id=desig_senior_manager.id,
                         employee_code="EMP-101", full_name="Priya Sharma", email="priya@healthark.com",
                         role="Staff", password_hash=pw)
            db.add(priya)
            db.commit()
            db.refresh(priya)

            arjun = User(org_id=org.id, department_id=dept_strategy.id, designation_id=desig_senior_consultant.id,
                         employee_code="EMP-102", full_name="Arjun Patel", email="arjun@healthark.com",
                         role="Staff", mentor_id=priya.id, password_hash=pw)
            neha  = User(org_id=org.id, department_id=dept_strategy.id, designation_id=desig_consultant.id,
                         employee_code="EMP-103", full_name="Neha Gupta", email="neha@healthark.com",
                         role="Staff", mentor_id=priya.id, password_hash=pw)
            david = User(org_id=org.id, department_id=dept_idt.id, designation_id=desig_manager.id,
                         employee_code="EMP-201", full_name="David Miller", email="david@healthark.com",
                         role="Staff", password_hash=pw)
            db.add_all([arjun, neha, david])
            db.commit()
            db.refresh(david)

            rahul = User(org_id=org.id, department_id=dept_idt.id, designation_id=desig_senior_consultant.id,
                         employee_code="EMP-202", full_name="Rahul Verma", email="rahul@healthark.com",
                         role="Staff", mentor_id=david.id, password_hash=pw)
            meera = User(org_id=org.id, department_id=dept_idt.id, designation_id=desig_consultant.id,
                         employee_code="EMP-203", full_name="Meera Joshi", email="meera@healthark.com",
                         role="Staff", mentor_id=david.id, password_hash=pw)
            vikram = User(org_id=org.id, department_id=dept_rwe.id, designation_id=desig_manager.id,
                          employee_code="EMP-301", full_name="Vikram Singh", email="vikram@healthark.com",
                          role="Staff", password_hash=pw)
            db.add_all([rahul, meera, vikram])
            db.commit()
            db.refresh(vikram)

            ananya = User(org_id=org.id, department_id=dept_rwe.id, designation_id=desig_senior_consultant.id,
                          employee_code="EMP-302", full_name="Ananya Reddy", email="ananya@healthark.com",
                          role="Staff", mentor_id=vikram.id, password_hash=pw)
            karan  = User(org_id=org.id, department_id=dept_rwe.id, designation_id=desig_consultant.id,
                          employee_code="EMP-303", full_name="Karan Mehta", email="karan@healthark.com",
                          role="Staff", mentor_id=vikram.id, password_hash=pw)
            db.add_all([ananya, karan])
            db.commit()
            print("  [+] Created Healthark staff users")

        else:
            print("  [~] Healthark users already exist, resolving references...")
            priya  = db.query(User).filter_by(org_id=org.id, email="priya@healthark.com").first()
            arjun  = db.query(User).filter_by(org_id=org.id, email="arjun@healthark.com").first()
            neha   = db.query(User).filter_by(org_id=org.id, email="neha@healthark.com").first()
            david  = db.query(User).filter_by(org_id=org.id, email="david@healthark.com").first()
            rahul  = db.query(User).filter_by(org_id=org.id, email="rahul@healthark.com").first()
            meera  = db.query(User).filter_by(org_id=org.id, email="meera@healthark.com").first()
            vikram = db.query(User).filter_by(org_id=org.id, email="vikram@healthark.com").first()
            ananya = db.query(User).filter_by(org_id=org.id, email="ananya@healthark.com").first()
            karan  = db.query(User).filter_by(org_id=org.id, email="karan@healthark.com").first()

        # ================================================================== #
        # 4. USERS — Miltenyi                                                 #
        # ================================================================== #

        dept_rnd = db.query(Department).filter_by(org_id=miltenyi_org.id, name="R&D").first()
        dept_mfg = db.query(Department).filter_by(org_id=miltenyi_org.id, name="Manufacturing").first()
        dept_com = db.query(Department).filter_by(org_id=miltenyi_org.id, name="Commercial").first()

        desig_scientist    = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Scientist").first()
        desig_sr_scientist = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Senior Scientist").first()
        desig_lead         = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Team Lead").first()
        desig_dir          = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Director").first()

        if db.query(User).filter(User.org_id == miltenyi_org.id).count() == 0:
            alice_admin = User(
                org_id=miltenyi_org.id, department_id=dept_com.id, designation_id=desig_dir.id,
                employee_code="MIL-000", full_name="Alice Admin", email="admin@miltenyi.com",
                role="Admin", password_hash=pw,
            )
            db.add(alice_admin)
            db.commit()
            db.refresh(alice_admin)

            bob_lead = User(
                org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_lead.id,
                employee_code="MIL-101", full_name="Bob Builder", email="bob@miltenyi.com",
                role="Staff", password_hash=pw,
            )
            db.add(bob_lead)
            db.commit()
            db.refresh(bob_lead)

            charlie = User(org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_sr_scientist.id,
                           employee_code="MIL-102", full_name="Charlie Chemist", email="charlie@miltenyi.com",
                           role="Staff", mentor_id=bob_lead.id, password_hash=pw)
            dana = User(org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_scientist.id,
                        employee_code="MIL-103", full_name="Dana DNA", email="dana@miltenyi.com",
                        role="Staff", mentor_id=bob_lead.id, password_hash=pw)
            evan_mfg = User(
                org_id=miltenyi_org.id, department_id=dept_mfg.id, designation_id=desig_lead.id,
                employee_code="MIL-201", full_name="Evan Engineer", email="evan@miltenyi.com",
                role="Staff", password_hash=pw,
            )
            db.add_all([charlie, dana, evan_mfg])
            db.commit()
            db.refresh(evan_mfg)

            fiona = User(org_id=miltenyi_org.id, department_id=dept_mfg.id, designation_id=desig_scientist.id,
                         employee_code="MIL-202", full_name="Fiona Factory", email="fiona@miltenyi.com",
                         role="Staff", mentor_id=evan_mfg.id, password_hash=pw)
            db.add(fiona)
            db.commit()
            print("  [+] Created Miltenyi staff users")
        else:
            print("  [~] Miltenyi users already exist, skipping...")
            alice_admin = db.query(User).filter_by(org_id=miltenyi_org.id, email="admin@miltenyi.com").first()
            bob_lead = db.query(User).filter_by(org_id=miltenyi_org.id, email="bob@miltenyi.com").first()
            charlie = db.query(User).filter_by(org_id=miltenyi_org.id, email="charlie@miltenyi.com").first()
            dana = db.query(User).filter_by(org_id=miltenyi_org.id, email="dana@miltenyi.com").first()
            evan_mfg = db.query(User).filter_by(org_id=miltenyi_org.id, email="evan@miltenyi.com").first()
            fiona = db.query(User).filter_by(org_id=miltenyi_org.id, email="fiona@miltenyi.com").first()

        # ================================================================== #
        # 5. SYSTEM SETTINGS                                                  #
        # ================================================================== #

        if not db.query(SystemSettings).filter(SystemSettings.org_id == org.id).first():
            db.add(SystemSettings(
                org_id=org.id,
                active_cycle_name="H1 FY26",
                cycle_type=CycleType.HALF_YEARLY.value,
                fiscal_start_month=4,
                goals_submission_open=True,
                reviews_submission_open=True,
                yearly_goals_edit_enabled=True,
                updated_by_id=admin_user.id,
            ))
            db.commit()
            print("  [+] Created System Settings for Healthark (H1 FY26, Half Yearly)")
        else:
            print("  [~] Healthark system settings already exist, skipping...")

        if not db.query(SystemSettings).filter(SystemSettings.org_id == miltenyi_org.id).first():
            db.add(SystemSettings(
                org_id=miltenyi_org.id,
                active_cycle_name="Q1 FY26",
                cycle_type=CycleType.QUARTERLY.value,
                fiscal_start_month=4,
                goals_submission_open=True,
                reviews_submission_open=True,
                yearly_goals_edit_enabled=True,
                updated_by_id=alice_admin.id,
            ))
            db.commit()
            print("  [+] Created System Settings for Miltenyi (Q1 FY26, Quarterly)")
        else:
            print("  [~] Miltenyi system settings already exist, skipping...")

        # ================================================================== #
        # 6. PROJECTS — refreshed portfolio (PRJ-101..PRJ-104)                #
        # ================================================================== #

        if db.query(Project).filter(Project.org_id == org.id).count() == 0 and priya and david and vikram:

            proj_specialty = Project(
                org_id=org.id, project_code="PRJ-101",
                name="Specialty Therapy Launch Readiness",
                description="Launch-readiness diagnostic across access, evidence, and commercial ops for a specialty therapy in 4 markets.",
                start_date=date(2025, 1, 20), expected_end_date=date(2025, 7, 31),
                reports_to_id=admin_user.id,
            )
            db.add(proj_specialty)
            db.flush()

            db.add(ProjectAssignment(org_id=org.id, project_id=proj_specialty.id, user_id=priya.id,  assignment_role=desig_senior_manager.name,    department_id=dept_strategy.id, evaluator_type="Primary",  assigned_date=date(2025, 1, 20)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_specialty.id, user_id=arjun.id,  assignment_role=desig_senior_consultant.name, department_id=dept_strategy.id, evaluator_type=None,       assigned_date=date(2025, 1, 20)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_specialty.id, user_id=neha.id,   assignment_role=desig_consultant.name,        department_id=dept_strategy.id, evaluator_type=None,       assigned_date=date(2025, 2, 3)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_specialty.id, user_id=david.id,  assignment_role=desig_manager.name,           department_id=dept_idt.id,      evaluator_type="Secondary", assigned_date=date(2025, 1, 25)))
            db.commit()

            proj_trial = Project(
                org_id=org.id, project_code="PRJ-102",
                name="Clinical Trial Data Mart Modernization",
                description="Re-architect the clinical trial data mart into a unified analytics platform with harmonized schemas.",
                start_date=date(2025, 2, 3), expected_end_date=date(2025, 9, 15),
                reports_to_id=admin_user.id,
            )
            db.add(proj_trial)
            db.flush()

            db.add(ProjectAssignment(org_id=org.id, project_id=proj_trial.id, user_id=david.id,  assignment_role=desig_manager.name,           department_id=dept_idt.id,  evaluator_type="Primary",   assigned_date=date(2025, 2, 3)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_trial.id, user_id=rahul.id,  assignment_role=desig_senior_consultant.name, department_id=dept_idt.id,  evaluator_type=None,        assigned_date=date(2025, 2, 3)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_trial.id, user_id=meera.id,  assignment_role=desig_consultant.name,        department_id=dept_idt.id,  evaluator_type=None,        assigned_date=date(2025, 2, 17)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_trial.id, user_id=vikram.id, assignment_role=desig_manager.name,           department_id=dept_rwe.id,  evaluator_type="Secondary", assigned_date=date(2025, 2, 10)))
            db.commit()

            proj_safety = Project(
                org_id=org.id, project_code="PRJ-103",
                name="Long-Term Safety RWE Study",
                description="Multi-year RWE safety study for a chronic therapy area, with quarterly interim reads.",
                start_date=date(2025, 3, 10), expected_end_date=date(2026, 3, 31),
                reports_to_id=priya.id,
            )
            db.add(proj_safety)
            db.flush()

            db.add(ProjectAssignment(org_id=org.id, project_id=proj_safety.id, user_id=vikram.id, assignment_role=desig_manager.name,           department_id=dept_rwe.id,      evaluator_type="Primary",  assigned_date=date(2025, 3, 10)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_safety.id, user_id=ananya.id, assignment_role=desig_senior_consultant.name, department_id=dept_rwe.id,      evaluator_type=None,       assigned_date=date(2025, 3, 10)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_safety.id, user_id=karan.id,  assignment_role=desig_consultant.name,        department_id=dept_rwe.id,      evaluator_type=None,       assigned_date=date(2025, 3, 20)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_safety.id, user_id=arjun.id,  assignment_role="Evidence Lead",              department_id=dept_strategy.id, evaluator_type=None,       assigned_date=date(2025, 4, 5)))
            db.commit()

            proj_payer = Project(
                org_id=org.id, project_code="PRJ-104",
                name="Payer Evidence Portfolio — Rare Disease",
                description="Cross-functional payer evidence portfolio combining HEOR, RWE, and strategy workstreams for a rare disease launch.",
                start_date=date(2025, 4, 7), expected_end_date=date(2025, 10, 31),
                reports_to_id=admin_user.id,
            )
            db.add(proj_payer)
            db.flush()

            db.add(ProjectAssignment(org_id=org.id, project_id=proj_payer.id, user_id=priya.id,  assignment_role=desig_senior_manager.name,    department_id=dept_strategy.id, evaluator_type="Primary",   assigned_date=date(2025, 4, 7)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_payer.id, user_id=rahul.id,  assignment_role="Data Lead",                  department_id=dept_idt.id,      evaluator_type=None,        assigned_date=date(2025, 4, 7)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_payer.id, user_id=ananya.id, assignment_role="RWE Lead",                   department_id=dept_rwe.id,      evaluator_type=None,        assigned_date=date(2025, 4, 7)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_payer.id, user_id=neha.id,   assignment_role=desig_consultant.name,        department_id=dept_strategy.id, evaluator_type=None,        assigned_date=date(2025, 4, 20)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_payer.id, user_id=vikram.id, assignment_role=desig_manager.name,           department_id=dept_rwe.id,      evaluator_type="Secondary", assigned_date=date(2025, 4, 10)))
            db.commit()

            print("  [+] Created Projects for Healthark (PRJ-101..PRJ-104)")
        else:
            print("  [~] Healthark Projects already exist, skipping...")

        if db.query(Project).filter(Project.org_id == miltenyi_org.id).count() == 0 and bob_lead and evan_mfg:

            proj_cell = Project(
                org_id=miltenyi_org.id, project_code="MIL-PRJ-101",
                name="Next-Gen CAR-T Workflow Automation",
                description="Automate end-to-end CAR-T cell processing workflow with new instrumentation.",
                start_date=date(2025, 1, 15), expected_end_date=date(2025, 8, 15),
                reports_to_id=alice_admin.id,
            )
            db.add(proj_cell)
            db.flush()

            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=bob_lead.id, assignment_role=desig_lead.name,         department_id=dept_rnd.id, evaluator_type="Primary", assigned_date=date(2025, 1, 15)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=charlie.id,  assignment_role=desig_sr_scientist.name, department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2025, 1, 22)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=dana.id,     assignment_role=desig_scientist.name,    department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2025, 2, 1)))
            db.commit()

            proj_macs = Project(
                org_id=miltenyi_org.id, project_code="MIL-PRJ-102",
                name="MACS Quant Scale-Up Program",
                description="Scale manufacturing of the next MACS Quant platform for global rollout.",
                start_date=date(2025, 3, 5), expected_end_date=date(2025, 11, 30),
                reports_to_id=alice_admin.id,
            )
            db.add(proj_macs)
            db.flush()

            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=evan_mfg.id, assignment_role=desig_lead.name,      department_id=dept_mfg.id, evaluator_type="Primary",   assigned_date=date(2025, 3, 5)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=fiona.id,    assignment_role=desig_scientist.name, department_id=dept_mfg.id, evaluator_type=None,        assigned_date=date(2025, 3, 5)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=bob_lead.id, assignment_role="R&D Liaison",        department_id=dept_rnd.id, evaluator_type="Secondary", assigned_date=date(2025, 3, 18)))
            db.commit()

            print("  [+] Created Projects for Miltenyi (MIL-PRJ-101..MIL-PRJ-102)")
        else:
            print("  [~] Miltenyi Projects already exist, skipping...")

        # ================================================================== #
        # 7. ROLE EXPECTATIONS (data dictionary — unchanged)                  #
        # ================================================================== #

        EXPECTATIONS_DATA = {
            "Strategy": {
                "Consultant": {
                    "exp_task_execution": "Applies fundamental frameworks with clear guidance and breaks down problems into smaller components.",
                    "exp_ownership": "Takes responsibility for assigned tasks and modules, executes independently once goals are defined.",
                    "exp_client_deliverables": "Produces accurate, well-formatted outputs with minimal errors.",
                    "exp_communication": "Drafts clear and concise meeting notes and written updates.",
                    "exp_project_management": "Conducts deep secondary research and takes ownership of specific sector research.",
                    "exp_mentoring": "Encourages team building and performs peer reviews.",
                    "exp_competency_skills": "Builds foundational knowledge in a specific sector or domain.",
                },
                "Senior Consultant": {
                    "exp_task_execution": "Independently structures and solves moderately complex problems.",
                    "exp_ownership": "Owns multiple modules within a project and ensures quality delivery.",
                    "exp_client_deliverables": "Develops polished, visually appealing outputs with compelling narratives.",
                    "exp_communication": "Leads internal discussions and co-leads client readouts.",
                    "exp_project_management": "Develops project management plans and structures research effectively.",
                    "exp_mentoring": "Provides guidance to junior team members on project tasks.",
                    "exp_competency_skills": "Leads a firm initiative and develops deeper industry expertise.",
                },
                "Manager": {
                    "exp_task_execution": "Leads problem definition and solution design for complex issues.",
                    "exp_ownership": "Understands each team member and leverages their strengths for project success.",
                    "exp_client_deliverables": "Crafts compelling, story-driven outputs aligned with client expectations.",
                    "exp_communication": "Leads client discussions, readouts, and critical meetings independently.",
                    "exp_project_management": "Takes end-to-end ownership of projects or large workstreams.",
                    "exp_mentoring": "Coaches team members on advanced skills and career development.",
                    "exp_competency_skills": "Identifies opportunities for process improvements and leads proposals.",
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
                    "exp_competency_skills": "Proficient in assigned technology area and produces quality code on time.",
                },
                "Senior Consultant": {
                    "exp_task_execution": "Independently structures and solves moderately complex technical problems.",
                    "exp_ownership": "Owns multiple modules and guides junior team members.",
                    "exp_project_management": "Performs work estimation, planning, and delivery management.",
                    "exp_client_deliverables": "Reviews code and leverages expertise to produce high-quality deliverables.",
                    "exp_communication": "Leads internal discussions and manages client relationships.",
                    "exp_mentoring": "Provides guidance to junior team members and leads coaching.",
                    "exp_competency_skills": "Leads technical eminence and demonstrates SME capability.",
                },
                "Manager": {
                    "exp_task_execution": "Leads problem definition and architecture decisions for complex solutions.",
                    "exp_ownership": "Independently manages multiple large projects end-to-end.",
                    "exp_project_management": "Owns SoW governance and ensures quality, risk, and budget management.",
                    "exp_client_deliverables": "Reviews and ensures final deliverables are free from defects.",
                    "exp_communication": "Leads client discussions and builds strong stakeholder relationships.",
                    "exp_mentoring": "Develops junior team members through structured coaching.",
                    "exp_competency_skills": "Acts as role model and drives process improvements.",
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
                    "exp_competency_skills": "Proficient in project-specific RWE concepts.",
                },
                "Senior Consultant": {
                    "exp_task_execution": "Develops independent perspective on RWE tasks and solves complex problems.",
                    "exp_ownership": "Owns delivery of one or more workstreams end-to-end.",
                    "exp_project_management": "Performs work estimation and manages team delivery.",
                    "exp_communication": "Independently interacts with clients and leads workstreams.",
                    "exp_client_deliverables": "Produces contextual, high-quality RWE deliverables.",
                    "exp_mentoring": "Demonstrates maturity in coaching junior team members.",
                    "exp_competency_skills": "Is a Subject Matter Expert in one RWE vertical.",
                },
                "Manager": {
                    "exp_task_execution": "Leads RWE methodology design for complex studies.",
                    "exp_ownership": "Takes end-to-end ownership of RWE programs.",
                    "exp_project_management": "Owns study governance and quality across multiple projects.",
                    "exp_communication": "Leads client and clinical stakeholder discussions.",
                    "exp_client_deliverables": "Ensures final RWE deliverables are publication-quality.",
                    "exp_mentoring": "Coaches team members and leads knowledge building.",
                    "exp_competency_skills": "Thought leader in RWE methodology and scientific rigor.",
                },
            },
        }

        if db.query(RoleExpectation).filter(RoleExpectation.org_id == org.id).count() == 0:
            added_count = 0
            for dept_name, designations_dict in EXPECTATIONS_DATA.items():
                dept = db.query(Department).filter(Department.org_id == org.id, Department.name == dept_name).first()
                if not dept:
                    continue
                for desig_name, competencies in designations_dict.items():
                    desig = db.query(Designation).filter(Designation.org_id == org.id, Designation.name == desig_name).first()
                    if not desig:
                        continue
                    db.add(RoleExpectation(
                        org_id=org.id,
                        department_id=dept.id,
                        designation_id=desig.id,
                        exp_task_execution=competencies.get("exp_task_execution", ""),
                        exp_ownership=competencies.get("exp_ownership", ""),
                        exp_project_management=competencies.get("exp_project_management", ""),
                        exp_client_deliverables=competencies.get("exp_client_deliverables", ""),
                        exp_communication=competencies.get("exp_communication", ""),
                        exp_mentoring=competencies.get("exp_mentoring", ""),
                        exp_competency_skills=competencies.get("exp_competency_skills", ""),
                    ))
                    added_count += 1
            db.commit()
            print(f"  [+] Seeded {added_count} Role Expectations for Healthark")
        else:
            print("  [~] Healthark Role expectations already exist, skipping...")

        # ================================================================== #
        # 8. PROJECT REVIEWS — fresh set against the new portfolio            #
        # ================================================================== #

        proj_specialty = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-101").first()
        proj_trial     = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-102").first()
        proj_safety    = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-103").first()
        proj_payer     = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-104").first()

        def _pr(user, project, reviewer, cycle, status, pg=None, impact=None, **comments):
            if not db.query(ProjectReview).filter_by(
                org_id=org.id, user_id=user.id, project_id=project.id, cycle=cycle,
            ).first():
                db.add(ProjectReview(
                    org_id=org.id, user_id=user.id, project_id=project.id,
                    reviewer_id=reviewer.id if reviewer else None,
                    cycle=cycle, status=status,
                    performance_group=pg, impact_statement=impact, **comments,
                ))

        def _pre(review_id, evaluator, impact, status="submitted"):
            if not db.query(ProjectReviewEvaluator).filter_by(
                project_review_id=review_id, evaluator_id=evaluator.id,
            ).first():
                db.add(ProjectReviewEvaluator(
                    org_id=org.id, project_review_id=review_id,
                    evaluator_id=evaluator.id, evaluator_type="Secondary",
                    status=status, impact_statement=impact,
                ))

        if db.query(ProjectReview).filter(ProjectReview.org_id == org.id).count() == 0 \
                and proj_specialty and proj_trial and proj_safety and proj_payer:

            # ── H1 FY25 — Specialty Therapy Launch + Trial Data Mart all reviewed
            _pr(arjun, proj_specialty, priya, "H1 FY25", "reviewed", pg="4",
                impact="Arjun led the payer landscape assessment with strong analytical depth across 4 markets.",
                comment_task_execution="Structured the market assessment framework end-to-end.",
                comment_ownership="Owned the multi-market comparison with proactive risk flagging.",
                comment_project_management="Maintained a clean tracker and escalated early when timelines slipped.",
                comment_client_deliverables="Storyboards were tight; client accepted in the first review round.",
                comment_communication="Clear written updates; confident in internal reviews.",
                comment_mentoring="Supported Neha on market sizing methodology.",
                comment_competency_skills="Developing a strong specialty-therapy access lens.",
            )
            _pr(neha, proj_specialty, priya, "H1 FY25", "reviewed", pg="3",
                impact="Neha delivered clean research outputs and adapted quickly to client feedback.",
                comment_task_execution="Completed secondary research tasks thoroughly with guidance.",
                comment_ownership="Reliable on assigned modules; building proactive instincts.",
                comment_project_management="Followed plans well; improving on proactive status updates.",
                comment_client_deliverables="Produced well-formatted slides with good consistency.",
                comment_communication="Improving verbal confidence; written communication is strong.",
                comment_mentoring="Active participant in team discussions.",
                comment_competency_skills="Building market access research fundamentals.",
            )
            db.flush()
            arjun_spec_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=arjun.id, project_id=proj_specialty.id, cycle="H1 FY25").first()
            neha_spec_h1  = db.query(ProjectReview).filter_by(org_id=org.id, user_id=neha.id,  project_id=proj_specialty.id, cycle="H1 FY25").first()
            if arjun_spec_h1: _pre(arjun_spec_h1.id, david, "Arjun integrated IDT analytics cleanly into the access framework.")
            if neha_spec_h1:  _pre(neha_spec_h1.id,  david, "Neha was responsive on cross-functional data asks with clean documentation.")
            db.commit()

            _pr(rahul, proj_trial, david, "H1 FY25", "reviewed", pg="4",
                impact="Rahul delivered the data mart ingestion layer ahead of schedule with strong quality.",
                comment_task_execution="Independently designed and implemented the schema harmonization layer.",
                comment_ownership="Full ownership of the ingestion workstream; unblocked the team consistently.",
                comment_project_management="Proactive risk escalation and clean sprint planning.",
                comment_client_deliverables="Code quality was high; zero critical defects post-deployment.",
                comment_communication="Translated technical decisions for strategy stakeholders effectively.",
                comment_mentoring="Ran code review sessions for Meera weekly.",
                comment_competency_skills="Strong in SQL, Python, and data modeling; Senior Consultant trajectory.",
            )
            _pr(meera, proj_trial, david, "H1 FY25", "reviewed", pg="3",
                impact="Meera contributed meaningfully to the ETL pipelines and testing framework.",
                comment_task_execution="Completed ETL tasks with guidance; learning independent structuring.",
                comment_ownership="Dependable on assigned modules; growing confidence to own more.",
                comment_project_management="Meeting sprint commitments; improving on estimation.",
                comment_client_deliverables="Output quality has risen notably across the half.",
                comment_communication="Good meeting engagement; written updates becoming more concise.",
                comment_mentoring="Eager learner; receptive in code reviews.",
                comment_competency_skills="Progressing steadily in Python and data modeling.",
            )
            db.flush()
            rahul_trial_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=rahul.id, project_id=proj_trial.id, cycle="H1 FY25").first()
            meera_trial_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=meera.id, project_id=proj_trial.id, cycle="H1 FY25").first()
            if rahul_trial_h1: _pre(rahul_trial_h1.id, vikram, "Rahul's RWE schema integration accelerated our study data pipeline.")
            if meera_trial_h1: _pre(meera_trial_h1.id, vikram, "Meera supported cross-team data requests reliably.")
            db.commit()

            _pr(ananya, proj_safety, vikram, "H1 FY25", "reviewed", pg="4",
                impact="Ananya led protocol design for the long-term safety study with scientific rigor.",
                comment_task_execution="Structured the methodology independently with deep scientific reasoning.",
                comment_ownership="Owned the protocol end-to-end and drove IRB submission.",
                comment_project_management="Clean multi-site timeline management; early risk escalation.",
                comment_client_deliverables="Protocol doc was publication-quality on the first pass.",
                comment_communication="Confident presenter in clinical stakeholder discussions.",
                comment_mentoring="Coached Karan on study design fundamentals.",
                comment_competency_skills="Growing expertise in chronic-therapy safety methodology.",
            )
            _pr(karan, proj_safety, vikram, "H1 FY25", "reviewed", pg="3",
                impact="Karan supported the literature review and early data collection with good quality.",
                comment_task_execution="Completed literature reviews with guidance on prioritization.",
                comment_ownership="Dependable on assigned tasks; building initiative.",
                comment_project_management="Following project plans well; improving on proactive flagging.",
                comment_client_deliverables="Summaries were accurate; formatting consistency improving.",
                comment_communication="Clear internal communications; building stakeholder confidence.",
                comment_mentoring="Active in team discussions.",
                comment_competency_skills="Building foundational RWE knowledge steadily.",
            )
            db.commit()

            # Cross-functional payer evidence (PRJ-104) - reviewed
            _pr(rahul, proj_payer, priya, "H1 FY25", "reviewed", pg="4",
                impact="Rahul's data integration was a cornerstone of the payer evidence package.",
                comment_task_execution="Delivered the data harmonization layer across strategy, RWE, and IDT.",
                comment_ownership="Managed the data pipeline end-to-end across three teams.",
                comment_project_management="Kept the cross-functional tracker in sync across workstreams.",
                comment_client_deliverables="Outputs were clean, well-documented, and client-ready.",
                comment_communication="Translated across strategy / RWE / IDT vocabulary seamlessly.",
                comment_mentoring="Supported team members on data tooling and schema access.",
                comment_competency_skills="Showcased breadth across analytics, data engineering, and RWE.",
            )
            _pr(ananya, proj_payer, priya, "H1 FY25", "reviewed", pg="4",
                impact="Ananya's RWE synthesis strengthened the payer evidence base significantly.",
                comment_task_execution="Independently synthesized RWE signals into the evidence package.",
                comment_ownership="Went beyond assigned scope to drive the evidence narrative.",
                comment_project_management="Excellent cross-workstream coordination with early risk flags.",
                comment_client_deliverables="RWE sections were scientifically robust and visually compelling.",
                comment_communication="Effective with both technical and strategy stakeholders.",
                comment_mentoring="Shared RWE context with strategy team members.",
                comment_competency_skills="Strong rare-disease RWE capability in cross-functional setting.",
            )
            _pr(neha, proj_payer, priya, "H1 FY25", "reviewed", pg="3",
                impact="Neha contributed to strategy slides and research compilation reliably.",
                comment_task_execution="Handled research and slide compilation tasks dependably.",
                comment_ownership="Growing confidence for broader module ownership.",
                comment_project_management="Following plans well; improving at proactive status reporting.",
                comment_client_deliverables="Outputs were well-formatted; storytelling improving.",
                comment_communication="Clear and timely on assigned communication tasks.",
                comment_mentoring="Learning from cross-functional exposure.",
                comment_competency_skills="Growing grasp of integrated evidence requirements.",
            )
            db.flush()
            rahul_pay_h1  = db.query(ProjectReview).filter_by(org_id=org.id, user_id=rahul.id,  project_id=proj_payer.id, cycle="H1 FY25").first()
            ananya_pay_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=ananya.id, project_id=proj_payer.id, cycle="H1 FY25").first()
            neha_pay_h1   = db.query(ProjectReview).filter_by(org_id=org.id, user_id=neha.id,   project_id=proj_payer.id, cycle="H1 FY25").first()
            if rahul_pay_h1:  _pre(rahul_pay_h1.id,  vikram, "Rahul's cross-functional data leadership was instrumental.")
            if ananya_pay_h1: _pre(ananya_pay_h1.id, vikram, "Ananya's RWE rigor kept the evidence story scientifically sound.")
            if neha_pay_h1:   _pre(neha_pay_h1.id,   vikram, "Neha was a reliable contributor across cross-functional workstreams.")
            db.commit()

            # ── H2 FY25 — mixed ────────────────────────────────────────────
            _pr(arjun, proj_specialty, priya, "H2 FY25", "reviewed", pg="4",
                impact="Arjun took broader coordination responsibility across the launch portfolio.",
                comment_task_execution="Structured research gaps proactively without prompting.",
                comment_ownership="Owned two modules simultaneously without missed deadlines.",
                comment_project_management="Introduced a cross-team tracker that improved coordination.",
                comment_client_deliverables="Narrative-driven slides with strong data visualization.",
                comment_communication="More confident with stakeholders; clear written updates.",
                comment_mentoring="Guided Neha and Karan on research frameworks.",
                comment_competency_skills="Strong growth in specialty-therapy strategy; Senior Consultant potential.",
            )
            _pr(neha, proj_specialty, priya, "H2 FY25", "reviewed", pg="4",
                impact="Neha stepped up measurably in quality and independence during H2.",
                comment_task_execution="Structuring tasks more independently with less guidance.",
                comment_ownership="More proactive in risk flagging and clarification.",
                comment_project_management="Improved on timeline adherence and progress communication.",
                comment_client_deliverables="Visible jump in slide quality and storyboarding.",
                comment_communication="More confident in team discussions.",
                comment_mentoring="Starting to support newer members on basic tasks.",
                comment_competency_skills="Solid progress in market access research.",
            )
            db.commit()

            _pr(rahul, proj_trial, david, "H2 FY25", "reviewed", pg="5",
                impact="Rahul delivered an exceptional H2 with technical leadership across the mart.",
                comment_task_execution="Led architecture decisions for the expanded platform independently.",
                comment_ownership="End-to-end ownership across three workstreams; zero misses.",
                comment_project_management="Introduced sprint planning that lifted team velocity.",
                comment_client_deliverables="Client-facing dashboards were best-in-class.",
                comment_communication="Executive-level clarity on technical decisions.",
                comment_mentoring="Weekly coaching sessions with Meera throughout H2.",
                comment_competency_skills="Senior Consultant-level depth across data engineering and analytics.",
            )
            _pr(meera, proj_trial, david, "H2 FY25", "pending")
            db.commit()

            _pr(ananya, proj_safety, vikram, "H2 FY25", "reviewed", pg="5",
                impact="Ananya's leadership elevated the interim safety readouts meaningfully.",
                comment_task_execution="Led the interim statistical analysis design independently.",
                comment_ownership="Complete ownership of the protocol and evidence synthesis.",
                comment_project_management="Managed timelines across 4 sites seamlessly.",
                comment_client_deliverables="Deliverables were publication-ready.",
                comment_communication="Effective clinical stakeholder engagement.",
                comment_mentoring="Coached Karan on study design and organized knowledge sessions.",
                comment_competency_skills="Emerging SME in chronic-therapy safety RWE.",
            )
            _pr(karan, proj_safety, vikram, "H2 FY25", "pending")
            db.commit()

            _pr(rahul, proj_payer, priya, "H2 FY25", "reviewed", pg="4",
                impact="Rahul's H2 cross-functional contribution was outstanding.",
                comment_task_execution="Led the data harmonization across workstreams with minimal guidance.",
                comment_ownership="Managed multi-team dependencies with full accountability.",
                comment_project_management="Exceptional tracker management and risk escalation.",
                comment_client_deliverables="Integrated evidence outputs were best-in-class.",
                comment_communication="Proactive cross-functional risk communication.",
                comment_mentoring="Supported strategy and RWE team members on tooling.",
                comment_competency_skills="Strong cross-functional expertise demonstrated.",
            )
            _pr(ananya, proj_payer, priya, "H2 FY25", "reviewed", pg="5",
                impact="Ananya's RWE leadership was pivotal to the H2 payer evidence package.",
                comment_task_execution="Led the RWE synthesis workstream at a high scientific bar.",
                comment_ownership="Full ownership of the RWE narrative; exceeded scope.",
                comment_project_management="Managed timelines across workstreams cleanly.",
                comment_client_deliverables="RWE output received specific client praise.",
                comment_communication="Excellent at presenting complex evidence to non-technical audiences.",
                comment_mentoring="Coached the strategy team on RWE interpretation.",
                comment_competency_skills="Recognized as internal RWE SME.",
            )
            _pr(neha, proj_payer, priya, "H2 FY25", "pending")
            db.commit()

            # ── H1 FY26 (current) — mostly pending ─────────────────────────
            _pr(ananya, proj_safety, vikram, "H1 FY26", "pending")
            _pr(karan,  proj_safety, vikram, "H1 FY26", "pending")
            _pr(rahul,  proj_payer,  priya,  "H1 FY26", "pending")
            _pr(ananya, proj_payer,  priya,  "H1 FY26", "pending")
            _pr(neha,   proj_payer,  priya,  "H1 FY26", "pending")
            db.commit()

            print("  [+] Created Project Reviews across H1 FY25 (reviewed), H2 FY25 (mixed), H1 FY26 (pending)")
        else:
            print("  [~] Healthark Project Reviews already exist, skipping...")

        # ================================================================== #
        # 9. ANNUAL REVIEWS                                                   #
        # ================================================================== #

        def _ar(user, mentor, cycle, status, **fields):
            if not db.query(AnnualReview).filter_by(
                org_id=org.id, user_id=user.id, cycle_name=cycle,
            ).first():
                db.add(AnnualReview(
                    org_id=org.id, user_id=user.id,
                    mentor_id=mentor.id if mentor else None,
                    cycle_name=cycle, status=status, **fields,
                ))

        if db.query(AnnualReview).filter(AnnualReview.org_id == org.id).count() == 0:
            # H1 FY25 — all completed
            _ar(arjun, priya, "H1 FY25", "completed",
                self_desc_ownership="Owned the specialty-therapy access module end-to-end.",
                self_desc_productivity="Delivered research and slides ahead of deadline consistently.",
                self_desc_communication="Clear MOMs and structured updates throughout the half.",
                self_desc_leadership="Coached Neha on research methodology and deck structuring.",
                self_desc_adaptability="Handled scope changes without losing pace.",
                self_desc_time_management="Managed multiple research streams simultaneously.",
                self_stars=4,
                mentor_comment_ownership="Strong module ownership and quality.",
                mentor_comment_productivity="Highly productive; one of the most efficient contributors.",
                mentor_comment_communication="Precise written updates; growing verbal confidence.",
                mentor_comment_leadership="Natural mentor; supported Neha effectively.",
                mentor_comment_adaptability="Handled scope changes gracefully.",
                mentor_comment_time_management="Excellent; consistently ahead of schedule.",
                mentor_stars=4, management_stars=4, final_stars=4,
                management_comments="Arjun is a high performer tracking well for Senior Consultant.",
                final_rating_enabled=True,
            )
            _ar(neha, priya, "H1 FY25", "completed",
                self_desc_ownership="Completed all assigned research and slide tasks reliably.",
                self_desc_productivity="Steady output quality across the project.",
                self_desc_communication="Consistent check-ins with Priya; improving confidence.",
                self_desc_leadership="Taking initiative on smaller research tasks.",
                self_desc_adaptability="Adapted to new slide formats and research tools.",
                self_desc_time_management="Met individual deadlines with team support.",
                self_stars=3,
                mentor_comment_ownership="Dependable on assigned tasks; building confidence.",
                mentor_comment_productivity="Consistent output; quality improving each cycle.",
                mentor_comment_communication="Written is strong; verbal growing.",
                mentor_comment_leadership="Early initiative; needs encouragement to lead.",
                mentor_comment_adaptability="Good adaptability to new frameworks.",
                mentor_comment_time_management="Met deadlines consistently.",
                mentor_stars=3, management_stars=3, final_stars=3,
                management_comments="On track as a Consultant; growing steadily.",
                final_rating_enabled=True,
            )
            _ar(rahul, david, "H1 FY25", "completed",
                self_desc_ownership="Owned the data mart ingestion layer with full accountability.",
                self_desc_productivity="High-quality code and dashboards delivered ahead of schedule.",
                self_desc_communication="Clear cross-team communications on data dependencies.",
                self_desc_leadership="Guided Meera on data modeling; ran weekly code reviews.",
                self_desc_adaptability="Handled changing data requirements without disruption.",
                self_desc_time_management="Managed the sprint backlog effectively.",
                self_stars=4,
                mentor_comment_ownership="Full ownership demonstrated across workstreams.",
                mentor_comment_productivity="Exceptional; consistently highest quality on the team.",
                mentor_comment_communication="Structured and accessible to non-technical audiences.",
                mentor_comment_leadership="Strong mentor to Meera.",
                mentor_comment_adaptability="Adapts to stack changes without losing pace.",
                mentor_comment_time_management="Outstanding planning and execution.",
                mentor_stars=4, management_stars=4, final_stars=4,
                management_comments="Strong Senior Consultant track.",
                final_rating_enabled=True,
            )
            _ar(meera, david, "H1 FY25", "completed",
                self_desc_ownership="Completed assigned data tasks and supported dashboards.",
                self_desc_productivity="Steady output quality throughout the project.",
                self_desc_communication="Improving at concise updates and flagging blockers.",
                self_desc_leadership="Participates in team reviews and knowledge sharing.",
                self_desc_adaptability="Adapted to new data tools with Rahul's support.",
                self_desc_time_management="Met assigned deadlines with guidance.",
                self_stars=3,
                mentor_comment_ownership="Reliable; building confidence to own larger modules.",
                mentor_comment_productivity="Good output; accuracy has improved materially.",
                mentor_comment_communication="Becoming more proactive with status updates.",
                mentor_comment_leadership="Good participation; developing mentoring instincts.",
                mentor_comment_adaptability="Handled new tooling transitions well.",
                mentor_comment_time_management="Growing planning independence.",
                mentor_stars=3, management_stars=3, final_stars=3,
                management_comments="Progressing well as a Consultant.",
                final_rating_enabled=True,
            )
            _ar(ananya, vikram, "H1 FY25", "completed",
                self_desc_ownership="Led the long-term safety protocol design with scientific accountability.",
                self_desc_productivity="Delivered study outputs on schedule at a high scientific bar.",
                self_desc_communication="Presented RWE methodology clearly to client and internal stakeholders.",
                self_desc_leadership="Coached Karan on study design fundamentals.",
                self_desc_adaptability="Adapted to changing client data requirements mid-study.",
                self_desc_time_management="Managed multi-site coordination timelines effectively.",
                self_stars=4,
                mentor_comment_ownership="Full accountability on a complex study.",
                mentor_comment_productivity="Minimal rework required across any deliverable.",
                mentor_comment_communication="Confident with clinical and client stakeholders.",
                mentor_comment_leadership="Significantly improved Karan's study design capability.",
                mentor_comment_adaptability="Maintains scientific integrity through changes.",
                mentor_comment_time_management="Multi-site timelines managed without issues.",
                mentor_stars=4, management_stars=4, final_stars=4,
                management_comments="Strongest RWE contributor; Senior Consultant track.",
                final_rating_enabled=True,
            )
            _ar(karan, vikram, "H1 FY25", "completed",
                self_desc_ownership="Completed literature review and data collection tasks as assigned.",
                self_desc_productivity="Consistent research output with improving quality.",
                self_desc_communication="Structured research summaries.",
                self_desc_leadership="Participating more actively in team discussions.",
                self_desc_adaptability="Adapted to new literature databases and research tools.",
                self_desc_time_management="Met deadlines with guidance.",
                self_stars=3,
                mentor_comment_ownership="Dependable; building initiative for broader ownership.",
                mentor_comment_productivity="Steady; accuracy improved notably.",
                mentor_comment_communication="Good written; verbal confidence growing.",
                mentor_comment_leadership="Growing participation; needs encouragement.",
                mentor_comment_adaptability="Good at learning new tools.",
                mentor_comment_time_management="Consistent; improving at proactive planning.",
                mentor_stars=3, management_stars=3, final_stars=3,
                management_comments="Solid Consultant progressing steadily in RWE.",
                final_rating_enabled=True,
            )
            db.commit()

            # H2 FY25 — mixed
            _ar(arjun, priya, "H2 FY25", "completed",
                self_desc_ownership="Managed two modules simultaneously while supporting Neha's growth.",
                self_desc_productivity="Introduced team tracking improvements; quality stayed high.",
                self_desc_communication="Leading internal discussions confidently.",
                self_desc_leadership="Mentored Neha and Karan on research methodology.",
                self_desc_adaptability="Handled mid-project scope expansion without disruption.",
                self_desc_time_management="Zero misses; proactive risk flagging.",
                self_stars=4,
                mentor_comment_ownership="Exceeds expectations consistently.",
                mentor_comment_productivity="Top-quartile output quality and quantity.",
                mentor_comment_communication="Excellent in stakeholder presentations.",
                mentor_comment_leadership="Team looks to him for guidance.",
                mentor_comment_adaptability="Thrives in ambiguity.",
                mentor_comment_time_management="Plan-ahead mindset evident.",
                mentor_stars=4, management_stars=4, final_stars=4,
                management_comments="Ready for Senior Consultant — recommend for promotion.",
                final_rating_enabled=True,
            )
            _ar(neha, priya, "H2 FY25", "completed",
                self_desc_ownership="Took on broader research and slide responsibilities.",
                self_desc_productivity="Noticeable jump in output quality and independence.",
                self_desc_communication="More confident in team and client communications.",
                self_desc_leadership="Starting to support newer members.",
                self_desc_adaptability="Adapted to new formats and feedback quickly.",
                self_desc_time_management="Consistently met deadlines.",
                self_stars=4,
                mentor_comment_ownership="Strong improvement in ownership.",
                mentor_comment_productivity="Efficiency gains visible.",
                mentor_comment_communication="More proactive in team settings.",
                mentor_comment_leadership="Supporting junior members now.",
                mentor_comment_adaptability="Quick to incorporate feedback.",
                mentor_comment_time_management="Improved independence.",
                mentor_stars=4, management_stars=4, final_stars=4,
                management_comments="Tracking toward Senior Consultant.",
                final_rating_enabled=True,
            )
            _ar(rahul, david, "H2 FY25", "pending_mentor",
                self_desc_ownership="Led architecture decisions and multi-stream delivery with full accountability.",
                self_desc_productivity="Outstanding delivery quality; sprint planning lifted team velocity.",
                self_desc_communication="Executive-level clarity on technical decisions.",
                self_desc_leadership="Ran weekly coaching sessions with Meera.",
                self_desc_adaptability="Handled major architectural changes without disruption.",
                self_desc_time_management="Zero delivery misses.",
                self_stars=5,
            )
            _ar(meera, david, "H2 FY25", "pending_management",
                self_desc_ownership="Took on more complete module ownership with growing confidence.",
                self_desc_productivity="Improved code quality and delivery speed significantly.",
                self_desc_communication="More proactive updates.",
                self_desc_leadership="Participating in code reviews.",
                self_desc_adaptability="Adapted to new architectural requirements.",
                self_desc_time_management="Consistently met sprint deadlines.",
                self_stars=4,
                mentor_comment_ownership="Clear step-up in H2.",
                mentor_comment_productivity="Improved code quality and pace.",
                mentor_comment_communication="Structured communications.",
                mentor_comment_leadership="Engaged in team reviews.",
                mentor_comment_adaptability="Good at adapting to feedback.",
                mentor_comment_time_management="Improving at self-planning.",
                mentor_stars=4,
            )
            _ar(ananya, vikram, "H2 FY25", "completed",
                self_desc_ownership="Led the cardiology interim reads and payer evidence synthesis.",
                self_desc_productivity="Top-tier scientific outputs with minimal rework.",
                self_desc_communication="Strong with clinical stakeholders; received specific praise.",
                self_desc_leadership="Mentored Karan and coached strategy team on RWE concepts.",
                self_desc_adaptability="Managed protocol changes and multi-site complexity well.",
                self_desc_time_management="Exceptional multi-project planning.",
                self_stars=5,
                mentor_comment_ownership="Most accountable team member.",
                mentor_comment_productivity="Consistently best-in-class.",
                mentor_comment_communication="Builds strong client relationships.",
                mentor_comment_leadership="Elevated Karan's capability significantly.",
                mentor_comment_adaptability="Handles complexity with calm rigor.",
                mentor_comment_time_management="Flawless multi-stakeholder management.",
                mentor_stars=5, management_stars=5, final_stars=5,
                management_comments="Recommend for Senior Consultant with Manager-track consideration.",
                final_rating_enabled=True,
            )
            _ar(karan, vikram, "H2 FY25", "draft",
                self_desc_ownership="Expanded into broader literature review and data collection tasks.",
                self_desc_productivity="Research depth improving throughout the cycle.",
            )
            db.commit()

            # H1 FY26 (current)
            _ar(neha, priya, "H1 FY26", "pending_mentor",
                self_desc_ownership="Broader ownership with more independent project management.",
                self_desc_productivity="Introducing process improvements in slide workflow.",
                self_desc_communication="Leading client-facing communications confidently.",
                self_desc_leadership="Actively mentoring junior researchers.",
                self_desc_adaptability="Adapting well to cross-functional demands.",
                self_desc_time_management="Proactive planning across multiple projects.",
                self_stars=4,
            )
            _ar(arjun, priya, "H1 FY26", "draft",
                self_desc_ownership="Leading multiple access modules with full ownership.",
                self_desc_productivity="Strategic depth across deliverables is growing.",
            )
            _ar(rahul, david, "H1 FY26", "draft",
                self_desc_ownership="Owning platform architecture evolution with cross-team coordination.",
                self_desc_productivity="Strong delivery across multiple technical workstreams.",
            )
            db.commit()

            print("  [+] Created Annual Reviews: H1 FY25 (completed), H2 FY25 (mixed), H1 FY26 (in-progress)")
        else:
            print("  [~] Healthark Annual Reviews already exist, skipping...")

        # ================================================================== #
        # 10. YEARLY GOALS + PER-HALF SELF REVIEWS                            #
        # ================================================================== #
        #
        # Key test scenarios seeded below for the new Self-Review (H1/H2) flow:
        #   - Approved goals with BOTH H1 & H2 self-reviews submitted
        #   - Approved goals with only H1 submitted (H2 still "Not Submitted")
        #   - Approved goals with NO self-reviews yet (fresh)
        #   - Draft + submitted + changes_requested states for the full workflow
        # ================================================================== #

        SELF_REVIEW_DEFAULT = {
            "self_desc_task_execution":
                "Delivered all key tasks against the goal with disciplined execution and consistent quality checks.",
            "self_desc_ownership":
                "Took end-to-end ownership of the goal with proactive status updates and risk flagging.",
            "self_desc_client_deliverables":
                "Produced client-ready outputs that required minimal iteration post-review.",
            "self_desc_communication":
                "Maintained clear internal and stakeholder communications throughout the cycle.",
            "self_desc_project_management":
                "Tracked milestones and dependencies with a well-maintained plan and early risk escalation.",
            "self_desc_mentoring":
                "Supported teammates informally on methodology and tooling while working on this goal.",
            "self_desc_firm_growth":
                "Contributions from this goal fed into reusable playbooks and strengthened the firm's capability in this area.",
            "self_desc_competency_skills":
                "Noticeably strengthened applicable skills — measurable on the scope and complexity handled independently.",
        }

        def _goal(
            user, manager, title, desc,
            approval, cycle_name, fy_year,
            progress_notes=None, manager_feedback=None,
            self_reviewed_halves=(),
        ):
            """
            Insert a yearly goal and (optionally) attached H1 / H2 self-reviews.
            `self_reviewed_halves` — iterable of ("H1", "H2") to attach a review for.
            Review content is the default boilerplate above (good enough for UI testing).
            """
            if db.query(Goal).filter_by(
                org_id=org.id, user_id=user.id, title=title, cycle_name=cycle_name,
            ).first():
                return

            approved_at = (
                datetime(fy_year, 4, 20, tzinfo=timezone.utc)
                if approval == "approved" else None
            )

            g = Goal(
                org_id=org.id, user_id=user.id,
                manager_id=manager.id if manager else None,
                title=title, description=desc,
                goal_type="yearly",
                cycle_name=cycle_name,
                approval_status=approval,
                progress_notes=progress_notes,
                manager_feedback=manager_feedback,
                approved_at=approved_at,
            )
            db.add(g)
            db.flush()  # get g.id for the self-review FK

            for half in self_reviewed_halves:
                db.add(GoalSelfReview(
                    goal_id=g.id,
                    org_id=org.id,
                    cycle_half=half,
                    **SELF_REVIEW_DEFAULT,
                ))

        if db.query(Goal).filter(Goal.org_id == org.id).count() == 0:

            # ── Arjun (mentee of Priya) — full spread of scenarios ──────────
            # FY 2025 approved goal with BOTH H1 + H2 self-reviews
            _goal(arjun, priya,
                  "Specialty Therapy Access Framework",
                  "Build and socialize a reusable specialty-therapy access framework across 4 priority EU markets.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Framework built and reused on 2 subsequent engagements. Client feedback positive.",
                  self_reviewed_halves=("H1", "H2"))
            # FY 2025 approved goal with ONLY H1 self-review
            _goal(arjun, priya,
                  "Healthcare Financial Modeling Capability",
                  "Complete a structured financial-modeling course and apply it to an active project.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Course done; bottom-up forecast model applied to PRJ-101.",
                  self_reviewed_halves=("H1",))
            # FY 2026 approved — NO self-reviews yet (fresh test case)
            _goal(arjun, priya,
                  "PM-Level Ownership on Payer Evidence Portfolio",
                  "Step into a PM-equivalent role on PRJ-104 with full delivery and client accountability.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Running the tracker and client comms independently. On track.",
                  self_reviewed_halves=())
            # FY 2026 draft
            _goal(arjun, priya,
                  "Build Proposal Development Capability",
                  "Lead or co-lead at least one client proposal end-to-end in FY 2026.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)
            # FY 2026 submitted (awaiting Priya's approval)
            _goal(arjun, priya,
                  "Senior-Level Storyboarding Mastery",
                  "Independently craft full client deck storyboards with compelling narratives and minimal review rounds.",
                  approval="submitted", cycle_name="H1 2026", fy_year=2026)

            # ── Neha (mentee of Priya) ──────────────────────────────────────
            _goal(neha, priya,
                  "Independently Lead a Research Module",
                  "Own and deliver a complete research module on a live project with minimal supervision.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Led competitive landscape module on PRJ-101. Delivered on time with positive feedback.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(neha, priya,
                  "Lead a Complete Client Workstream Independently",
                  "Own end-to-end delivery of a client workstream with minimal supervision in FY 2026.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Leading the competitor benchmarking workstream independently.",
                  self_reviewed_halves=("H1",))
            # Changes-requested case (mentor asked for revisions)
            _goal(neha, priya,
                  "Author Firm Thought Leadership Piece",
                  "Research, draft, and publish a firm-branded thought-leadership article on specialty access.",
                  approval="changes_requested", cycle_name="H1 2026", fy_year=2026,
                  manager_feedback="Scope is too broad — narrow to 1 therapy area and define a clearer success metric.")

            # ── Rahul (mentee of David) ─────────────────────────────────────
            _goal(rahul, david,
                  "Clinical Trial Data Mart Modernization (Tech Lead)",
                  "Lead the technical architecture and delivery of the trial data mart modernization.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Architecture approved by ARB. Delivered 2 weeks ahead of schedule.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(rahul, david,
                  "Mentor Meera on Data Engineering Fundamentals",
                  "Run bi-weekly coaching sessions with Meera to build her data engineering capability.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Ran 10 coaching sessions. Meera now independently owns an ETL module.",
                  self_reviewed_halves=("H1",))
            # FY 2026 approved — no self-reviews yet
            _goal(rahul, david,
                  "Introduce Agile Delivery Framework to IDT",
                  "Design and roll out an Agile sprint framework that improves delivery predictability for the practice.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Sprint framework piloted. Team velocity up ~25%.",
                  self_reviewed_halves=())

            # ── Meera (mentee of David) ─────────────────────────────────────
            _goal(meera, david,
                  "First Independent Analytics Module",
                  "Own an analytics module end-to-end on an active project.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Completed the data cleansing and visualization module for PRJ-102 with minimal guidance.",
                  self_reviewed_halves=("H1",))
            _goal(meera, david,
                  "End-to-End Feature Delivery on Trial Data Mart",
                  "Take full-cycle ownership of a feature from requirements to production deployment.",
                  approval="submitted", cycle_name="H1 2026", fy_year=2026)

            # ── Ananya (mentee of Vikram) ───────────────────────────────────
            _goal(ananya, vikram,
                  "Long-Term Safety Study Protocol Lead",
                  "Lead protocol design and documentation for the long-term safety RWE study.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Protocol designed and submitted. IRB approved. Study launched.",
                  self_reviewed_halves=("H1", "H2"))
            # FY 2026 approved — no self-reviews yet
            _goal(ananya, vikram,
                  "Firm-Wide RWE Knowledge Session",
                  "Organize and present a firm-wide knowledge session on chronic-therapy RWE best practices.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Session scheduled. Deck 80% complete.",
                  self_reviewed_halves=())

            # ── Karan (mentee of Vikram) ────────────────────────────────────
            _goal(karan, vikram,
                  "Cardiovascular RWE Literature Review Capability",
                  "Conduct structured literature reviews and synthesize findings for the cardiology outcomes study.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Completed systematic review of 150+ papers. Summary integrated into protocol.",
                  self_reviewed_halves=("H1",))
            _goal(karan, vikram,
                  "Statistical Analysis for Long-Term Safety Study",
                  "Own the complete statistical analysis for the long-term safety RWE study in FY 2026.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)
            _goal(karan, vikram,
                  "Client Presentation Readiness",
                  "Present study design updates to the client sponsor at least twice in FY 2026.",
                  approval="submitted", cycle_name="H1 2026", fy_year=2026)

            db.commit()
            print("  [+] Created Healthark Yearly Goals + H1/H2 Self Reviews")
        else:
            print("  [~] Healthark Goals already exist, skipping...")

        # Miltenyi yearly goals — minimal, just enough to test the flow
        if db.query(Goal).filter(Goal.org_id == miltenyi_org.id).count() == 0:

            def _mil_goal(user, manager, title, desc, approval, cycle_name, fy_year,
                          progress_notes=None, manager_feedback=None, self_reviewed_halves=()):
                if db.query(Goal).filter_by(
                    org_id=miltenyi_org.id, user_id=user.id, title=title, cycle_name=cycle_name,
                ).first():
                    return
                approved_at = (
                    datetime(fy_year, 4, 20, tzinfo=timezone.utc)
                    if approval == "approved" else None
                )
                g = Goal(
                    org_id=miltenyi_org.id, user_id=user.id,
                    manager_id=manager.id if manager else None,
                    title=title, description=desc,
                    goal_type="yearly", cycle_name=cycle_name,
                    approval_status=approval,
                    progress_notes=progress_notes,
                    manager_feedback=manager_feedback,
                    approved_at=approved_at,
                )
                db.add(g)
                db.flush()
                for half in self_reviewed_halves:
                    db.add(GoalSelfReview(
                        goal_id=g.id, org_id=miltenyi_org.id,
                        cycle_half=half, **SELF_REVIEW_DEFAULT,
                    ))

            _mil_goal(charlie, bob_lead,
                      "CAR-T Workflow Automation Module",
                      "Own the automation of the upstream CAR-T processing workflow on the new instrument.",
                      approval="approved", cycle_name="H1 2025", fy_year=2025,
                      progress_notes="Module deployed. Cycle time reduced by ~30%.",
                      self_reviewed_halves=("H1", "H2"))
            _mil_goal(dana, bob_lead,
                      "Assay Validation for Next-Gen CAR-T",
                      "Design and run validation assays for the next-gen CAR-T platform.",
                      approval="approved", cycle_name="H1 2026", fy_year=2026,
                      progress_notes="Validation assays underway; first read scheduled.",
                      self_reviewed_halves=())
            _mil_goal(fiona, evan_mfg,
                      "MACS Quant Scale-Up Documentation",
                      "Author the scale-up documentation package for the new MACS Quant platform.",
                      approval="submitted", cycle_name="H1 2026", fy_year=2026)

            db.commit()
            print("  [+] Created Miltenyi Yearly Goals + Self Reviews")
        else:
            print("  [~] Miltenyi Goals already exist, skipping...")

        # ================================================================== #
        # DONE                                                                #
        # ================================================================== #

        print("\n" + "=" * 60)
        print("Database seeding completed successfully!")
        print("=" * 60)
        print("\n--- HEALTHARK Accounts (all passwords: password123) ---")
        print("  ADMIN:    admin@healthark.com    Sarah Admin     (Admin)")
        print("  STRATEGY: priya@healthark.com    Priya Sharma    (mentors Arjun + Neha, PM on PRJ-101 + PRJ-104)")
        print("            arjun@healthark.com    Arjun Patel     (mentor: Priya)")
        print("            neha@healthark.com     Neha Gupta      (mentor: Priya)")
        print("  IDT:      david@healthark.com    David Miller    (mentors Rahul + Meera, PM on PRJ-102)")
        print("            rahul@healthark.com    Rahul Verma     (mentor: David)")
        print("            meera@healthark.com    Meera Joshi     (mentor: David)")
        print("  RWE:      vikram@healthark.com   Vikram Singh    (mentors Ananya + Karan, PM on PRJ-103)")
        print("            ananya@healthark.com   Ananya Reddy    (mentor: Vikram)")
        print("            karan@healthark.com    Karan Mehta     (mentor: Vikram)")
        print()
        print("--- MILTENYI Accounts (Quarterly Cycle | all passwords: password123) ---")
        print("  ADMIN:    admin@miltenyi.com     Alice Admin     (Admin)")
        print("  R&D:      bob@miltenyi.com       Bob Builder     (mentors Charlie + Dana)")
        print("            charlie@miltenyi.com   Charlie Chemist (mentor: Bob)")
        print("            dana@miltenyi.com      Dana DNA        (mentor: Bob)")
        print("  MFG:      evan@miltenyi.com      Evan Engineer   (mentors Fiona)")
        print("            fiona@miltenyi.com     Fiona Factory   (mentor: Evan)")
        print()
        print("Self-Review (H1 / H2) test cases to try:")
        print("  * Login as arjun@healthark.com — 5 goals with a spread of self-review states.")
        print("  * Login as priya@healthark.com — open Team Goals, click the H1/H2 menu to view mentee submissions.")
        print()

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
