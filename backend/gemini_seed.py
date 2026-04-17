from app.core.database import SessionLocal
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.project_models import Project, ProjectAssignment
from app.models.role_expectation_models import RoleExpectation
from app.models.project_review_models import ProjectReview, ProjectReviewStatus
from app.core.security import get_password_hash
from datetime import date


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
                    "admin"
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

        # Healthark Departments & Designations
        if db.query(Department).filter(Department.org_id == org.id).count() == 0:
            dept_strategy = Department(org_id=org.id, name="Strategy")
            dept_idt      = Department(org_id=org.id, name="IDT")
            dept_rwe      = Department(org_id=org.id, name="RWE")
            dept_marketing = Department(org_id=org.id, name="Marketing")

            desig_consultant        = Designation(org_id=org.id, name="Consultant",           level=1)
            desig_senior_consultant = Designation(org_id=org.id, name="Senior Consultant",    level=2)
            desig_manager           = Designation(org_id=org.id, name="Manager",              level=3)
            desig_senior_manager    = Designation(org_id=org.id, name="Senior Manager",       level=4)
            desig_associate_director = Designation(org_id=org.id, name="Associate Director",  level=5)
            desig_director          = Designation(org_id=org.id, name="Director",             level=6)

            db.add_all([
                dept_strategy, dept_idt, dept_rwe, dept_marketing,
                desig_consultant, desig_senior_consultant, desig_manager,
                desig_senior_manager, desig_associate_director, desig_director,
            ])
            db.commit()
            print("  [+] Created Healthark Departments & Designations")
        else:
            print("  [~] Healthark Reference data already exists, skipping...")

        # Miltenyi Departments & Designations
        if db.query(Department).filter(Department.org_id == miltenyi_org.id).count() == 0:
            dept_rnd = Department(org_id=miltenyi_org.id, name="R&D")
            dept_mfg = Department(org_id=miltenyi_org.id, name="Manufacturing")
            dept_com = Department(org_id=miltenyi_org.id, name="Commercial")

            desig_scientist = Designation(org_id=miltenyi_org.id, name="Scientist", level=1)
            desig_sr_scientist = Designation(org_id=miltenyi_org.id, name="Senior Scientist", level=2)
            desig_lead = Designation(org_id=miltenyi_org.id, name="Team Lead", level=3)
            desig_dir = Designation(org_id=miltenyi_org.id, name="Director", level=4)

            db.add_all([
                dept_rnd, dept_mfg, dept_com,
                desig_scientist, desig_sr_scientist, desig_lead, desig_dir
            ])
            db.commit()
            print("  [+] Created Miltenyi Departments & Designations")
        else:
            print("  [~] Miltenyi Reference data already exists, skipping...")

        # ================================================================== #
        # 3. USERS - Healthark                                                #
        # ================================================================== #

        dept_strategy   = db.query(Department).filter_by(org_id=org.id, name="Strategy").first()
        dept_idt        = db.query(Department).filter_by(org_id=org.id, name="IDT").first()
        dept_rwe        = db.query(Department).filter_by(org_id=org.id, name="RWE").first()
        dept_marketing  = db.query(Department).filter_by(org_id=org.id, name="Marketing").first()

        desig_consultant        = db.query(Designation).filter_by(org_id=org.id, name="Consultant").first()
        desig_senior_consultant = db.query(Designation).filter_by(org_id=org.id, name="Senior Consultant").first()
        desig_manager           = db.query(Designation).filter_by(org_id=org.id, name="Manager").first()
        desig_senior_manager    = db.query(Designation).filter_by(org_id=org.id, name="Senior Manager").first()
        desig_director          = db.query(Designation).filter_by(org_id=org.id, name="Director").first()

        pw = get_password_hash("password123")

        admin_user = db.query(User).filter(User.org_id == org.id, User.email == "admin@healthark.com").first()

        if not admin_user:
            admin_user = User(
                org_id=org.id,
                department_id=dept_marketing.id,
                designation_id=desig_director.id,
                employee_code="EMP-000",
                full_name="Sarah Admin",
                email="admin@healthark.com",
                role="Admin",
                password_hash=pw,
            )
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
            print("  [+] Created: admin@healthark.com")

            priya = User(org_id=org.id, department_id=dept_strategy.id, designation_id=desig_senior_manager.id, employee_code="EMP-101", full_name="Priya Sharma", email="priya@healthark.com", role="Staff", password_hash=pw)
            db.add(priya)
            db.commit()
            db.refresh(priya)

            arjun = User(org_id=org.id, department_id=dept_strategy.id, designation_id=desig_senior_consultant.id, employee_code="EMP-102", full_name="Arjun Patel", email="arjun@healthark.com", role="Staff", mentor_id=priya.id, password_hash=pw)
            neha = User(org_id=org.id, department_id=dept_strategy.id, designation_id=desig_consultant.id, employee_code="EMP-103", full_name="Neha Gupta", email="neha@healthark.com", role="Staff", mentor_id=priya.id, password_hash=pw)
            david = User(org_id=org.id, department_id=dept_idt.id, designation_id=desig_manager.id, employee_code="EMP-201", full_name="David Miller", email="david@healthark.com", role="Staff", password_hash=pw)
            db.add_all([arjun, neha, david])
            db.commit()
            db.refresh(david)

            rahul = User(org_id=org.id, department_id=dept_idt.id, designation_id=desig_senior_consultant.id, employee_code="EMP-202", full_name="Rahul Verma", email="rahul@healthark.com", role="Staff", mentor_id=david.id, password_hash=pw)
            meera = User(org_id=org.id, department_id=dept_idt.id, designation_id=desig_consultant.id, employee_code="EMP-203", full_name="Meera Joshi", email="meera@healthark.com", role="Staff", mentor_id=david.id, password_hash=pw)
            vikram = User(org_id=org.id, department_id=dept_rwe.id, designation_id=desig_manager.id, employee_code="EMP-301", full_name="Vikram Singh", email="vikram@healthark.com", role="Staff", password_hash=pw)
            db.add_all([rahul, meera, vikram])
            db.commit()
            db.refresh(vikram)

            ananya = User(org_id=org.id, department_id=dept_rwe.id, designation_id=desig_senior_consultant.id, employee_code="EMP-302", full_name="Ananya Reddy", email="ananya@healthark.com", role="Staff", mentor_id=vikram.id, password_hash=pw)
            karan = User(org_id=org.id, department_id=dept_rwe.id, designation_id=desig_consultant.id, employee_code="EMP-303", full_name="Karan Mehta", email="karan@healthark.com", role="Staff", mentor_id=vikram.id, password_hash=pw)
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
        # 4. USERS - Miltenyi                                                 #
        # ================================================================== #

        dept_rnd = db.query(Department).filter_by(org_id=miltenyi_org.id, name="R&D").first()
        dept_mfg = db.query(Department).filter_by(org_id=miltenyi_org.id, name="Manufacturing").first()
        dept_com = db.query(Department).filter_by(org_id=miltenyi_org.id, name="Commercial").first()

        desig_scientist = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Scientist").first()
        desig_sr_scientist = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Senior Scientist").first()
        desig_lead = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Team Lead").first()
        desig_dir = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Director").first()

        if db.query(User).filter(User.org_id == miltenyi_org.id).count() == 0:
            alice_admin = User(
                org_id=miltenyi_org.id, department_id=dept_com.id, designation_id=desig_dir.id,
                employee_code="MIL-000", full_name="Alice Admin", email="admin@miltenyi.com",
                role="Admin", password_hash=pw
            )
            db.add(alice_admin)
            db.commit()
            db.refresh(alice_admin)

            bob_lead = User(
                org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_lead.id,
                employee_code="MIL-101", full_name="Bob Builder", email="bob@miltenyi.com",
                role="Staff", password_hash=pw
            )
            db.add(bob_lead)
            db.commit()
            db.refresh(bob_lead)

            charlie = User(org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_sr_scientist.id, employee_code="MIL-102", full_name="Charlie Chemist", email="charlie@miltenyi.com", role="Staff", mentor_id=bob_lead.id, password_hash=pw)
            dana = User(org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_scientist.id, employee_code="MIL-103", full_name="Dana DNA", email="dana@miltenyi.com", role="Staff", mentor_id=bob_lead.id, password_hash=pw)
            
            evan_mfg = User(
                org_id=miltenyi_org.id, department_id=dept_mfg.id, designation_id=desig_lead.id,
                employee_code="MIL-201", full_name="Evan Engineer", email="evan@miltenyi.com",
                role="Staff", password_hash=pw
            )
            db.add_all([charlie, dana, evan_mfg])
            db.commit()
            db.refresh(evan_mfg)

            fiona = User(org_id=miltenyi_org.id, department_id=dept_mfg.id, designation_id=desig_scientist.id, employee_code="MIL-202", full_name="Fiona Factory", email="fiona@miltenyi.com", role="Staff", mentor_id=evan_mfg.id, password_hash=pw)
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
                updated_by_id=admin_user.id,
            ))
            db.commit()
            print("  [+] Created System Settings for Healthark (H1 FY26 - Half Yearly)")
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
                updated_by_id=alice_admin.id,
            ))
            db.commit()
            print("  [+] Created System Settings for Miltenyi (Q1 FY26 - Quarterly)")
        else:
            print("  [~] Miltenyi system settings already exist, skipping...")

        # ================================================================== #
        # 6. SAMPLE PROJECTS + ASSIGNMENTS                                    #
        # ================================================================== #

        if db.query(Project).filter(Project.org_id == org.id).count() == 0 and priya and david and vikram:
            proj_ma = Project(org_id=org.id, project_code="PRJ-001", name="Market Access Strategy", description="Develop market access strategy for oncology portfolio across 5 EU markets.", start_date=date(2025, 1, 15), expected_end_date=date(2025, 6, 30), reports_to_id=admin_user.id)
            db.add(proj_ma)
            db.flush()

            db.add(ProjectAssignment(org_id=org.id, project_id=proj_ma.id, user_id=priya.id, assignment_role=desig_senior_manager.name, department_id=dept_strategy.id, evaluator_type="Primary", assigned_date=date(2025, 1, 15)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_ma.id, user_id=arjun.id, assignment_role=desig_senior_consultant.name, department_id=dept_strategy.id, evaluator_type=None, assigned_date=date(2025, 1, 15)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_ma.id, user_id=neha.id, assignment_role=desig_consultant.name, department_id=dept_strategy.id, evaluator_type=None, assigned_date=date(2025, 2, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_ma.id, user_id=david.id, assignment_role=desig_manager.name, department_id=dept_idt.id, evaluator_type="Secondary", assigned_date=date(2025, 1, 15)))
            db.commit()

            proj_idt = Project(org_id=org.id, project_code="PRJ-002", name="Patient Journey Analytics Platform", description="Build a data analytics dashboard for real-world patient journey mapping.", start_date=date(2025, 2, 1), expected_end_date=date(2025, 8, 31), reports_to_id=admin_user.id)
            db.add(proj_idt)
            db.flush()

            db.add(ProjectAssignment(org_id=org.id, project_id=proj_idt.id, user_id=david.id, assignment_role=desig_manager.name, department_id=dept_idt.id, evaluator_type="Primary", assigned_date=date(2025, 2, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_idt.id, user_id=rahul.id, assignment_role=desig_senior_consultant.name, department_id=dept_idt.id, evaluator_type=None, assigned_date=date(2025, 2, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_idt.id, user_id=meera.id, assignment_role=desig_consultant.name, department_id=dept_idt.id, evaluator_type=None, assigned_date=date(2025, 2, 15)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_idt.id, user_id=vikram.id, assignment_role=desig_manager.name, department_id=dept_rwe.id, evaluator_type="Secondary", assigned_date=date(2025, 2, 1)))
            db.commit()

            proj_rwe = Project(org_id=org.id, project_code="PRJ-003", name="RWE Outcomes Study - Cardiology", description="Design and execute a real-world evidence study for cardiovascular outcomes.", start_date=date(2025, 3, 1), expected_end_date=date(2025, 12, 31), reports_to_id=priya.id)
            db.add(proj_rwe)
            db.flush()

            db.add(ProjectAssignment(org_id=org.id, project_id=proj_rwe.id, user_id=vikram.id, assignment_role=desig_manager.name, department_id=dept_rwe.id, evaluator_type="Primary", assigned_date=date(2025, 3, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_rwe.id, user_id=ananya.id, assignment_role=desig_senior_consultant.name, department_id=dept_rwe.id, evaluator_type=None, assigned_date=date(2025, 3, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_rwe.id, user_id=karan.id, assignment_role=desig_consultant.name, department_id=dept_rwe.id, evaluator_type=None, assigned_date=date(2025, 3, 15)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_rwe.id, user_id=arjun.id, assignment_role="Lead Analyst", department_id=dept_strategy.id, evaluator_type=None, assigned_date=date(2025, 4, 1)))
            db.commit()

            proj_cross = Project(org_id=org.id, project_code="PRJ-004", name="Integrated Evidence Package - Oncology", description="Cross-functional deliverable combining strategy, IDT analytics, and RWE data.", start_date=date(2024, 10, 1), expected_end_date=date(2025, 9, 30), reports_to_id=admin_user.id)
            db.add(proj_cross)
            db.flush()

            db.add(ProjectAssignment(org_id=org.id, project_id=proj_cross.id, user_id=priya.id, assignment_role=desig_senior_manager.name, department_id=dept_strategy.id, evaluator_type="Primary", assigned_date=date(2024, 10, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_cross.id, user_id=rahul.id, assignment_role="Data Lead", department_id=dept_idt.id, evaluator_type=None, assigned_date=date(2024, 10, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_cross.id, user_id=ananya.id, assignment_role="RWE Lead", department_id=dept_rwe.id, evaluator_type=None, assigned_date=date(2024, 10, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_cross.id, user_id=neha.id, assignment_role=desig_consultant.name, department_id=dept_strategy.id, evaluator_type=None, assigned_date=date(2024, 10, 15)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_cross.id, user_id=vikram.id, assignment_role=desig_manager.name, department_id=dept_rwe.id, evaluator_type="Secondary", assigned_date=date(2024, 10, 1)))
            db.commit()

            print("  [+] Created Projects for Healthark")
        else:
            print("  [~] Healthark Projects already exist, skipping...")


        # ================================================================== #
        # 7. ROLE EXPECTATIONS                                                #
        # ================================================================== #
        # Minimal mock expectation seeding just to ensure the tables have data
        if db.query(RoleExpectation).filter(RoleExpectation.org_id == org.id).count() == 0:
            dept = db.query(Department).filter_by(org_id=org.id, name="Strategy").first()
            desig = db.query(Designation).filter_by(org_id=org.id, name="Consultant").first()
            if dept and desig:
                db.add(RoleExpectation(
                    org_id=org.id, department_id=dept.id, designation_id=desig.id,
                    exp_task_execution="Standard execution expectation.",
                    exp_ownership="Standard ownership expectation."
                ))
                db.commit()
            print("  [+] Seeded Role Expectations for Healthark")

        # ================================================================== #
        # 8. PROJECT REVIEWS (Cycles & Statuses for Dashboard Testing)        #
        # ================================================================== #
        
        # Helper lookup functions
        def get_uid(email):
            u = db.query(User).filter_by(email=email).first()
            return u.id if u else None

        def get_pid(code):
            p = db.query(Project).filter_by(project_code=code).first()
            return p.id if p else None

        if db.query(ProjectReview).filter(ProjectReview.org_id == org.id).count() == 0:
            reviews_to_seed = [
                # --- PAST CYCLE (H2 FY25) - Fully Completed ---
                # PRJ-001 (Market Access) 
                {"p_code": "PRJ-001", "u_email": "arjun@healthark.com", "pm_email": "priya@healthark.com", "cycle": "H2 FY25", "status": ProjectReviewStatus.REVIEWED.value, "rating": "4"},
                {"p_code": "PRJ-001", "u_email": "neha@healthark.com", "pm_email": "priya@healthark.com", "cycle": "H2 FY25", "status": ProjectReviewStatus.REVIEWED.value, "rating": "3"},
                
                # PRJ-004 (Cross - Multi-Cycle historical)
                {"p_code": "PRJ-004", "u_email": "rahul@healthark.com", "pm_email": "priya@healthark.com", "cycle": "H2 FY25", "status": ProjectReviewStatus.REVIEWED.value, "rating": "4"},
                {"p_code": "PRJ-004", "u_email": "ananya@healthark.com", "pm_email": "priya@healthark.com", "cycle": "H2 FY25", "status": ProjectReviewStatus.REVIEWED.value, "rating": "5"},
                {"p_code": "PRJ-004", "u_email": "neha@healthark.com", "pm_email": "priya@healthark.com", "cycle": "H2 FY25", "status": ProjectReviewStatus.REVIEWED.value, "rating": "3"},

                # --- CURRENT ACTIVE CYCLE (H1 FY26) - Mixed Pending/Completed ---
                # PRJ-002 (Patient Journey) - Partially Reviewed
                {"p_code": "PRJ-002", "u_email": "rahul@healthark.com", "pm_email": "david@healthark.com", "cycle": "H1 FY26", "status": ProjectReviewStatus.REVIEWED.value, "rating": "5"},
                {"p_code": "PRJ-002", "u_email": "meera@healthark.com", "pm_email": "david@healthark.com", "cycle": "H1 FY26", "status": ProjectReviewStatus.PENDING.value, "rating": None},

                # PRJ-003 (RWE Outcomes) - All Pending (Queue is full for PM Vikram)
                {"p_code": "PRJ-003", "u_email": "ananya@healthark.com", "pm_email": "vikram@healthark.com", "cycle": "H1 FY26", "status": ProjectReviewStatus.PENDING.value, "rating": None},
                {"p_code": "PRJ-003", "u_email": "karan@healthark.com", "pm_email": "vikram@healthark.com", "cycle": "H1 FY26", "status": ProjectReviewStatus.PENDING.value, "rating": None},
                {"p_code": "PRJ-003", "u_email": "arjun@healthark.com", "pm_email": "vikram@healthark.com", "cycle": "H1 FY26", "status": ProjectReviewStatus.PENDING.value, "rating": None},

                # PRJ-004 (Cross - Multi-Cycle current) - All Pending (Queue is full for PM Priya)
                {"p_code": "PRJ-004", "u_email": "rahul@healthark.com", "pm_email": "priya@healthark.com", "cycle": "H1 FY26", "status": ProjectReviewStatus.PENDING.value, "rating": None},
                {"p_code": "PRJ-004", "u_email": "ananya@healthark.com", "pm_email": "priya@healthark.com", "cycle": "H1 FY26", "status": ProjectReviewStatus.PENDING.value, "rating": None},
                {"p_code": "PRJ-004", "u_email": "neha@healthark.com", "pm_email": "priya@healthark.com", "cycle": "H1 FY26", "status": ProjectReviewStatus.PENDING.value, "rating": None},
            ]

            seed_count = 0
            for r_data in reviews_to_seed:
                uid = get_uid(r_data["u_email"])
                pid = get_pid(r_data["p_code"])
                pmid = get_uid(r_data["pm_email"])

                if uid and pid and pmid:
                    review = ProjectReview(
                        org_id=org.id,
                        user_id=uid,
                        project_id=pid,
                        reviewer_id=pmid,
                        cycle=r_data["cycle"],
                        status=r_data["status"],
                        performance_group=r_data["rating"],
                        impact_statement="Solid performance and good impact on the project deliverables." if r_data["status"] == ProjectReviewStatus.REVIEWED.value else None,
                        comment_task_execution="Consistently delivered high-quality outputs." if r_data["status"] == ProjectReviewStatus.REVIEWED.value else None,
                        comment_ownership="Took ownership of critical modules." if r_data["status"] == ProjectReviewStatus.REVIEWED.value else None,
                        comment_project_management="Handled timelines efficiently." if r_data["status"] == ProjectReviewStatus.REVIEWED.value else None,
                        comment_client_deliverables="Client was highly satisfied with the work." if r_data["status"] == ProjectReviewStatus.REVIEWED.value else None,
                        comment_communication="Communicated proactively with the team." if r_data["status"] == ProjectReviewStatus.REVIEWED.value else None,
                        comment_mentoring="Guided juniors well." if r_data["status"] == ProjectReviewStatus.REVIEWED.value else None,
                        comment_competency_skills="Demonstrated strong analytical skills." if r_data["status"] == ProjectReviewStatus.REVIEWED.value else None,
                    )
                    db.add(review)
                    seed_count += 1
            
            db.commit()
            print(f"  [+] Seeded {seed_count} Project Reviews across multiple cycles")
        else:
            print("  [~] Project Reviews already exist, skipping...")


        # ================================================================== #
        # DONE                                                                #
        # ================================================================== #

        print("\n" + "=" * 60)
        print("Database seeding completed successfully!")
        print("=" * 60)
        print("\n--- DASHBOARD TESTING ACCOUNTS (all passwords: password123) ---")
        print("  ADMIN:    admin@healthark.com    Sarah Admin     (Admin) - Can view the Management Tab with all cycle data")
        print("  STRATEGY: priya@healthark.com    Priya Sharma    (Staff) - Has 3 pending reviews in H1 FY26, 5 completed in H2 FY25")
        print("  IDT:      david@healthark.com    David Miller    (Staff) - Has 1 pending and 1 completed review in H1 FY26")
        print("  RWE:      vikram@healthark.com   Vikram Singh    (Staff) - Has 3 pending reviews in H1 FY26")
        print()

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()