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

        partner_org = db.query(Organization).filter(Organization.name == "Partner Org").first()
        if not partner_org:
            partner_org = Organization(
                name="Partner Org",
                domain="partnerorg.com",
                enabled_features=["dashboard", "project_reviews", "admin"],
            )
            db.add(partner_org)
            db.commit()
            db.refresh(partner_org)
            print("  [+] Created Organization: Partner Org (restricted suite)")
        else:
            print("  [~] Organization 'Partner Org' already exists, skipping...")

        # ================================================================== #
        # 2. DEPARTMENTS & DESIGNATIONS                                       #
        # ================================================================== #

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
            print("  [+] Created Departments (Strategy, IDT, RWE, Marketing)")
            print("  [+] Created Designations (Consultant -> Director)")
        else:
            print("  [~] Reference data already exists, skipping...")

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

        admin_user = db.query(User).filter(User.org_id == org.id, User.email == "admin@healthark.com").first()

        if not admin_user:
            pw = get_password_hash("password123")

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
            print("  [+] Created: admin@healthark.com (Admin, Director, Marketing)")

            priya = User(
                org_id=org.id,
                department_id=dept_strategy.id,
                designation_id=desig_senior_manager.id,
                employee_code="EMP-101",
                full_name="Priya Sharma",
                email="priya@healthark.com",
                role="Manager",
                password_hash=pw,
            )
            db.add(priya)
            db.commit()
            db.refresh(priya)
            print("  [+] Created: priya@healthark.com (Manager, Senior Manager, Strategy)")

            arjun = User(
                org_id=org.id,
                department_id=dept_strategy.id,
                designation_id=desig_senior_consultant.id,
                employee_code="EMP-102",
                full_name="Arjun Patel",
                email="arjun@healthark.com",
                role="Staff",
                mentor_id=priya.id,
                password_hash=pw,
            )
            db.add(arjun)
            db.commit()
            db.refresh(arjun)
            print("  [+] Created: arjun@healthark.com (Staff, Senior Consultant, Strategy)")

            neha = User(
                org_id=org.id,
                department_id=dept_strategy.id,
                designation_id=desig_consultant.id,
                employee_code="EMP-103",
                full_name="Neha Gupta",
                email="neha@healthark.com",
                role="Staff",
                mentor_id=priya.id,
                password_hash=pw,
            )
            db.add(neha)
            db.commit()
            db.refresh(neha)
            print("  [+] Created: neha@healthark.com (Staff, Consultant, Strategy)")

            david = User(
                org_id=org.id,
                department_id=dept_idt.id,
                designation_id=desig_manager.id,
                employee_code="EMP-201",
                full_name="David Miller",
                email="david@healthark.com",
                role="Manager",
                password_hash=pw,
            )
            db.add(david)
            db.commit()
            db.refresh(david)
            print("  [+] Created: david@healthark.com (Manager, Manager, IDT)")

            rahul = User(
                org_id=org.id,
                department_id=dept_idt.id,
                designation_id=desig_senior_consultant.id,
                employee_code="EMP-202",
                full_name="Rahul Verma",
                email="rahul@healthark.com",
                role="Staff",
                mentor_id=david.id,
                password_hash=pw,
            )
            db.add(rahul)
            db.commit()
            db.refresh(rahul)
            print("  [+] Created: rahul@healthark.com (Staff, Senior Consultant, IDT)")

            meera = User(
                org_id=org.id,
                department_id=dept_idt.id,
                designation_id=desig_consultant.id,
                employee_code="EMP-203",
                full_name="Meera Joshi",
                email="meera@healthark.com",
                role="Staff",
                mentor_id=david.id,
                password_hash=pw,
            )
            db.add(meera)
            db.commit()
            db.refresh(meera)
            print("  [+] Created: meera@healthark.com (Staff, Consultant, IDT)")

            vikram = User(
                org_id=org.id,
                department_id=dept_rwe.id,
                designation_id=desig_manager.id,
                employee_code="EMP-301",
                full_name="Vikram Singh",
                email="vikram@healthark.com",
                role="Manager",
                password_hash=pw,
            )
            db.add(vikram)
            db.commit()
            db.refresh(vikram)
            print("  [+] Created: vikram@healthark.com (Manager, Manager, RWE)")

            ananya = User(
                org_id=org.id,
                department_id=dept_rwe.id,
                designation_id=desig_senior_consultant.id,
                employee_code="EMP-302",
                full_name="Ananya Reddy",
                email="ananya@healthark.com",
                role="Staff",
                mentor_id=vikram.id,
                password_hash=pw,
            )
            db.add(ananya)
            db.commit()
            db.refresh(ananya)
            print("  [+] Created: ananya@healthark.com (Staff, Senior Consultant, RWE)")

            karan = User(
                org_id=org.id,
                department_id=dept_rwe.id,
                designation_id=desig_consultant.id,
                employee_code="EMP-303",
                full_name="Karan Mehta",
                email="karan@healthark.com",
                role="Staff",
                mentor_id=vikram.id,
                password_hash=pw,
            )
            db.add(karan)
            db.commit()
            db.refresh(karan)
            print("  [+] Created: karan@healthark.com (Staff, Consultant, RWE)")

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
        # 4. PARTNER ORG USERS                                                #
        # ================================================================== #

        if db.query(User).filter(User.org_id == partner_org.id).count() == 0:
            partner_dept  = Department(org_id=partner_org.id, name="Operations")
            partner_desig = Designation(org_id=partner_org.id, name="Analyst", level=1)
            db.add_all([partner_dept, partner_desig])
            db.commit()

            alice = User(
                org_id=partner_org.id,
                department_id=partner_dept.id,
                designation_id=partner_desig.id,
                employee_code="PRT-001",
                full_name="Alice Partner",
                email="alice@partnerorg.com",
                role="Admin",
                password_hash=get_password_hash("password123"),
            )
            db.add(alice)
            db.commit()
            print("  [+] Created Partner Org user: alice@partnerorg.com")
        else:
            print("  [~] Partner Org users already exist, skipping...")

        # ================================================================== #
        # 5. SYSTEM SETTINGS                                                  #
        # ================================================================== #

        if not db.query(SystemSettings).filter(SystemSettings.org_id == org.id).first():
            db.add(SystemSettings(
                org_id=org.id,
                active_cycle_name="H1 FY26",
                cycle_type=CycleType.HALF_YEARLY.value,
                goals_submission_open=True,
                reviews_submission_open=True,
                updated_by_id=admin_user.id,
            ))
            db.commit()
            print("  [+] Created System Settings for Healthark (H1 FY26)")
        else:
            print("  [~] Healthark system settings already exist, skipping...")

        if not db.query(SystemSettings).filter(SystemSettings.org_id == partner_org.id).first():
            db.add(SystemSettings(
                org_id=partner_org.id,
                active_cycle_name="H1 FY26",
                cycle_type=CycleType.HALF_YEARLY.value,
                goals_submission_open=True,
                reviews_submission_open=False,
            ))
            db.commit()
            print("  [+] Created System Settings for Partner Org (H1 FY26)")
        else:
            print("  [~] Partner Org system settings already exist, skipping...")

        # ================================================================== #
        # 6. SAMPLE PROJECTS + ASSIGNMENTS                                    #
        # ================================================================== #

        if db.query(Project).filter(Project.org_id == org.id).count() == 0 and priya and david and vikram:

            proj_ma = Project(
                org_id=org.id,
                project_code="PRJ-001",
                name="Market Access Strategy H1",
                description="Develop market access strategy for oncology portfolio across 5 EU markets.",
                start_date=date(2025, 1, 15),
                expected_end_date=date(2025, 6, 30),
                reports_to_id=admin_user.id,
            )
            db.add(proj_ma)
            db.flush()

            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_ma.id, user_id=priya.id,
                assignment_role=desig_senior_manager.name, department_id=dept_strategy.id,
                evaluator_type="Primary", assigned_date=date(2025, 1, 15),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_ma.id, user_id=arjun.id,
                assignment_role=desig_senior_consultant.name, department_id=dept_strategy.id,
                evaluator_type=None, assigned_date=date(2025, 1, 15),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_ma.id, user_id=neha.id,
                assignment_role=desig_consultant.name, department_id=dept_strategy.id,
                evaluator_type=None, assigned_date=date(2025, 2, 1),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_ma.id, user_id=david.id,
                assignment_role=desig_manager.name, department_id=dept_idt.id,
                evaluator_type="Secondary", assigned_date=date(2025, 1, 15),
            ))

            db.commit()
            print("  [+] Created Project: PRJ-001 Market Access Strategy H1 (PM: Priya)")

            proj_idt = Project(
                org_id=org.id,
                project_code="PRJ-002",
                name="Patient Journey Analytics Platform",
                description="Build a data analytics dashboard for real-world patient journey mapping.",
                start_date=date(2025, 2, 1),
                expected_end_date=date(2025, 8, 31),
                reports_to_id=admin_user.id,
            )
            db.add(proj_idt)
            db.flush()

            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_idt.id, user_id=david.id,
                assignment_role=desig_manager.name, department_id=dept_idt.id,
                evaluator_type="Primary", assigned_date=date(2025, 2, 1),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_idt.id, user_id=rahul.id,
                assignment_role=desig_senior_consultant.name, department_id=dept_idt.id,
                evaluator_type=None, assigned_date=date(2025, 2, 1),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_idt.id, user_id=meera.id,
                assignment_role=desig_consultant.name, department_id=dept_idt.id,
                evaluator_type=None, assigned_date=date(2025, 2, 15),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_idt.id, user_id=vikram.id,
                assignment_role=desig_manager.name, department_id=dept_rwe.id,
                evaluator_type="Secondary", assigned_date=date(2025, 2, 1),
            ))

            db.commit()
            print("  [+] Created Project: PRJ-002 Patient Journey Analytics (PM: David)")

            proj_rwe = Project(
                org_id=org.id,
                project_code="PRJ-003",
                name="RWE Outcomes Study - Cardiology",
                description="Design and execute a real-world evidence study for cardiovascular outcomes.",
                start_date=date(2025, 3, 1),
                expected_end_date=date(2025, 12, 31),
                reports_to_id=priya.id,
            )
            db.add(proj_rwe)
            db.flush()

            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_rwe.id, user_id=vikram.id,
                assignment_role=desig_manager.name, department_id=dept_rwe.id,
                evaluator_type="Primary", assigned_date=date(2025, 3, 1),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_rwe.id, user_id=ananya.id,
                assignment_role=desig_senior_consultant.name, department_id=dept_rwe.id,
                evaluator_type=None, assigned_date=date(2025, 3, 1),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_rwe.id, user_id=karan.id,
                assignment_role=desig_consultant.name, department_id=dept_rwe.id,
                evaluator_type=None, assigned_date=date(2025, 3, 15),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_rwe.id, user_id=arjun.id,
                assignment_role="Lead Analyst",
                department_id=dept_strategy.id,
                evaluator_type=None, assigned_date=date(2025, 4, 1),
            ))

            db.commit()
            print("  [+] Created Project: PRJ-003 RWE Outcomes Study (PM: Vikram)")

            proj_cross = Project(
                org_id=org.id,
                project_code="PRJ-004",
                name="Integrated Evidence Package - Oncology",
                description="Cross-functional deliverable combining strategy, IDT analytics, and RWE data for an oncology product launch.",
                start_date=date(2025, 4, 1),
                expected_end_date=date(2025, 9, 30),
                reports_to_id=admin_user.id,
            )
            db.add(proj_cross)
            db.flush()

            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_cross.id, user_id=priya.id,
                assignment_role=desig_senior_manager.name, department_id=dept_strategy.id,
                evaluator_type="Primary", assigned_date=date(2025, 4, 1),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_cross.id, user_id=rahul.id,
                assignment_role="Data Lead",
                department_id=dept_idt.id,
                evaluator_type=None, assigned_date=date(2025, 4, 1),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_cross.id, user_id=ananya.id,
                assignment_role="RWE Lead",
                department_id=dept_rwe.id,
                evaluator_type=None, assigned_date=date(2025, 4, 1),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_cross.id, user_id=neha.id,
                assignment_role=desig_consultant.name, department_id=dept_strategy.id,
                evaluator_type=None, assigned_date=date(2025, 4, 15),
            ))
            db.add(ProjectAssignment(
                org_id=org.id, project_id=proj_cross.id, user_id=vikram.id,
                assignment_role=desig_manager.name, department_id=dept_rwe.id,
                evaluator_type="Secondary", assigned_date=date(2025, 4, 1),
            ))

            db.commit()
            print("  [+] Created Project: PRJ-004 Integrated Evidence Package (PM: Priya)")

        else:
            print("  [~] Projects already exist or users missing, skipping...")

        # ================================================================== #
        # 7. ROLE EXPECTATIONS (Placeholder)                                  #
        # ================================================================== #

        if db.query(RoleExpectation).filter(RoleExpectation.org_id == org.id).count() == 0:
            core_depts = [dept_strategy, dept_idt, dept_rwe]
            core_desigs = [desig_consultant, desig_senior_consultant, desig_manager]

            if all(d is not None for d in core_depts) and all(d is not None for d in core_desigs):
                for dept in core_depts:
                    for desig in core_desigs:
                        db.add(RoleExpectation(
                            org_id=org.id,
                            department_id=dept.id,
                            designation_id=desig.id,
                            exp_task_execution=f"[{dept.name} / {desig.name}] Task Execution expectations to be filled.",
                            exp_ownership=f"[{dept.name} / {desig.name}] Ownership expectations to be filled.",
                            exp_project_management=f"[{dept.name} / {desig.name}] Project Management expectations to be filled.",
                            exp_client_deliverables=f"[{dept.name} / {desig.name}] Client Deliverables expectations to be filled.",
                            exp_communication=f"[{dept.name} / {desig.name}] Communication expectations to be filled.",
                            exp_mentoring=f"[{dept.name} / {desig.name}] Mentoring expectations to be filled.",
                            exp_competency_skills=f"[{dept.name} / {desig.name}] Competency & Skills expectations to be filled.",
                        ))
                db.commit()
                print("  [+] Created 9 Role Expectation rows (placeholder)")
            else:
                print("  [!] Some departments/designations missing, skipping role expectations...")
        else:
            print("  [~] Role expectations already exist, skipping...")

        # ================================================================== #
        # DONE                                                                #
        # ================================================================== #

        print("\n" + "=" * 60)
        print("Database seeding completed successfully!")
        print("=" * 60)
        print("\n--- Test Accounts (all passwords: password123) ---")
        print()
        print("  ADMIN:")
        print("    admin@healthark.com    Sarah Admin     (Admin, Director, Marketing)")
        print()
        print("  STRATEGY DEPARTMENT:")
        print("    priya@healthark.com    Priya Sharma    (Manager, Senior Manager)  - PM on PRJ-001, PRJ-004")
        print("    arjun@healthark.com    Arjun Patel     (Staff, Senior Consultant) - mentor: Priya")
        print("    neha@healthark.com     Neha Gupta      (Staff, Consultant)        - mentor: Priya")
        print()
        print("  IDT DEPARTMENT:")
        print("    david@healthark.com    David Miller    (Manager, Manager)         - PM on PRJ-002")
        print("    rahul@healthark.com    Rahul Verma     (Staff, Senior Consultant) - mentor: David")
        print("    meera@healthark.com    Meera Joshi     (Staff, Consultant)        - mentor: David")
        print()
        print("  RWE DEPARTMENT:")
        print("    vikram@healthark.com   Vikram Singh    (Manager, Manager)         - PM on PRJ-003")
        print("    ananya@healthark.com   Ananya Reddy    (Staff, Senior Consultant) - mentor: Vikram")
        print("    karan@healthark.com    Karan Mehta     (Staff, Consultant)        - mentor: Vikram")
        print()
        print("  PARTNER ORG:")
        print("    alice@partnerorg.com   Alice Partner   (Admin)                    - restricted features")
        print()
        print("--- Projects ---")
        print("  PRJ-001  Market Access Strategy H1          PM: Priya   reports to: Sarah")
        print("  PRJ-002  Patient Journey Analytics          PM: David   reports to: Sarah")
        print("  PRJ-003  RWE Outcomes Study - Cardiology    PM: Vikram  reports to: Priya")
        print("  PRJ-004  Integrated Evidence Package        PM: Priya   reports to: Sarah")

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()