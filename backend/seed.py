from app.core.database import SessionLocal
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import ProjectReview, ProjectReviewEvaluator
from app.models.annual_review_models import AnnualReview
from app.models.goal_models import Goal
from app.models.role_expectation_models import RoleExpectation
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

            # Notice the roles are now "Staff" for these senior members, but they are assigned as mentors below
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
            print("  [+] Created Healthark staff users (Relationship-based RBAC applied)")

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
                fiscal_start_month=4, # April Start
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
                fiscal_start_month=4, # April Start
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

        # Healthark Projects
        if db.query(Project).filter(Project.org_id == org.id).count() == 0 and priya and david and vikram:

            proj_ma = Project(org_id=org.id, project_code="PRJ-001", name="Market Access Strategy H1", description="Develop market access strategy for oncology portfolio across 5 EU markets.", start_date=date(2025, 1, 15), expected_end_date=date(2025, 6, 30), reports_to_id=admin_user.id)
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

            proj_cross = Project(org_id=org.id, project_code="PRJ-004", name="Integrated Evidence Package - Oncology", description="Cross-functional deliverable combining strategy, IDT analytics, and RWE data for an oncology product launch.", start_date=date(2025, 4, 1), expected_end_date=date(2025, 9, 30), reports_to_id=admin_user.id)
            db.add(proj_cross)
            db.flush()

            db.add(ProjectAssignment(org_id=org.id, project_id=proj_cross.id, user_id=priya.id, assignment_role=desig_senior_manager.name, department_id=dept_strategy.id, evaluator_type="Primary", assigned_date=date(2025, 4, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_cross.id, user_id=rahul.id, assignment_role="Data Lead", department_id=dept_idt.id, evaluator_type=None, assigned_date=date(2025, 4, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_cross.id, user_id=ananya.id, assignment_role="RWE Lead", department_id=dept_rwe.id, evaluator_type=None, assigned_date=date(2025, 4, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_cross.id, user_id=neha.id, assignment_role=desig_consultant.name, department_id=dept_strategy.id, evaluator_type=None, assigned_date=date(2025, 4, 15)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_cross.id, user_id=vikram.id, assignment_role=desig_manager.name, department_id=dept_rwe.id, evaluator_type="Secondary", assigned_date=date(2025, 4, 1)))
            db.commit()

            print("  [+] Created Projects for Healthark")

        else:
            print("  [~] Healthark Projects already exist, skipping...")


        # Miltenyi Projects
        if db.query(Project).filter(Project.org_id == miltenyi_org.id).count() == 0 and bob_lead and evan_mfg:
            
            proj_cell = Project(org_id=miltenyi_org.id, project_code="MIL-PRJ-001", name="Cell Therapy Automation Pipeline", description="Develop automated pipeline for CAR-T cell processing.", start_date=date(2025, 1, 10), expected_end_date=date(2025, 7, 30), reports_to_id=alice_admin.id)
            db.add(proj_cell)
            db.flush()

            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=bob_lead.id, assignment_role=desig_lead.name, department_id=dept_rnd.id, evaluator_type="Primary", assigned_date=date(2025, 1, 10)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=charlie.id, assignment_role=desig_sr_scientist.name, department_id=dept_rnd.id, evaluator_type=None, assigned_date=date(2025, 1, 15)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=dana.id, assignment_role=desig_scientist.name, department_id=dept_rnd.id, evaluator_type=None, assigned_date=date(2025, 2, 1)))
            db.commit()

            proj_macs = Project(org_id=miltenyi_org.id, project_code="MIL-PRJ-002", name="MACS Quant Scaling", description="Scale up manufacturing process for new MACS Quant flow cytometers.", start_date=date(2025, 3, 1), expected_end_date=date(2025, 10, 31), reports_to_id=alice_admin.id)
            db.add(proj_macs)
            db.flush()

            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=evan_mfg.id, assignment_role=desig_lead.name, department_id=dept_mfg.id, evaluator_type="Primary", assigned_date=date(2025, 3, 1)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=fiona.id, assignment_role=desig_scientist.name, department_id=dept_mfg.id, evaluator_type=None, assigned_date=date(2025, 3, 1)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=bob_lead.id, assignment_role="R&D Liaison", department_id=dept_rnd.id, evaluator_type="Secondary", assigned_date=date(2025, 3, 15)))
            db.commit()

            print("  [+] Created Projects for Miltenyi")

        else:
            print("  [~] Miltenyi Projects already exist, skipping...")


        # ================================================================== #
        # 7. ROLE EXPECTATIONS (Data Dictionary Import)                       #
        # ================================================================== #

        EXPECTATIONS_DATA = {
            "Strategy": {
                "Consultant": {
                    "exp_task_execution": "Applies fundamental frameworks with clear guidance. | Breaks down problems into smaller components - ability to tie back research and insights to client problem/ questions | Asks clarifying questions to ensure understanding of the problem context. | Devlops an initial thought process / approach for the assigned task (instead of relying on senior to provide instructions)",
                    "exp_ownership": "Takes full responsibility for assigned tasks and modules and execute independently once goals are defined. | Adheres to timelines and communicates potential delays early. | Proactively reach out to the project manager for timely progress.  | Focuses on quality output by double-checking work and able to maintain project files, standard data points / project-specific resources (e.g, world bank, IMF, WHO, CB Insights etc.) | Participates actively in planning and prioritizing smaller deliverables. | Able to effectively collaborate in a team setting - avoid duplicate efforts, compiles the version ensures consistent formatting, provide regular updates to senior",
                    "exp_client_deliverables": "Produces accurate, well-formatted outputs with minimal errors (e.g., grammar, typos, and sourcing). | Designs simple visualizations to convey data insights. | Ensures consistent formatting and alignment across slides or documents. | Actively learns the basics of storyboarding and tagline crafting. | Follow standard guidelines while deck-making (titles should tell a coherent story, version name should change every time, file name should be appropriate, color scheme should be consistent with deck, max two line titles etc.) | Able to leverage Healthark's reports / past deliverables for appropriate & creative slide designs (without spending too much time) | Apply good modelling practices and able to support basic financial modeling / analysis tasks such as creating bottom up or top down forecasting models under guidance. Also able to use formulas to existing data sets, analyse and find insights from it | Able to understand different components of financial statements and derive trends, insights & implications from the data",
                    "exp_communication": "Drafts clear and concise meeting notes, listing action items with ownership assigned. | Structure written communication effectively - Draft clear mail to client / project manager with progress updates, next steps mentioned for reference | Communicates key updates and next steps to internal teams & external teams (e.g. drafting MOMs, tracking open items) | Active listening the needs of client / project manager and translate it in the deliverables | Starts interpreting client asks and translates them into specific tasks under supervision. | Supports preparation for client readouts by collating inputs.",
                    "exp_project_management": "Able to conduct deep secondary research to support project requirements (able to use different combination of keywords, uses different sources to identify relevant information) | Performs note-taking, summarization of insights efficiently, and supporting interviews during primary research. | Takes ownership of research in a specific sector or function.",
                    "exp_mentoring": "Encourage/participate in team building. | Perform peer reviews and reviews of team members’ work for relevance and quality",
                    "exp_competency_skills": "Participate in firm activities and initiatives | Contribute to knowledge sharing/ development within the firm | [Firm Growth]: Builds foundational knowledge in a specific sector or a domain (that the practitioners has worked on) | Stays updated on key industry trends through reading and team discussions."
                },
                "Senior Consultant": {
                    "exp_task_execution": "Independently structures and solves moderately complex problems. | Able to think beyond the typical 3-chevron structure when crafting approaches, especially for proposals. Creating and using frameworks tailored to unique needs of the client | Conducts targeted secondary research and synthesizes insights into recommendations (able to identify alternative/ creative solutions to find information when juniors hit a roadblock).  | Creates independent perspective on the task and validates (and revalidates understanding) through different sources",
                    "exp_ownership": "Owns multiple modules within a project and ensures quality delivery. | Proactively manages deadlines and risks, escalating issues when needed. | Regularly updates managers on progress and raises potential issues proactively. | Able to effectively collaborate in a team setting - avoid duplicate efforts, compiles the version ensures consistent formatting, provide regular updates to project manager / leadership team / client | Guides junior team members on autonomy and task execution",
                    "exp_client_deliverables": "Develops polished, visually appealing outputs with compelling data-driven narratives. | Ensures all slides are logically structured and visually aligned to tell a cohesive story (able to craft detailed storyboards). | Demonstrates expertise in crafting visuals and insights that resonate with clients. | Owns and manages sourcing, number-checking, and refining deliverables. | Ensures accuracy in modeling outputs by conducting quality checks and reconciling data inconsistencies",
                    "exp_communication": "Leads internal discussions on project updates and next steps. | Summarizes and communicates client feedback clearly to the team. | Develop ability to present slides and story effectively and in a compelling/ engaging way using anecdotes/ examples/ implications/ open questions etc. (not just reading slide from top to bottom) | Interprets client asks effectively and translates them into actionable project requirements. | Able to drive content driven calls with junior to mid-management stakeholders (conduct dry run with project manager if needed) | Develop long term client relation | Begins co-leading sections of client readouts with supervision | Tracks open items when working on multiple projects and timely communicate to leadership during roadblocks",
                    "exp_project_management": "Develop project management plan and break down the problem - primary and secondary research plan: Structure sources, data requirements, approach, timelines for ease of coordination and delegation etc.   | Anticipates and plans for next steps in the project lifecycle and takes the initiative to go beyond assigned tasks to add value to the project. | Prepares discussion guides and organizes findings from primary research interviews. | Identifies multiple ways to identify leads for expert interviews - Tracks the converted leads, highlights important summaries from the interview, validates finding through secondary; Able to weave primary insights in the slides",
                    "exp_mentoring": "Provides guidance to junior team members on project tasks and deliverables. | Identify areas of improvement for junior practitioners (working with you) and give them opportunity to improve in those areas. Conduct regular cadence sessions to pass on timely feedback | Contributes insights and knowledge during client or internal discussions",
                    "exp_competency_skills": "Leads a firm initiative | Contribute to the firm’s knowledge base by writing white papers, blogs, or creating innovative frameworks/tools relevant to the firm's services or for internal use | Plays a major role in finalising proposals | Owns Knowledge management at the end of the project (structured research uploads, key documents etc.) to faciliate firm knowledge build-up | Supports the recruitment efforts and drive interviews / other activities when required with some leadership team | [Firm Growth]: Develops a deeper understanding of industry trends and challenges (especially the domain the practitioner has worked on) | Leads/ Support the primary interviews - able to cover important areas and ask questions based on the expert's response you are getting and not with an intention to cover the DG | Ability to develop detailed financial models independently for moderately complex scenarios. | Analyzes financial data to identify trends, perform scenario analysis, and make preliminary recommendations."
                },
                "Manager": {
                    "exp_task_execution": "Leads problem definition and solution design for complex issues. | Adapts frameworks creatively to meet client-specific needs. | Considers cross-functional and long-term implications of solutions. | Provides clear problem-solving guidance to team members. | Has the ability to recognise unknowns, possibilities, inviting new understandings and being receptive to change",
                    "exp_ownership": "Understand each team member’s working style and leverage their unique strengths for the project’s benefit | Drive content-driven calls for big accounts apart from small accounts and deliver read out effectively; (dry run with leadership if needed, identify important things to cover during the call) | Actively and continually monitors and manages project delivery to ensure a project adds value, is within scope, schedule, on budget and delivers to quality criteria set for the project | Plans and prioritises activity from multiple threads and start initiating action | Ensures insights are well-integrated into deliverables and recommendations.",
                    "exp_client_deliverables": "Crafts compelling, story-driven outputs aligned with client expectations. | Reviews and ensures final deliverables are free from errors. | Coaches team members on advanced storyboarding and tagline creation. | Reviews and refines team-built models, ensuring alignment with client objectives and industry standards. | Uses financial insights to guide strategic recommendations and support client decision-making processes.",
                    "exp_communication": "Leads client discussions, readouts, and critical meetings independently. | Present slides and story effectively and in a compelling/ engaging way using anecdotes/ examples/ open questions/ implications etc. | Builds trust and strong relationships with client stakeholders. | Interprets complex client asks and ensures they are effectively addressed in deliverables. | Coaches team members in handling client communications and managing client expectations.",
                    "exp_project_management": "Takes end-to-end ownership of projects or large workstreams. | Proactively identifies new client opportunities based on industry knowledge. | Proactively identifies and mitigates risks, and regular update on project progress, challenges and next steps to client and leadership team, ensuring smooth project execution.",
                    "exp_mentoring": "Coaches team members on advanced storyboarding and tagline creation | Guides team members on career development within the firm. | Pressure test and identify areas of opportunity for juniors / mentees to level-up in their career development",
                    "exp_competency_skills": "Identifies opportunities for process improvements and efficiency | Support organisation growth and continiously identify areas for upskilling team/ practice (Encourage people to undertake development activities, makes required resources available) | Acts as role model by fostering a positive culture within the organisation and demonstrates responsibility for review and action where required | Creates an environment to enable others to be creative, agile, innovative and value quality (give space to team members working on a project to think of approach, delegation instead of handholding everytime) | Play a leadership role within their firm, sometimes leading an new initiative,  a function (e.g. recruiting, social events), contributing in making collective decisions (promotions, staffing etc) | Leads proposals independently with minimal guidance from the leadership | Supports recruitment activities, train, and retain top talent while fostering a culture of collaboration and continuous learning | [Firm Growth]: Becomes a recognized expert in a specific sector or function and leads knowledge-sharing sessions to upskill the team. | Leadership in people management; ability to set up a followership culture in the team. | Demonstrates strong communication skills and the ability to interact at all levels; demonstrates strong executive presence. | Manages people and performance—sets expectations, conducts frequent check-ins, etc. | Leads the design and development of custom financial models and research work across healthcare domain for client-specific needs, incorporating advanced scenarios and sensitivity analyses."
                }
            },
            "IDT": {
                "Consultant": {
                    "exp_task_execution": "Perform simple to medium complexity tasks | Breaks down problems into smaller components. | Asks clarifying questions to ensure understanding of the problem context. | Develops an initial thought process / approach for the assigned task (instead of relying on senior to provide instructions)",
                    "exp_ownership": "Executes tasks independently once goals are defined. | Proactively seeks guidance when encountering roadblocks. | Demonstrates initiative by suggesting minor improvements in deliverables. | Self-review deliverables, work outputs for quality before passing onto team lead for review and take actions to improve as needed | Assist manager/team members during the absence of lead, as needed",
                    "exp_project_management": "Takes full responsibility for assigned tasks and modules. | Adheres to timelines and communicates potential delays early. | Understand and adhere to project delivery processes in client delivery & keep project documents updated | Proactively reach out to the project manager for timely progress.",
                    "exp_client_deliverables": "Produces quality code/deliverables with no major defects. | Drafts well-formatted and accurate emails/documents  | Designs simple visualizations to convey data insights.",
                    "exp_communication": "Drafts clear and concise meeting notes, listing action items with ownership assigned. | Structure written communication effectively - Draft clear mail to client / project manager with progress updates, next steps mentioned for reference | Communicates key updates and next steps to internal teams & external teams (e.g. drafting MOMs, tracking open items) | Active listening the needs of client / project manager and translate it in the deliverables | Starts interpreting client asks and translates them into specific tasks under supervision.",
                    "exp_mentoring": "Encourage/participate in team building. | Conduct knowledge management sessions in the project around delivery processes and technology trends",
                    "exp_competency_skills": "Participate in firm activities and initiatives | Contribute to knowledge sharing/development within the firm | Contribute to Emminence and Excellence activities to grow the Service offering for their respective practice area. | [Firm Growth]: Proficient in assigned technology area and produces quality code/deliverables on time. | Demonstrates reduction in guidance required from Senior team members | Suggest process improvements/innovation/automation opportunities | Understands the domain of the project assigned"
                },
                "Senior Consultant": {
                    "exp_task_execution": "Independently structures and solves moderately complex problems. | Develops the technical architecture to address the problem statement in collaboration with leads of the different tech stacks involved. | Present the architecture to the Architecture Review Board/Client to gain acceptance",
                    "exp_ownership": "Owns multiple modules within a project and ensures quality delivery. | Regularly updates managers on progress and raises potential issues proactively. | Guides junior team members on autonomy and task execution. | Anticipates and plans for next steps in the project lifecycle and takes the initiative to go beyond assigned tasks to add value to the project. | Step in and take lead during the absence of manager, as needed.",
                    "exp_project_management": "Perform work estimation, planning, allocation, and schedule management of delivery within team members | Communicates timely status, key updates and next steps to clients/stakeholders | Proactively manages deadlines and risks, escalating issues when needed. | Manages 1-2 projects or threads simultaneously, able to manage workload. | Abillity to assess risk scope to determine which can be managed independently and which require escalation to project manager and/ or other internal stakeholders, ensuring timely resolution",
                    "exp_client_deliverables": "Reviews code/deliverable by junior team members to ensure adherence to Quality. | Leverage expertise in the vertical to produce contextual, high-quality deliverables (polished and visually cohesive), along with the ability to generate new content as required.",
                    "exp_communication": "Leads internal discussions on project updates and next steps. | Summarizes and communicates client feedback clearly to the team. | Interprets client asks effectively and translates them into actionable project requirements. | Independently interact with clients and lead 1 or more project thread and a small team | Develop long term client relationship | Tracks open items when working on multiple projects and timely communicate to leadership during roadblocks",
                    "exp_mentoring": "Provides guidance to junior team members on project tasks and deliverables. | Identify areas of improvement for junior practitioners (working with you) and give them opportunity to improve in those areas. Conduct regular cadence sessions to pass on timely feedback | Demonstrate maturity of leading/grooming/coaching teams in the areas of client communication, project knowledge, and industry knowledge.",
                    "exp_competency_skills": "Play a leadership role within the team, is the face of the organization/ leadership team to junior team members | Participates on new proposals/SoW creation. | Lead and own Emminence and Excellence activities to grow the Service offering for their respective practice area. | Participating in screening and hiring of new members in the organization | [Firm Growth]: Produces quality code/deliverables on time. | Reviews code/deliverable by junior team members to ensure adherence to Quality. | Demonstrates expertise in core technology area and showcases ability to act as a back-up of primary SME in other technology areas. | Suggest and drive process improvements/innovation/automation opportunities | Demonstrates process awareness and project management. | Able to lead estimations for specific areas of expertise. | Understands the domain of the project assigned"
                },
                "Manager": {
                    "exp_task_execution": "Leads problem definition and solution design for complex issues. | Identify the appropriate technology stack/architecture to build the solution for the client requirement | Applies best practices in delivery and program management | Considers cross-functional and long-term implications of solutions. | Provides clear problem-solving guidance to team members. | Has the ability to recognise unknowns, possibilities, inviting new understandings and being receptive to change",
                    "exp_ownership": "Builds a culture of leadership within the team by aligning strategic goals with delivery expectations | Independently manages multiple/ large projects with substantial staff involvement | Owns and manages end-to-end delivery of projects, ensuring quality, risk management, schedule and budget adherence, and meeting client satisfaction",
                    "exp_project_management": "Owns the SoW/Work Order and ensures governance on processes and compliance. | Takes end-to-end ownership of projects or large workstreams. | Proactively identifies risks, leads client/ internal discussions to mitigate risks and achieve strategic objectives. Manages quality and risks, ensuring alignment with client satisfaction. | Leads team planning and ensures delivery aligns with client goals. | Actively and continually monitors and manages project delivery to ensure a project adds value, is within scope, schedule, on budget and delivers to quality criteria set for the project | Tracks scope changes, scope creep, and works with internal and client stakeholders to manage change in scope. | Plans and prioritises activity from multiple threads and start initiating action | Ensures lessons learned from previous projects are well-integrated into current or new projects.",
                    "exp_client_deliverables": "Reviews and ensures final deliverables are free from critical/major defects. | Leads the design for complex/new tasks or deliverable to ensure compelling, story-driven outputs aligned with client expectations.",
                    "exp_communication": "Leads client discussions, and critical meetings independently. | Builds trust and strong relationships with client stakeholders. | Provide regular updates on project progress, challenges, and next steps to client and leadership team (not just limited to any project) | Interprets complex client asks and ensures they are effectively addressed in deliverables. | Coaches team members in handling client communications and managing client expectations.",
                    "exp_mentoring": "Develops junior team members through structured coaching and feedback. | Guides team members on career development within the firm. | Pressure test and identify areas of opportunity for juniors / mentees to level-up in their career development | Manages stated compliance parameters and drives the culture of meeting expectations within the team. | Coaches team members in handling client communications and managing client expectations | Address team challenges or disputes (team dynamics) promptly with fairness | Creates an environment to enable others to be creative, agile, innovative and value quality (give space to team members working on a project to think of approach, delegation instead of handholding everytime) | Understand each team member’s working style and leverage their unique strengths for the project’s benefit | Support organisation growth and continiously identify areas for upskilling team/ practice (Encourage people to undertake development activities, makes required resources available)",
                    "exp_competency_skills": "Acts as role model by fostering a positive culture within the organisation and demonstrates responsibility for review and action where required | Operates with full independence, managing projects and anticipating client needs. | Identifies opportunities for process improvements and efficiency | Play a leadership role within their firm, sometimes leading an new initiative, a function (e.g. recruiting, social events), contributing in making collective decisions (promotions, staffing etc) | Leads proposals independently with minimal guidance from the leadership | Supports recruitment activities | Recruit, train, and retain top talent while fostering a culture of collaboration and continuous learning | [Firm Growth]: Expertise across multiple project delivery/SDLC methodology - Agile, Waterfall, DevOps, and ability to adapt these to the client requirements. | Keep abreast of new technology trends and identify innovation/improvement opportunities. | Drive consensus on the architecture/tech stack with client and internal stakeholders. | Demonstrates strong communication skills and the ability to interact at all levels; demonstrates strong executive presence. | Demonstrates project management skills across implement and operate body of work. | Manages people and performance—sets expectations, conducts frequent check-ins, etc. | Understands the domain of the project assigned"
                }
            },
            "RWE": {
                "Consultant": {
                    "exp_task_execution": "Perform simple to medium complexity tasks",
                    "exp_ownership": "Complete assigned tasks on time",
                    "exp_project_management": "Communicates timely status, key updates and next steps to internal teams & external teams (e.g. drafting MOMs, tracking open items)",
                    "exp_communication": "Drafts clear and concise meeting notes, listing action items with ownership assigned",
                    "exp_client_deliverables": "Produces accurate, well-formatted outputs with minimal errors (e.g., grammar, typos, and sourcing).",
                    "exp_mentoring": "Encourage/participate in team building.",
                    "exp_competency_skills": "Participate in firm activities and initiatives | [Firm Growth]: Proficient in project-specific concepts and areas"
                },
                "Senior Consultant": {
                    "exp_task_execution": "Able to develop an independent perspective on tasks, structure and solve complex problems",
                    "exp_ownership": "Owns delivery of 1 or more threads within a project - is responsible for the end result and quality of project delivery",
                    "exp_project_management": "Perform work estimation, planning, allocation, and schedule management of delivery within team members",
                    "exp_communication": "Independently interact with clients and lead 1 or more project thread and a small team",
                    "exp_client_deliverables": "Leverage expertise in the vertical to produce contextual, high-quality deliverables (polished and visually cohesive), along with the ability to generate new content as required.",
                    "exp_mentoring": "Demonstrate maturity of leading/grooming/coaching teams in the areas of client communication, project knowledge, and industry knowledge.",
                    "exp_competency_skills": "Play a leadership role within the team, is the face of the organization/ leadership team to junior team members | [Firm Growth]: Is a Subject Matter Expert (SME) in one of the verticals, able to collaborate with the different stakeholders involved, and plays a mentorship role to junior staff for areas within the vertical"
                },
                "Manager": {
                    "exp_task_execution": "Leads problem definition and solution design for complex issues across functions/ verticals",
                    "exp_ownership": "Independently manages multiple/ large projects with substantial staff involvement",
                    "exp_project_management": "Manages resources, staffing, and undertakes reporting responsibilities.",
                    "exp_communication": "Socializes with clients and onshore counterparts to prioritize client demand and meeting business KPIs.",
                    "exp_client_deliverables": "Leads the design and story boarding for complex/ new tasks or deliverable to ensure compelling, story-driven outputs aligned with client expectations.",
                    "exp_mentoring": "Builds and enhances skills of practitioners; undertakes counseling, coaching, and mentoring responsibilities.",
                    "exp_competency_skills": "Play a leadership role within the firm, acts as role model by fostering a positive culture  and encourage team work. within the organisation | [Firm Growth]: Understands multiple areas/ domain in his/her vertical, sense new trends that accelerate growth and build competencies, able to collaborate with the different stakeholders involved"
                }
            }
        }

        # Seed Healthark Role Expectations from the Object
        if db.query(RoleExpectation).filter(RoleExpectation.org_id == org.id).count() == 0:
            added_count = 0
            
            for dept_name, designations_dict in EXPECTATIONS_DATA.items():
                dept = db.query(Department).filter(Department.org_id == org.id, Department.name == dept_name).first()
                if not dept:
                    continue # Skip if department doesn't exist
                
                for desig_name, competencies in designations_dict.items():
                    desig = db.query(Designation).filter(Designation.org_id == org.id, Designation.name == desig_name).first()
                    if not desig:
                        continue # Skip if designation doesn't exist
                    
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
                        exp_competency_skills=competencies.get("exp_competency_skills", "")
                    ))
                    added_count += 1
            
            db.commit()
            print(f"  [+] Seeded {added_count} Role Expectations for Healthark from data dictionary")
        else:
            print("  [~] Healthark Role expectations already exist, skipping...")


        # ================================================================== #
        # 8. HISTORICAL PROJECT REVIEWS                                       #
        # ================================================================== #

        proj_ma    = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-001").first()
        proj_idt   = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-002").first()
        proj_rwe   = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-003").first()
        proj_cross = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-004").first()

        def _pr(user, project, reviewer, cycle, status, pg=None, impact=None, **comments):
            if not db.query(ProjectReview).filter_by(
                org_id=org.id, user_id=user.id, project_id=project.id, cycle=cycle
            ).first():
                db.add(ProjectReview(
                    org_id=org.id, user_id=user.id, project_id=project.id,
                    reviewer_id=reviewer.id if reviewer else None,
                    cycle=cycle, status=status,
                    performance_group=pg, impact_statement=impact, **comments
                ))

        def _pre(review_id, evaluator, impact, status="submitted"):
            if not db.query(ProjectReviewEvaluator).filter_by(
                project_review_id=review_id, evaluator_id=evaluator.id
            ).first():
                db.add(ProjectReviewEvaluator(
                    org_id=org.id, project_review_id=review_id,
                    evaluator_id=evaluator.id, evaluator_type="Secondary",
                    status=status, impact_statement=impact,
                ))

        if db.query(ProjectReview).filter(ProjectReview.org_id == org.id).count() == 0 \
                and proj_ma and proj_idt and proj_rwe and proj_cross:

            # ── H1 FY25: All Reviewed ──────────────────────────────────────
            # PRJ-001 (PM: Priya)
            _pr(arjun, proj_ma, priya, "H1 FY25", "reviewed", pg="4",
                impact="Arjun consistently delivered high-quality EU market analysis with strong analytical rigor.",
                comment_task_execution="Applied frameworks independently; delivered structured outputs for all EU segments.",
                comment_ownership="Owned the EU market analysis end-to-end with minimal supervision.",
                comment_project_management="Maintained updated project docs and communicated proactively.",
                comment_client_deliverables="Decks were well-structured with compelling narratives and minimal errors.",
                comment_communication="Clear and timely communications; MOMs precise with ownership tags.",
                comment_mentoring="Supported Neha on deck formatting and secondary research methodology.",
                comment_competency_skills="Developing solid expertise in oncology market access frameworks.",
            )
            _pr(neha, proj_ma, priya, "H1 FY25", "reviewed", pg="3",
                impact="Neha contributed effectively to research and slide preparation across EU markets.",
                comment_task_execution="Completed assigned research tasks with guidance; learning to structure independently.",
                comment_ownership="Reliable on assigned modules; could proactively flag delays earlier.",
                comment_project_management="Follows instructions well; working on self-organizing.",
                comment_client_deliverables="Produced clean slides with good formatting consistency.",
                comment_communication="Clear meeting notes; improving ability to synthesize client feedback.",
                comment_mentoring="Participates actively in team discussions.",
                comment_competency_skills="Building foundation in market access research.",
            )
            db.flush()
            arjun_ma_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=arjun.id, project_id=proj_ma.id, cycle="H1 FY25").first()
            neha_ma_h1  = db.query(ProjectReview).filter_by(org_id=org.id, user_id=neha.id,  project_id=proj_ma.id, cycle="H1 FY25").first()
            if arjun_ma_h1: _pre(arjun_ma_h1.id, david, "Arjun integrated IDT data perspectives seamlessly into the strategy deliverable.")
            if neha_ma_h1:  _pre(neha_ma_h1.id,  david, "Neha was responsive to cross-functional requests and maintained clear documentation.")
            db.commit()

            # PRJ-002 (PM: David)
            _pr(rahul, proj_idt, david, "H1 FY25", "reviewed", pg="4",
                impact="Rahul delivered the core analytics pipeline with strong technical quality.",
                comment_task_execution="Independently developed and tested multiple data pipeline components.",
                comment_ownership="Took full ownership of assigned modules; proactively resolved blockers.",
                comment_project_management="Tracked tasks diligently and flagged risks proactively.",
                comment_client_deliverables="Code quality was high; dashboards were client-ready with minimal rework.",
                comment_communication="Clear updates; good at translating technical details for stakeholders.",
                comment_mentoring="Guided Meera on data modeling and visualization best practices.",
                comment_competency_skills="Strong SQL and visualization skills; developing Python proficiency.",
            )
            _pr(meera, proj_idt, david, "H1 FY25", "reviewed", pg="3",
                impact="Meera contributed meaningfully to data preparation and dashboard components.",
                comment_task_execution="Completed assigned data tasks with guidance; learning to work independently.",
                comment_ownership="Reliable on assigned work; building confidence to manage full modules.",
                comment_project_management="Adheres to timelines; proactive communication improving.",
                comment_client_deliverables="Produced well-formatted outputs; number accuracy improving.",
                comment_communication="Good meeting participation; written communication becoming more concise.",
                comment_mentoring="Eager to learn; receptive to feedback during code reviews.",
                comment_competency_skills="Progressing well in SQL and data visualization tools.",
            )
            db.flush()
            rahul_idt_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=rahul.id, project_id=proj_idt.id, cycle="H1 FY25").first()
            meera_idt_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=meera.id, project_id=proj_idt.id, cycle="H1 FY25").first()
            if rahul_idt_h1: _pre(rahul_idt_h1.id, vikram, "Rahul's RWE data integration added significant value to the analytics platform.")
            if meera_idt_h1: _pre(meera_idt_h1.id, vikram, "Meera handled cross-functional data requests well and maintained good documentation.")
            db.commit()

            # PRJ-003 (PM: Vikram)
            _pr(ananya, proj_rwe, vikram, "H1 FY25", "reviewed", pg="4",
                impact="Ananya led protocol design and statistical analysis with strong scientific rigor.",
                comment_task_execution="Structured complex RWE methodology questions independently with scientific depth.",
                comment_ownership="Owned the protocol design module; proactively managed dependencies.",
                comment_project_management="Thorough planning and risk communication; excellent timeline adherence.",
                comment_client_deliverables="Study outputs were scientifically sound and client-ready.",
                comment_communication="Confident presenter; translates complex RWE concepts clearly.",
                comment_mentoring="Actively coached Karan on study design principles.",
                comment_competency_skills="Growing expertise in cardiovascular outcomes research.",
            )
            _pr(karan, proj_rwe, vikram, "H1 FY25", "reviewed", pg="3",
                impact="Karan supported data collection and literature review effectively.",
                comment_task_execution="Completed literature review tasks thoroughly with guidance on prioritization.",
                comment_ownership="Dependable on assigned tasks; building initiative for broader scope.",
                comment_project_management="Good at following project plans; working on proactive risk flagging.",
                comment_client_deliverables="Research summaries were accurate; formatting improving.",
                comment_communication="Clear internal communications; developing confidence in stakeholder interactions.",
                comment_mentoring="Active participant in team discussions.",
                comment_competency_skills="Building foundational RWE knowledge; progressing steadily.",
            )
            db.commit()

            # PRJ-004 (PM: Priya) — cross-functional
            _pr(rahul, proj_cross, priya, "H1 FY25", "reviewed", pg="4",
                impact="Rahul's IDT analytics work was a cornerstone of the integrated evidence package.",
                comment_task_execution="Delivered the data integration layer connecting IDT, strategy, and RWE workstreams.",
                comment_ownership="Managed the data pipeline end-to-end with minimal oversight.",
                comment_project_management="Coordinated well across three teams; maintained a clear cross-functional tracker.",
                comment_client_deliverables="Final data outputs were clean, well-documented, and client-facing ready.",
                comment_communication="Excellent communicator across functional boundaries.",
                comment_mentoring="Supported cross-functional team members on data access and tooling.",
                comment_competency_skills="Showcased breadth across analytics, data engineering, and RWE data concepts.",
            )
            _pr(ananya, proj_cross, priya, "H1 FY25", "reviewed", pg="4",
                impact="Ananya's RWE input strengthened the evidence base significantly.",
                comment_task_execution="Independently synthesized RWE evidence into the oncology evidence package.",
                comment_ownership="Took initiative to go beyond assigned scope and drive the evidence narrative.",
                comment_project_management="Excellent cross-workstream coordination; flagged timeline risks early.",
                comment_client_deliverables="RWE sections were scientifically robust and visually compelling.",
                comment_communication="Effective communicator with both technical and strategy team members.",
                comment_mentoring="Shared RWE knowledge with strategy team members.",
                comment_competency_skills="Demonstrated strong oncology RWE expertise in cross-functional setting.",
            )
            _pr(neha, proj_cross, priya, "H1 FY25", "reviewed", pg="3",
                impact="Neha contributed to strategy slides and research compilation.",
                comment_task_execution="Handled research and slide compilation tasks reliably.",
                comment_ownership="Dependable contributor; building confidence for broader ownership.",
                comment_project_management="Good at following plans; improving at proactive status updates.",
                comment_client_deliverables="Outputs were well-formatted; storytelling improving.",
                comment_communication="Clear and timely on assigned communication tasks.",
                comment_mentoring="Learning from cross-functional exposure.",
                comment_competency_skills="Growing understanding of integrated evidence requirements.",
            )
            db.flush()
            rahul_cross_h1  = db.query(ProjectReview).filter_by(org_id=org.id, user_id=rahul.id,  project_id=proj_cross.id, cycle="H1 FY25").first()
            ananya_cross_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=ananya.id, project_id=proj_cross.id, cycle="H1 FY25").first()
            neha_cross_h1   = db.query(ProjectReview).filter_by(org_id=org.id, user_id=neha.id,   project_id=proj_cross.id, cycle="H1 FY25").first()
            if rahul_cross_h1:  _pre(rahul_cross_h1.id,  vikram, "Rahul's cross-functional coordination on the RWE-IDT integration was excellent.")
            if ananya_cross_h1: _pre(ananya_cross_h1.id, vikram, "Ananya delivered strong RWE sections with scientific rigor and good client focus.")
            if neha_cross_h1:   _pre(neha_cross_h1.id,   vikram, "Neha was a reliable contributor across the cross-functional workstreams.")
            db.commit()

            # ── H2 FY25: Mix of Reviewed and Pending ──────────────────────
            # PRJ-001 (PM: Priya) — both reviewed
            _pr(arjun, proj_ma, priya, "H2 FY25", "reviewed", pg="4",
                impact="Arjun stepped up significantly, taking on broader project coordination responsibilities.",
                comment_task_execution="Proactively identified and structured research gaps without supervision.",
                comment_ownership="Owned two major modules simultaneously; no missed deadlines.",
                comment_project_management="Introduced a cross-team tracker that improved coordination.",
                comment_client_deliverables="High-quality, narrative-driven slides with strong data visualization.",
                comment_communication="Increasingly confident in stakeholder meetings; clear written updates.",
                comment_mentoring="Actively guided Neha and Karan on research frameworks.",
                comment_competency_skills="Strong growth in market access strategy; demonstrating Senior Consultant potential.",
            )
            _pr(neha, proj_ma, priya, "H2 FY25", "reviewed", pg="4",
                impact="Neha showed strong improvement in quality and independence during H2.",
                comment_task_execution="Began structuring tasks independently with less guidance needed.",
                comment_ownership="More proactive in flagging risks and seeking clarification early.",
                comment_project_management="Better at timeline adherence and progress communication.",
                comment_client_deliverables="Noticeable improvement in slide quality and storyboarding.",
                comment_communication="More confident in team discussions; writing quality improved.",
                comment_mentoring="Beginning to support newer members on basic tasks.",
                comment_competency_skills="Solid progress in core market access research competencies.",
            )
            db.commit()

            # PRJ-002 (PM: David) — Rahul reviewed, Meera pending
            _pr(rahul, proj_idt, david, "H2 FY25", "reviewed", pg="5",
                impact="Rahul delivered an exceptional H2 with strong technical leadership across the platform.",
                comment_task_execution="Led architecture decisions for the expanded analytics platform independently.",
                comment_ownership="End-to-end ownership across three complex workstreams; zero delivery misses.",
                comment_project_management="Introduced sprint planning that improved the team's delivery velocity significantly.",
                comment_client_deliverables="Client-facing dashboards were best-in-class; zero rework requested.",
                comment_communication="Excellent executive-level communication; translated technical complexity clearly.",
                comment_mentoring="Strong mentor to Meera; ran weekly coaching sessions throughout H2.",
                comment_competency_skills="Demonstrated Senior Consultant-level depth across data engineering and analytics.",
            )
            _pr(meera, proj_idt, david, "H2 FY25", "pending")
            db.commit()

            # PRJ-003 (PM: Vikram) — Ananya reviewed, Karan pending
            _pr(ananya, proj_rwe, vikram, "H2 FY25", "reviewed", pg="5",
                impact="Ananya's leadership elevated the quality of the entire H2 cardiology deliverable.",
                comment_task_execution="Led statistical analysis design independently; set a high standard for the team.",
                comment_ownership="Complete ownership of study protocol and evidence synthesis.",
                comment_project_management="Managed stakeholder timelines across 4 client sites seamlessly.",
                comment_client_deliverables="Deliverables were publication-ready with strong scientific rigor.",
                comment_communication="Effective client presenter; built strong rapport with clinical stakeholders.",
                comment_mentoring="Mentored Karan on study design; organized internal knowledge sessions.",
                comment_competency_skills="Emerging as an RWE SME in cardiovascular outcomes research.",
            )
            _pr(karan, proj_rwe, vikram, "H2 FY25", "pending")
            db.commit()

            # PRJ-004 (PM: Priya) — Rahul + Ananya reviewed, Neha pending
            _pr(rahul, proj_cross, priya, "H2 FY25", "reviewed", pg="4",
                impact="Rahul's H2 contribution to the integrated evidence package was outstanding.",
                comment_task_execution="Led the cross-functional data harmonization with minimal guidance.",
                comment_ownership="Managed multi-team dependencies with full accountability.",
                comment_project_management="Exceptional tracker management and risk escalation.",
                comment_client_deliverables="Integrated evidence outputs were best-in-class.",
                comment_communication="Proactively communicated cross-functional risks to leadership.",
                comment_mentoring="Supported strategy and RWE team members on data tooling.",
                comment_competency_skills="Demonstrated strong cross-functional expertise.",
            )
            _pr(ananya, proj_cross, priya, "H2 FY25", "reviewed", pg="5",
                impact="Ananya's RWE leadership was pivotal to the H2 oncology evidence package.",
                comment_task_execution="Led the RWE synthesis workstream with high scientific standards.",
                comment_ownership="Full ownership of RWE narrative; went beyond scope to strengthen evidence base.",
                comment_project_management="Managed timelines across multiple workstreams without issues.",
                comment_client_deliverables="Best-in-class RWE output; received specific client praise.",
                comment_communication="Excellent at presenting complex evidence to non-technical stakeholders.",
                comment_mentoring="Coached the strategy team on RWE interpretation.",
                comment_competency_skills="Top-tier RWE expertise; recognized as internal SME.",
            )
            _pr(neha, proj_cross, priya, "H2 FY25", "pending")
            db.commit()

            # ── H1 FY26 (Current): All Pending ────────────────────────────
            _pr(ananya, proj_rwe,   vikram, "H1 FY26", "pending")
            _pr(karan,  proj_rwe,   vikram, "H1 FY26", "pending")
            _pr(rahul,  proj_cross, priya,  "H1 FY26", "pending")
            _pr(ananya, proj_cross, priya,  "H1 FY26", "pending")
            _pr(neha,   proj_cross, priya,  "H1 FY26", "pending")
            db.commit()

            print("  [+] Created Project Reviews: H1 FY25 (all reviewed), H2 FY25 (mixed), H1 FY26 (pending)")
        else:
            print("  [~] Healthark Project Reviews already exist, skipping...")


        # ================================================================== #
        # 9. ANNUAL REVIEWS                                                   #
        # ================================================================== #

        def _ar(user, mentor, cycle, status, **fields):
            if not db.query(AnnualReview).filter_by(
                org_id=org.id, user_id=user.id, cycle_name=cycle
            ).first():
                db.add(AnnualReview(
                    org_id=org.id, user_id=user.id,
                    mentor_id=mentor.id if mentor else None,
                    cycle_name=cycle, status=status, **fields
                ))

        if db.query(AnnualReview).filter(AnnualReview.org_id == org.id).count() == 0:

            # ── H1 FY25: All Completed ────────────────────────────────────
            _ar(arjun, priya, "H1 FY25", "completed",
                self_desc_ownership="Led the EU market analysis module independently with full accountability across all milestones.",
                self_desc_productivity="Completed all research and slide tasks ahead of deadlines consistently.",
                self_desc_communication="Maintained clear, structured communications and produced concise MOMs throughout.",
                self_desc_leadership="Supported Neha on research methodology and deck structuring; initiated team knowledge sessions.",
                self_desc_adaptability="Adapted quickly to scope changes in the EU market analysis module without losing pace.",
                self_desc_time_management="Managed multiple research streams simultaneously with zero missed deadlines.",
                self_stars=4,
                mentor_comment_ownership="Arjun demonstrated strong module ownership; delivered consistently high quality work.",
                mentor_comment_productivity="Highly productive; one of the most efficient contributors on the project.",
                mentor_comment_communication="Clear communicator; MOMs and progress updates were always timely and precise.",
                mentor_comment_leadership="Showed early signs of leadership potential; mentored Neha effectively.",
                mentor_comment_adaptability="Handled multiple scope changes gracefully without disrupting timelines.",
                mentor_comment_time_management="Excellent time management; consistently ahead of schedule.",
                mentor_stars=4,
                management_stars=4, final_stars=4,
                management_comments="Arjun is a high-performer tracking well for a Senior Consultant promotion.",
                final_rating_enabled=True,
            )
            _ar(neha, priya, "H1 FY25", "completed",
                self_desc_ownership="Completed all assigned research tasks and delivered slides as required.",
                self_desc_productivity="Maintained consistent output quality across the project.",
                self_desc_communication="Improved communication through regular check-ins with Priya.",
                self_desc_leadership="Beginning to take initiative on smaller research tasks.",
                self_desc_adaptability="Adapted to new slide formats and research tools quickly.",
                self_desc_time_management="Met all individual deadlines with support from the team.",
                self_stars=3,
                mentor_comment_ownership="Neha is reliable on assigned tasks; building confidence for broader scope.",
                mentor_comment_productivity="Consistent output; quality improving with each deliverable.",
                mentor_comment_communication="Good written communication; verbal confidence growing.",
                mentor_comment_leadership="Early stages of initiative; needs encouragement to lead tasks.",
                mentor_comment_adaptability="Good adaptability to new frameworks and tools.",
                mentor_comment_time_management="Met deadlines consistently; still requires prompting for proactive flagging.",
                mentor_stars=3,
                management_stars=3, final_stars=3,
                management_comments="Neha is on track as a Consultant; continuing to grow steadily.",
                final_rating_enabled=True,
            )
            _ar(rahul, david, "H1 FY25", "completed",
                self_desc_ownership="Owned the analytics pipeline development end-to-end with full accountability.",
                self_desc_productivity="Delivered high-quality code and dashboards ahead of schedule.",
                self_desc_communication="Maintained clear cross-team communications on data dependencies.",
                self_desc_leadership="Guided Meera on data modeling and helped onboard her to project tooling.",
                self_desc_adaptability="Handled changing data requirements without disruption to timelines.",
                self_desc_time_management="Managed tasks across the sprint backlog effectively.",
                self_stars=4,
                mentor_comment_ownership="Rahul is one of our most accountable team members; full ownership demonstrated.",
                mentor_comment_productivity="Exceptional productivity; consistently the highest quality output on the team.",
                mentor_comment_communication="Clear and structured communications; technical explanations are accessible.",
                mentor_comment_leadership="Strong mentor to Meera; genuine investment in her growth.",
                mentor_comment_adaptability="Adapted to multiple technical stack changes without losing pace.",
                mentor_comment_time_management="Outstanding time management; planned ahead effectively.",
                mentor_stars=4,
                management_stars=4, final_stars=4,
                management_comments="Rahul is one of our top performers in IDT; strong Senior Consultant track.",
                final_rating_enabled=True,
            )
            _ar(meera, david, "H1 FY25", "completed",
                self_desc_ownership="Completed all assigned data tasks and supported the dashboard development.",
                self_desc_productivity="Maintained steady output quality throughout the project.",
                self_desc_communication="Improved at writing concise updates and flagging blockers.",
                self_desc_leadership="Participated actively in team reviews and knowledge sharing.",
                self_desc_adaptability="Adapted to new data tools and formats with support from Rahul.",
                self_desc_time_management="Met assigned deadlines with guidance from David.",
                self_stars=3,
                mentor_comment_ownership="Meera is reliable; building confidence to own larger modules.",
                mentor_comment_productivity="Good output quality; accuracy has improved significantly.",
                mentor_comment_communication="Improving; becoming more proactive with status updates.",
                mentor_comment_leadership="Participates well in team discussions; developing mentoring instincts.",
                mentor_comment_adaptability="Good adaptability; handled new tooling transitions well.",
                mentor_comment_time_management="Consistent with deadlines; growing independence in planning.",
                mentor_stars=3,
                management_stars=3, final_stars=3,
                management_comments="Meera is progressing well as a Consultant; steady improvement trajectory.",
                final_rating_enabled=True,
            )
            _ar(ananya, vikram, "H1 FY25", "completed",
                self_desc_ownership="Led the cardiology study protocol design with full scientific accountability.",
                self_desc_productivity="Delivered study outputs on schedule; maintained high scientific standards throughout.",
                self_desc_communication="Presented RWE methodology clearly to client and internal stakeholders.",
                self_desc_leadership="Coached Karan on study design fundamentals and statistical reasoning.",
                self_desc_adaptability="Adapted to changing client data requirements mid-study without protocol disruption.",
                self_desc_time_management="Managed multi-site coordination timelines effectively.",
                self_stars=4,
                mentor_comment_ownership="Ananya is a standout on ownership; led a complex study with full accountability.",
                mentor_comment_productivity="High-quality scientific outputs; minimal rework required across any deliverable.",
                mentor_comment_communication="Excellent communicator; confident with clinical and client stakeholders.",
                mentor_comment_leadership="Natural mentor; significantly improved Karan's study design capability.",
                mentor_comment_adaptability="Handled protocol changes gracefully; maintained scientific integrity.",
                mentor_comment_time_management="Exceptional planning; multi-site timelines managed with no issues.",
                mentor_stars=4,
                management_stars=4, final_stars=4,
                management_comments="Ananya is our strongest RWE contributor; on track for Senior Consultant.",
                final_rating_enabled=True,
            )
            _ar(karan, vikram, "H1 FY25", "completed",
                self_desc_ownership="Completed literature review and data collection tasks as assigned.",
                self_desc_productivity="Maintained consistent research output with improving quality.",
                self_desc_communication="Improved at writing structured research summaries.",
                self_desc_leadership="Learning to participate more actively in team discussions.",
                self_desc_adaptability="Adapted to new literature databases and research tools.",
                self_desc_time_management="Met deadlines with guidance; improving at self-organization.",
                self_stars=3,
                mentor_comment_ownership="Karan is dependable; building initiative for broader ownership.",
                mentor_comment_productivity="Steady output; accuracy has improved significantly.",
                mentor_comment_communication="Good written communication; developing confidence verbally.",
                mentor_comment_leadership="Growing participation in team discussions; needs encouragement.",
                mentor_comment_adaptability="Good at learning new tools and methodologies.",
                mentor_comment_time_management="Consistent with deadlines; improving at proactive planning.",
                mentor_stars=3,
                management_stars=3, final_stars=3,
                management_comments="Karan is a solid Consultant; progressing steadily in RWE domain.",
                final_rating_enabled=True,
            )
            db.commit()

            # ── H2 FY25: Mixed Statuses ───────────────────────────────────
            _ar(arjun, priya, "H2 FY25", "completed",
                self_desc_ownership="Stepped up to manage two modules simultaneously while supporting Neha's growth.",
                self_desc_productivity="Strong output quality with increased independence; introduced team tracking improvements.",
                self_desc_communication="Increasingly confident in stakeholder meetings; leading internal discussions.",
                self_desc_leadership="Mentored Neha and Karan on research methodology and storyboarding.",
                self_desc_adaptability="Handled mid-project scope expansion without disruption.",
                self_desc_time_management="Zero missed deadlines across both modules; proactive risk flagging.",
                self_stars=4,
                mentor_comment_ownership="Arjun consistently exceeded expectations; strong Senior Consultant candidate.",
                mentor_comment_productivity="Exceptional; quality and quantity of outputs both outstanding.",
                mentor_comment_communication="Confident communicator; excellent in stakeholder presentations.",
                mentor_comment_leadership="Strong mentor presence; team looks to him for guidance.",
                mentor_comment_adaptability="Thrives in ambiguity; handles scope changes with maturity.",
                mentor_comment_time_management="Flawless time management; plan-ahead mindset evident.",
                mentor_stars=4,
                management_stars=4, final_stars=4,
                management_comments="Arjun is ready for Senior Consultant; recommend for promotion in the next cycle.",
                final_rating_enabled=True,
            )
            _ar(neha, priya, "H2 FY25", "completed",
                self_desc_ownership="Took on more ownership in H2 with broader research and slide responsibilities.",
                self_desc_productivity="Improved output quality significantly; more independent in task execution.",
                self_desc_communication="More confident in team communications; improving at verbal updates.",
                self_desc_leadership="Starting to support newer team members on basic tasks.",
                self_desc_adaptability="Adapted to new slide formats and client feedback efficiently.",
                self_desc_time_management="Consistently met deadlines; improving at proactive planning.",
                self_stars=4,
                mentor_comment_ownership="Neha showed strong improvement in ownership; growing into the Senior Consultant role.",
                mentor_comment_productivity="Visible improvement in output quality and efficiency.",
                mentor_comment_communication="Good growth in communication; more proactive in team settings.",
                mentor_comment_leadership="Starting to show leadership instincts; supporting junior members.",
                mentor_comment_adaptability="Adaptable to feedback; quick to incorporate improvements.",
                mentor_comment_time_management="Strong improvement in time management independence.",
                mentor_stars=4,
                management_stars=4, final_stars=4,
                management_comments="Neha has shown excellent growth in H2; tracking towards Senior Consultant.",
                final_rating_enabled=True,
            )
            # Rahul: pending_mentor — self-review submitted, awaiting mentor
            _ar(rahul, david, "H2 FY25", "pending_mentor",
                self_desc_ownership="Led architecture decisions and multi-stream delivery with full accountability.",
                self_desc_productivity="Outstanding delivery quality; delivered sprint planning that improved team velocity.",
                self_desc_communication="Executive-level communication; strong clarity in technical explanations.",
                self_desc_leadership="Ran weekly coaching sessions with Meera; strong mentor presence.",
                self_desc_adaptability="Handled major architectural changes mid-project without disruption.",
                self_desc_time_management="Zero delivery misses; managed competing priorities effectively.",
                self_stars=5,
            )
            # Meera: pending_management — mentor has reviewed, awaiting management calibration
            _ar(meera, david, "H2 FY25", "pending_management",
                self_desc_ownership="Took on more complete module ownership in H2 with growing confidence.",
                self_desc_productivity="Improved code quality and delivery speed significantly.",
                self_desc_communication="Better written and verbal communication; more proactive updates.",
                self_desc_leadership="Participating in code reviews; learning from Rahul's coaching.",
                self_desc_adaptability="Adapted to new architectural requirements effectively.",
                self_desc_time_management="Consistently met sprint deadlines; improving at estimation.",
                self_stars=4,
                mentor_comment_ownership="Meera demonstrated significantly improved ownership in H2.",
                mentor_comment_productivity="Strong improvement in code quality and delivery pace.",
                mentor_comment_communication="Good progress; more proactive and structured communications.",
                mentor_comment_leadership="Developing; participating meaningfully in team reviews.",
                mentor_comment_adaptability="Good at adapting to feedback and changing requirements.",
                mentor_comment_time_management="Consistent delivery; improving at self-planning.",
                mentor_stars=4,
            )
            _ar(ananya, vikram, "H2 FY25", "completed",
                self_desc_ownership="Led the cardiology study and cross-functional evidence package with full ownership.",
                self_desc_productivity="Highest-quality scientific outputs; no rework required on key deliverables.",
                self_desc_communication="Strong client presenter; received positive feedback from clinical stakeholders.",
                self_desc_leadership="Mentored Karan and coached strategy team on RWE concepts.",
                self_desc_adaptability="Managed protocol changes and multi-site complexity with maturity.",
                self_desc_time_management="Exceptional multi-project planning; no timeline issues across any workstream.",
                self_stars=5,
                mentor_comment_ownership="Ananya is our most accountable team member; exceptional ownership across projects.",
                mentor_comment_productivity="Outstanding; consistently best-in-class output quality.",
                mentor_comment_communication="Excellent; builds strong client relationships with clear communication.",
                mentor_comment_leadership="Strong mentor and team leader; significantly elevated Karan's capability.",
                mentor_comment_adaptability="Handles complexity with calm and scientific rigor.",
                mentor_comment_time_management="Flawless; manages multiple high-stakes deadlines without issues.",
                mentor_stars=5,
                management_stars=5, final_stars=5,
                management_comments="Ananya is one of our best performers; recommend for Senior Consultant with strong consideration for Manager track.",
                final_rating_enabled=True,
            )
            # Karan: draft — hasn't submitted yet
            _ar(karan, vikram, "H2 FY25", "draft",
                self_desc_ownership="Took on more responsibilities in H2 literature review and data collection tasks.",
                self_desc_productivity="Improving output quality and research depth throughout the cycle.",
            )
            db.commit()

            # ── H1 FY26 (Current): Some In Progress ──────────────────────
            # Neha: pending_mentor — submitted self-review
            _ar(neha, priya, "H1 FY26", "pending_mentor",
                self_desc_ownership="Taking on broader ownership with more independent project management in H1 FY26.",
                self_desc_productivity="Strong output quality; introducing process improvements in slide workflow.",
                self_desc_communication="Leading more client-facing communications; confident in stakeholder meetings.",
                self_desc_leadership="Actively mentoring junior researchers on the team.",
                self_desc_adaptability="Adapting well to complex cross-functional project demands.",
                self_desc_time_management="Proactive planning and timeline management across multiple projects.",
                self_stars=4,
            )
            # Arjun + Rahul: draft — self-review started but not submitted
            _ar(arjun, priya, "H1 FY26", "draft",
                self_desc_ownership="Leading multiple market access modules with full ownership in H1 FY26.",
                self_desc_productivity="High output quality with increased strategic depth across deliverables.",
            )
            _ar(rahul, david, "H1 FY26", "draft",
                self_desc_ownership="Owning the platform architecture evolution with cross-team coordination.",
                self_desc_productivity="Strong delivery across multiple technical workstreams simultaneously.",
            )
            db.commit()

            print("  [+] Created Annual Reviews: H1 FY25 (all completed), H2 FY25 (mixed), H1 FY26 (in-progress)")
        else:
            print("  [~] Healthark Annual Reviews already exist, skipping...")


        # ================================================================== #
        # 10. GOALS                                                           #
        # ================================================================== #

        def _goal(user, manager, title, desc, approval, progress_notes=None, goal_type="yearly"):
            db.add(Goal(
                org_id=org.id, user_id=user.id,
                manager_id=manager.id if manager else None,
                title=title, description=desc,
                goal_type=goal_type,
                approval_status=approval,
                progress_notes=progress_notes,
            ))

        if db.query(Goal).filter(Goal.org_id == org.id).count() == 0:

            # H1 FY25 — all completed / approved
            _goal(arjun, priya, "Complete EU Market Access Framework for Oncology",
                "Develop a comprehensive market access framework covering 5 EU markets for the oncology product launch.",
                "approved",
                progress_notes="Framework completed and presented to client. Positive feedback received. All 5 markets covered.",
            )
            _goal(arjun, priya, "Upskill in Healthcare Financial Modeling",
                "Complete a structured financial modeling course and apply learnings to an active project.",
                "approved",
                progress_notes="Completed course and built a bottom-up forecast model applied to PRJ-001.",
            )
            _goal(neha, priya, "Independently Lead a Research Module",
                "Own and deliver a complete research module on a live project with minimal supervision.",
                "approved",
                progress_notes="Led competitive landscape module on PRJ-001. Delivered on time with positive feedback.",
            )
            _goal(rahul, david, "Build End-to-End Patient Analytics Pipeline",
                "Design, build, and deploy a production-ready patient journey analytics pipeline for the client dashboard.",
                "approved",
                progress_notes="Pipeline deployed to production. Dashboard live and used by client. Zero critical bugs reported.",
            )
            _goal(rahul, david, "Mentor Meera on Data Engineering Fundamentals",
                "Run bi-weekly coaching sessions with Meera to build her data engineering capability.",
                "approved",
                progress_notes="Ran 8 coaching sessions. Meera independently completed her first data module in H1 FY25.",
            )
            _goal(meera, david, "Complete First Independent Data Analysis Module",
                "Independently own a data analysis module on an active project end-to-end.",
                "approved",
                progress_notes="Completed the data cleansing and visualization module for PRJ-002 with minimal guidance.",
            )
            _goal(ananya, vikram, "Design Cardiovascular Outcomes Study Protocol",
                "Lead the design and documentation of the RWE study protocol for the cardiology outcomes study.",
                "approved",
                progress_notes="Protocol designed and submitted to client. IRB approved. Study launched.",
            )
            _goal(karan, vikram, "Build Literature Review Competency in Cardiovascular RWE",
                "Conduct structured literature reviews and synthesize findings for the cardiology outcomes study.",
                "approved",
                progress_notes="Completed systematic review of 150+ papers. Summary integrated into study protocol.",
            )
            db.commit()

            # H2 FY25 — mix of completed and in-progress
            _goal(arjun, priya, "Lead Cross-Functional Coordination for Oncology Evidence Package",
                "Own cross-team coordination across strategy, IDT, and RWE workstreams for the integrated evidence package.",
                "approved",
                progress_notes="Led weekly cross-functional sync. Shared tracker adopted by all three teams.",
            )
            _goal(arjun, priya, "Develop Senior-Level Storyboarding Skills",
                "Independently craft full client deck storyboards with compelling narratives and minimal review rounds.",
                "approved",
                progress_notes="Led storyboarding for 2 major client decks. Both approved in first client review.",
            )
            _goal(neha, priya, "Drive Client Communication on a Live Project",
                "Lead at least 2 client update calls and draft client communications independently.",
                "approved",
                progress_notes="Led 1 client call so far; preparing for the second. Feedback from Priya was positive.",
            )
            _goal(rahul, david, "Lead Technical Architecture for Platform Expansion",
                "Define and implement the expanded architecture for the patient analytics platform.",
                "approved",
                progress_notes="Architecture approved by Architecture Review Board. Delivered 2 weeks ahead of schedule.",
            )
            _goal(meera, david, "Own Full Feature Development End-to-End",
                "Take end-to-end ownership of a feature from design to production deployment.",
                "approved",
                progress_notes="Feature in final testing phase. Deployment planned for next sprint.",
            )
            _goal(ananya, vikram, "Publish RWE Study Interim Results",
                "Prepare and submit interim results from the cardiology outcomes study for internal review.",
                "approved",
                progress_notes="Interim analysis completed. Report approved for internal publication.",
            )
            _goal(karan, vikram, "Manage Data Collection Across Clinical Sites",
                "Own the data collection coordination across 4 clinical sites for the outcomes study.",
                "approved",
                progress_notes="3 of 4 sites completed. Final site data expected next month.",
            )
            db.commit()

            # H1 FY26 (current) — approved / submitted / draft
            _goal(arjun, priya, "Take PM-Level Ownership on Integrated Evidence Package",
                "Step into a PM-equivalent role on PRJ-004 with full accountability for delivery and client communication.",
                "approved",
                progress_notes="Managing project tracker and client communications independently. On track.",
            )
            _goal(arjun, priya, "Build Proposal Development Capability",
                "Lead or co-lead at least one client proposal in H1 FY26.",
                "submitted",
            )
            _goal(neha, priya, "Lead a Complete Client Workstream Independently",
                "Own end-to-end delivery of a client workstream with minimal supervision.",
                "approved",
                progress_notes="Leading the competitor benchmarking workstream independently.",
            )
            _goal(rahul, david, "Introduce Agile Delivery Framework to IDT Practice",
                "Design and roll out an Agile sprint framework for the IDT team that improves delivery predictability.",
                "approved",
                progress_notes="Sprint framework piloted. Team velocity improvement measured at ~25%.",
            )
            _goal(meera, david, "Independently Deliver a Complete Analytics Module",
                "Deliver a complete analytics module from requirements gathering to client handoff.",
                "submitted",
            )
            _goal(ananya, vikram, "Present at Firm-Wide RWE Knowledge Session",
                "Organize and present a knowledge session on cardiovascular RWE best practices for the firm.",
                "approved",
                progress_notes="Session scheduled. Presentation deck 80% complete.",
            )
            _goal(karan, vikram, "Complete Statistical Analysis for Cardiology Outcomes Study",
                "Own the complete statistical analysis for the cardiology outcomes study in H1 FY26.",
                "draft",
            )
            db.commit()

            print("  [+] Created Goals: H1 FY25 (completed), H2 FY25 (mixed), H1 FY26 (current)")
        else:
            print("  [~] Healthark Goals already exist, skipping...")


        # ================================================================== #
        # DONE                                                                #
        # ================================================================== #

        print("\n" + "=" * 60)
        print("Database seeding completed successfully!")
        print("=" * 60)
        print("\n--- HEALTHARK Accounts (all passwords: password123) ---")
        print("  ADMIN:    admin@healthark.com    Sarah Admin     (Admin)")
        print("  STRATEGY: priya@healthark.com    Priya Sharma    (Staff - functions as Manager) - PM on PRJ-001, PRJ-004")
        print("            arjun@healthark.com    Arjun Patel     (Staff)   - mentor: Priya")
        print("  IDT:      david@healthark.com    David Miller    (Staff - functions as Manager) - PM on PRJ-002")
        print("            rahul@healthark.com    Rahul Verma     (Staff)   - mentor: David")
        print("  RWE:      vikram@healthark.com   Vikram Singh    (Staff - functions as Manager) - PM on PRJ-003")
        print("            ananya@healthark.com   Ananya Reddy    (Staff)   - mentor: Vikram")
        print()
        print("--- MILTENYI Accounts (Quarterly Cycle | all passwords: password123) ---")
        print("  ADMIN:    admin@miltenyi.com     Alice Admin     (Admin)")
        print("  R&D:      bob@miltenyi.com       Bob Builder     (Staff - functions as Manager) - PM on MIL-PRJ-001")
        print("            charlie@miltenyi.com   Charlie Chemist (Staff)   - mentor: Bob")
        print("            dana@miltenyi.com      Dana DNA        (Staff)   - mentor: Bob")
        print("  MFG:      evan@miltenyi.com      Evan Engineer   (Staff - functions as Manager) - PM on MIL-PRJ-002")
        print("            fiona@miltenyi.com     Fiona Factory   (Staff)   - mentor: Evan")
        print()

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()