"""
generate_seed_json.py
---------------------
Reads  backend/final_seed_data/Final Seed Data.xlsx  and emits two JSON files
in the same directory:
  users.json              — one entry per unique person (107 users)
  departments_roles.json  — departments + designations (only those in use)
Run from the backend/ directory:
    python final_seed_data/generate_seed_json.py
"""
import json
import os
import sys
import openpyxl
# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
EXCEL_PATH = os.path.join(os.path.dirname(__file__), "Final Seed Data.xlsx")
OUT_DIR    = os.path.dirname(__file__)
ADMIN_MANAGEMENT_EMAILS = {
    "amol@healtharkinsights.com",
    "drpuravgandhi@healtharkinsights.com",
    "ski@healtharkinsights.com",
}
# Roles that exist in All_Users but are missing from the Roles sheet,
# with manually confirmed levels.
EXTRA_ROLES = {
    ("Information Data Technology (IDT)", "Senior Test Engineer"):  3,
    ("Information Data Technology (IDT)", "Test Automation Lead"):  4,
    ("Information Data Technology (IDT)", "Test Engineer"):         2,
    ("Real-World Evidence (RWE)", "Principal GRC Consultant"):      5,
    ("Real-World Evidence (RWE)", "Project Manager"):               3,
    ("Real-World Evidence (RWE)", "Senior Consultant"):             2,
    ("Real-World Evidence (RWE)", "Senior Data Analyst"):           3,
}
# Staff Augmentation is not in the Departments sheet but is used in Mentor_Mapping
EXTRA_DEPARTMENTS = ["Staff Augmentation"]
# ---------------------------------------------------------------------------
# Load workbook
# ---------------------------------------------------------------------------
wb = openpyxl.load_workbook(EXCEL_PATH)
def sheet_rows(name):
    ws = wb[name]
    rows = list(ws.iter_rows(values_only=True))
    return rows[0], rows[1:]   # header, data
# ---------------------------------------------------------------------------
# 1. Build look-ups from All_Users
# ---------------------------------------------------------------------------
_, user_data_rows = sheet_rows("All_Users")
# Columns: Employee Code, Full Name, Email, Phone, Department, Role, Employment Status, Exit Date
all_users_by_email = {}
for r in user_data_rows:
    email = r[2]
    if email:
        all_users_by_email[email.strip().lower()] = {
            "employee_code": str(r[0]).strip() if r[0] else None,
            "full_name":     str(r[1]).strip() if r[1] else None,
            "email":         email.strip().lower(),
            "phone":         str(r[3]).strip() if r[3] else None,
            "department":    str(r[4]).strip() if r[4] else None,
            "role":          str(r[5]).strip() if r[5] else None,
        }
# ---------------------------------------------------------------------------
# 2. Build mentor mapping + determine active set from Mentor_Mapping
# ---------------------------------------------------------------------------
_, mentor_data_rows = sheet_rows("Mentor_Mapping")
# Columns: Department, Employee Name, Employee Email, Mentor Name, Mentor Email
mentor_of      = {}   # emp_email  -> mentor_email
dept_override  = {}   # emp_email  -> department (from Mentor_Mapping, most authoritative)
all_needed_emails: set[str] = set()
seen_emp_emails: set[str] = set()
for r in mentor_data_rows:
    emp_email    = r[2].strip().lower() if r[2] else None
    mentor_email = r[4].strip().lower() if r[4] else None
    dept         = str(r[0]).strip()    if r[0] else None
    if emp_email:
        if emp_email not in seen_emp_emails:
            seen_emp_emails.add(emp_email)
            mentor_of[emp_email]     = mentor_email
            dept_override[emp_email] = dept
        all_needed_emails.add(emp_email)
    if mentor_email:
        all_needed_emails.add(mentor_email)
# Mentors who only appear as a mentor (not as an employee row) keep their
# All_Users department since Mentor_Mapping doesn't have a row for them.
# ---------------------------------------------------------------------------
# 3. Build the active Roles look-up (Roles sheet + extras)
# ---------------------------------------------------------------------------
_, roles_data_rows = sheet_rows("Roles")
# Columns: Department, Role, Level
roles_level: dict[tuple, int | None] = {}
for r in roles_data_rows:
    dept = str(r[0]).strip() if r[0] else None
    role = str(r[1]).strip() if r[1] else None
    lvl  = int(r[2]) if r[2] and str(r[2]).isdigit() else (r[2] if r[2] else None)
    if dept and role:
        roles_level[(dept, role)] = lvl
