from app.core.database import SessionLocal
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.project_models import Project, ProjectAssignment
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