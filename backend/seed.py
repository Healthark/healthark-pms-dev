from app.core.database import SessionLocal
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.core.security import get_password_hash


def seed_database():
    print("Starting database seeding process...")
    db = SessionLocal()

    try:
        # ------------------------------------------------------------------ #
        # 1. ORGANIZATIONS                                                    #
        # ------------------------------------------------------------------ #

        # --- Healthark (Full feature suite) ---
        org = db.query(Organization).filter(Organization.name == "Healthark").first()
        if not org:
            org = Organization(
                name="Healthark",
                domain="healthark.com",
                enabled_features=[
                    "dashboard",
                    "goals",
                    "project_reviews",
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

        # --- Partner Org (Restricted suite — used to test feature-gate blocking) ---
        partner_org = db.query(Organization).filter(Organization.name == "Partner Org").first()
        if not partner_org:
            partner_org = Organization(
                name="Partner Org",
                domain="partnerorg.com",
                enabled_features=["dashboard", "goals"],  # No reviews, mentoring, or admin
            )
            db.add(partner_org)
            db.commit()
            db.refresh(partner_org)
            print("  [+] Created Organization: Partner Org (restricted suite)")
        else:
            print("  [~] Organization 'Partner Org' already exists, skipping...")

        # ------------------------------------------------------------------ #
        # 2. DEPARTMENTS & DESIGNATIONS (Healthark only)                     #
        # ------------------------------------------------------------------ #

        if db.query(Department).filter(Department.org_id == org.id).count() == 0:
            dept_marketing  = Department(org_id=org.id, name="Marketing")
            dept_idt        = Department(org_id=org.id, name="IDT")
            dept_strategy   = Department(org_id=org.id, name="Strategy")

            desig_consultant          = Designation(org_id=org.id, name="Consultant",           level=1)
            desig_senior_consultant   = Designation(org_id=org.id, name="Senior Consultant",    level=2)
            desig_manager             = Designation(org_id=org.id, name="Manager",              level=3)
            desig_senior_manager      = Designation(org_id=org.id, name="Senior Manager",       level=4)
            desig_associate_director  = Designation(org_id=org.id, name="Associate Director",   level=5)
            desig_director            = Designation(org_id=org.id, name="Director",             level=6)
            desig_senior_data_analyst = Designation(org_id=org.id, name="Senior Data Analyst",  level=7)
            desig_data_analyst        = Designation(org_id=org.id, name="Data Analyst",         level=8)
            desig_junior_data_analyst = Designation(org_id=org.id, name="Junior Data Analyst",  level=9)

            db.add_all([
                dept_marketing, dept_idt, dept_strategy,
                desig_consultant, desig_senior_consultant, desig_manager,
                desig_senior_manager, desig_associate_director, desig_director,
                desig_senior_data_analyst, desig_data_analyst, desig_junior_data_analyst,
            ])
            db.commit()
            print("  [+] Created Departments & Designations for Healthark")
        else:
            print("  [~] Reference data already exists, skipping...")

        # ------------------------------------------------------------------ #
        # 3. USERS                                                            #
        # ------------------------------------------------------------------ #

        if db.query(User).filter(User.org_id == org.id).count() == 0:
            dept_marketing            = db.query(Department).filter_by(name="Marketing").first()
            desig_director            = db.query(Designation).filter_by(name="Director").first()
            desig_manager             = db.query(Designation).filter_by(name="Manager").first()
            desig_junior_data_analyst = db.query(Designation).filter_by(name="Junior Data Analyst").first()

            # -- Admin (Story 1.3 testing: has 'admin' feature + Admin role) --
            admin_user = User(
                org_id=org.id,
                department_id=dept_marketing.id,
                designation_id=desig_director.id,
                employee_code="EMP-000",
                full_name="Sarah Admin",
                email="admin@healthark.com",
                role="Admin",
                password_hash=get_password_hash("password123"),
            )
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
            print("  [+] Created Admin user: admin@healthark.com")

            # -- Mentor / Manager --
            mentor = User(
                org_id=org.id,
                department_id=dept_marketing.id,
                designation_id=desig_director.id,
                employee_code="EMP-001",
                full_name="David Miller",
                email="david@healthark.com",
                role="Manager",
                password_hash=get_password_hash("password123"),
            )
            db.add(mentor)
            db.commit()
            db.refresh(mentor)
            print("  [+] Created Manager user: david@healthark.com")

            # -- Mentee / Staff — linked to David --
            mentee = User(
                org_id=org.id,
                department_id=dept_marketing.id,
                designation_id=desig_junior_data_analyst.id,
                employee_code="EMP-002",
                full_name="Rahul",
                email="rahul@healthark.com",
                role="Staff",
                mentor_id=mentor.id,
                password_hash=get_password_hash("password123"),
            )
            db.add(mentee)
            db.commit()
            print("  [+] Created Staff user: rahul@healthark.com (mentor → David)")
        else:
            print("  [~] Healthark users already exist, skipping...")

        # ------------------------------------------------------------------ #
        # 4. PARTNER ORG USERS (Feature-gate smoke test accounts)            #
        # ------------------------------------------------------------------ #

        if db.query(User).filter(User.org_id == partner_org.id).count() == 0:
            # Partner Org needs its own dept/desig rows because of org_id scoping
            partner_dept  = Department(org_id=partner_org.id, name="Operations")
            partner_desig = Designation(org_id=partner_org.id, name="Analyst", level=1)
            db.add_all([partner_dept, partner_desig])
            db.commit()

            partner_user = User(
                org_id=partner_org.id,
                department_id=partner_dept.id,
                designation_id=partner_desig.id,
                employee_code="PRT-001",
                full_name="Alice Partner",
                email="alice@partnerorg.com",
                role="Staff",
                password_hash=get_password_hash("password123"),
            )
            db.add(partner_user)
            db.commit()
            print("  [+] Created Partner Org user: alice@partnerorg.com")
        else:
            print("  [~] Partner Org users already exist, skipping...")

        print("\nDatabase seeding completed successfully!")
        print("\n--- Test Accounts ---")
        print("  admin@healthark.com  / password123  (Admin   — all features)")
        print("  david@healthark.com  / password123  (Manager — all features)")
        print("  rahul@healthark.com  / password123  (Staff   — all features)")
        print("  alice@partnerorg.com / password123  (Staff   — dashboard + goals only)")

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()