# Merge extra roles
for (dept, role), lvl in EXTRA_ROLES.items():
    roles_level[(dept, role)] = lvl
# Fix Partner level (was NULL) -> 6
if ("Strategy Consulting", "Partner") in roles_level:
    roles_level[("Strategy Consulting", "Partner")] = 6
# ---------------------------------------------------------------------------
# 4. Collect the USED (dept, role) pairs from the 107 active users
# ---------------------------------------------------------------------------
used_dept_role: set[tuple] = set()
used_depts:     set[str]   = set()
for email in all_needed_emails:
    u = all_users_by_email.get(email)
    if not u:
        continue
    # Use Mentor_Mapping dept if available (more authoritative), else All_Users
    dept = dept_override.get(email, u["department"])
    role = u["role"]
    if dept:
        used_depts.add(dept)
    if dept and role:
        used_dept_role.add((dept, role))
# Also add Staff Augmentation explicitly (it appears in Mentor_Mapping)
for extra in EXTRA_DEPARTMENTS:
    used_depts.add(extra)
# ---------------------------------------------------------------------------
# 5. Build departments_roles.json
# ---------------------------------------------------------------------------
departments_list = sorted(used_depts)
designations_list = []
for (dept, role) in sorted(used_dept_role):
    lvl = roles_level.get((dept, role))
    # For Staff Augmentation, the Roles sheet has no entries, so look up the
    # same role name in other departments to borrow its canonical level.
    if lvl is None and dept == "Staff Augmentation":
        for (d2, r2), l2 in roles_level.items():
            if r2 == role and d2 != "Staff Augmentation" and l2 is not None:
                lvl = l2
                break
    # Final fallback
    if lvl is None:
        lvl = 1
    designations_list.append({
        "department": dept,
        "name":       role,
        "level":      lvl,
    })
departments_roles_json = {
    "departments": [{"name": d} for d in departments_list],
    "designations": designations_list,
}
# ---------------------------------------------------------------------------
# 6. Build users.json
# ---------------------------------------------------------------------------
users_list = []
for email in sorted(all_needed_emails):
    u = all_users_by_email.get(email)
    if not u:
        print(f"  WARNING: {email} not found in All_Users — skipping", file=sys.stderr)
        continue
    # Department: Mentor_Mapping is authoritative for employees; All_Users for mentors
    dept = dept_override.get(email, u["department"])
    is_admin_mgmt = email in ADMIN_MANAGEMENT_EMAILS
    app_role = "Admin" if is_admin_mgmt else "Staff"
    users_list.append({
        "employee_code":    u["employee_code"],
        "full_name":        u["full_name"],
        "email":            email,
        "phone":            u["phone"],
        "department":       dept,
        "designation":      u["role"],   # the role/title string; seed script resolves to id
        "mentor_email":     mentor_of.get(email),  # null for top-level users
        "role":             app_role,
        "is_management":    is_admin_mgmt,
        "must_change_password": True,
        # password_hash is intentionally omitted — the seed script will hash
        # a default one-time password (e.g. "HealthArk@2025") at runtime.
    })
users_json = {"users": users_list}
# ---------------------------------------------------------------------------
# 7. Write output files
# ---------------------------------------------------------------------------
users_path   = os.path.join(OUT_DIR, "users.json")
dept_roles_path = os.path.join(OUT_DIR, "departments_roles.json")
with open(users_path, "w", encoding="utf-8") as f:
    json.dump(users_json, f, indent=2, ensure_ascii=False)
with open(dept_roles_path, "w", encoding="utf-8") as f:
    json.dump(departments_roles_json, f, indent=2, ensure_ascii=False)
print(f"users.json             -> {len(users_list)} users written to {users_path}")
print(f"departments_roles.json -> {len(departments_list)} departments, {len(designations_list)} designations written to {dept_roles_path}")