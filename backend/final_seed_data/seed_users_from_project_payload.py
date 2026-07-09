"""Seed users from the project payload JSON.

This script reads backend/final_seed_data/projects_seed_payload.json and
creates the referenced users in the database.

It also optionally enriches user metadata from backend/final_seed_data/users.json
when available, which provides department, designation, employee code, phone,
and mentor relationships.

Run from the backend/ directory:
    python final_seed_data/seed_users_from_project_payload.py
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import deque
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User

NULL_STRINGS = {"", "nan", "none", "null"}
EMAIL_NAME_RE = re.compile(r"^(.*?)<([^>]+)>$", flags=re.IGNORECASE)
VALID_ROLES = {"Admin", "Manager", "Principal", "Staff"}


def normalize_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.lower() in NULL_STRINGS:
        return None
    return text


def parse_contact_token(token: str) -> dict[str, str | None]:
    token = normalize_string(token)
    if not token:
        return {"email": None, "full_name": None}

    match = EMAIL_NAME_RE.match(token)
    if match:
        name = match.group(1).strip()
        email = match.group(2).strip().lower()
        return {"email": email or None, "full_name": name or None}

    if "@" in token:
        return {"email": token.lower(), "full_name": None}

    return {"email": None, "full_name": token}


def extract_project_contacts(payload_path: Path) -> dict[str, dict[str, str | None]]:
    with payload_path.open("r", encoding="utf-8") as f:
        records = json.load(f)

    contacts: dict[str, dict[str, str | None]] = {}

    def add_contact(email: str | None, full_name: str | None) -> None:
        if not email:
            return
        existing = contacts.get(email)
        if existing is None:
            contacts[email] = {"email": email, "full_name": full_name}
            return
        if not existing.get("full_name") and full_name:
            existing["full_name"] = full_name

    for record in records:
        for field in ("primary_pm", "reports_to"):
            raw_value = record.get(field)
            if raw_value is None:
                continue
            for part in str(raw_value).split(";"):
                part = part.strip()
                contact = parse_contact_token(part)
                add_contact(contact["email"], contact["full_name"])

        for assignment in record.get("team_assignments", []) or []:
            email = normalize_string(assignment.get("employee_email"))
            name = normalize_string(assignment.get("employee_name"))
            if email and "@" in email:
                add_contact(email.lower(), name)

    return contacts


def load_users_enrichment(users_json_path: Path) -> dict[str, dict[str, Any]]:
    if not users_json_path.exists():
        return {}
    with users_json_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    users = payload.get("users") or []
    enriched: dict[str, dict[str, Any]] = {}
    for user in users:
        email = normalize_string(user.get("email"))
        if not email:
            continue
        enriched[email.lower()] = user
    return enriched


def full_contact_set(project_contacts: dict[str, dict[str, str | None]], enrichment: dict[str, dict[str, Any]]) -> dict[str, dict[str, str | None]]:
    contacts = {email: info.copy() for email, info in project_contacts.items()}
    queue = deque(contacts.keys())

    while queue:
        email = queue.popleft()
        user_info = enrichment.get(email)
        if not user_info:
            continue
        mentor_email = normalize_string(user_info.get("mentor_email"))
        if mentor_email and "@" in mentor_email:
            mentor_email = mentor_email.lower()
            if mentor_email not in contacts:
                contacts[mentor_email] = {"email": mentor_email, "full_name": None}
                queue.append(mentor_email)

    return contacts


def find_or_create_org(db, org_name: str, org_domain: str | None) -> Organization:
    org = db.query(Organization).filter(Organization.name == org_name).first()
    if org:
        return org
    org = Organization(name=org_name, domain=org_domain, enabled_features=["dashboard", "goals", "project_reviews", "annual_reviews", "mentoring", "admin", "feedback_360"])
    db.add(org)
    db.flush()
    print(f"Created organization: {org.name}")
    return org


def find_or_create_department(db, org_id: int, department_name: str | None) -> Department | None:
    if not department_name:
        return None
    dept = db.query(Department).filter(Department.org_id == org_id, Department.name == department_name).first()
    if dept:
        return dept
    dept = Department(org_id=org_id, name=department_name)
    db.add(dept)
    db.flush()
    print(f"Created department: {department_name}")
    return dept


def find_or_create_designation(db, org_id: int, designation_name: str | None, department_id: int | None) -> Designation | None:
    if not designation_name:
        return None
    query = db.query(Designation).filter(Designation.org_id == org_id, Designation.name == designation_name)
    if department_id is None:
        query = query.filter(Designation.department_id.is_(None))
    else:
        query = query.filter(Designation.department_id == department_id)
    desig = query.first()
    if desig:
        return desig
    desig = Designation(org_id=org_id, department_id=department_id, name=designation_name, level=1)
    db.add(desig)
    db.flush()
    if department_id is not None:
        print(f"Created designation: {designation_name} (dept_id={department_id})")
    else:
        print(f"Created designation: {designation_name} (org-wide)")
    return desig


def build_user_metadata(email: str, contact: dict[str, str | None], enrichment: dict[str, Any]) -> dict[str, Any]:
    user_info = enrichment.get(email, {})
    full_name = contact.get("full_name") or normalize_string(user_info.get("full_name")) or email.split("@", 1)[0]
    employee_code = normalize_string(user_info.get("employee_code")) or f"TMP-{email.split('@', 1)[0]}"
    department_name = normalize_string(user_info.get("department"))
    designation_name = normalize_string(user_info.get("designation"))
    phone = normalize_string(user_info.get("phone"))
    role = normalize_string(user_info.get("role")) or "Staff"
    if role not in VALID_ROLES:
        role = "Staff"
    mentor_email = normalize_string(user_info.get("mentor_email"))
    is_management = bool(user_info.get("is_management"))
    return {
        "email": email,
        "full_name": full_name,
        "employee_code": employee_code,
        "department_name": department_name,
        "designation_name": designation_name,
        "phone": phone,
        "role": role,
        "mentor_email": mentor_email.lower() if mentor_email and "@" in mentor_email else None,
        "is_management": is_management,
    }


def create_or_update_users(db, org: Organization, contacts: dict[str, dict[str, str | None]], enrichment: dict[str, dict[str, Any]], default_password: str) -> tuple[int, int, int]:
    existing_users = db.query(User).filter(User.org_id == org.id, User.email.in_(list(contacts.keys()))).all()
    existing_by_email = {u.email.lower(): u for u in existing_users}

    created = 0
    updated = 0
    skipped = 0

    users_by_email: dict[str, User] = {}
    pending_mentor_map: dict[str, str] = {}

    for email, contact in sorted(contacts.items()):
        if email in existing_by_email:
            user = existing_by_email[email]
            metadata = build_user_metadata(email, contact, enrichment)
            changed = False

            if user.department_id is None and metadata["department_name"]:
                dept = find_or_create_department(db, org.id, metadata["department_name"])
                if dept:
                    user.department_id = dept.id
                    changed = True

            if user.designation_id is None and metadata["designation_name"]:
                dept_id = user.department_id
                desig = find_or_create_designation(db, org.id, metadata["designation_name"], dept_id)
                if desig:
                    user.designation_id = desig.id
                    changed = True

            if not user.employee_code and metadata["employee_code"]:
                user.employee_code = metadata["employee_code"]
                changed = True

            if not user.full_name and metadata["full_name"]:
                user.full_name = metadata["full_name"]
                changed = True

            if not user.phone and metadata["phone"]:
                user.phone = metadata["phone"]
                changed = True

            if user.role != metadata["role"] and metadata["role"] in VALID_ROLES:
                user.role = metadata["role"]
                changed = True

            if changed:
                db.add(user)
                updated += 1
                print(f"Updated existing user: {email}")
            else:
                skipped += 1
            users_by_email[email] = user
            if metadata["mentor_email"]:
                pending_mentor_map[email] = metadata["mentor_email"]
            continue

        metadata = build_user_metadata(email, contact, enrichment)
        dept = find_or_create_department(db, org.id, metadata["department_name"])
        desig = find_or_create_designation(db, org.id, metadata["designation_name"], dept.id if dept else None)

        hashed_password = get_password_hash(default_password)
        user = User(
            org_id=org.id,
            department_id=dept.id if dept else None,
            designation_id=desig.id if desig else None,
            employee_code=metadata["employee_code"],
            full_name=metadata["full_name"],
            email=email,
            phone=metadata["phone"],
            role=metadata["role"],
            password_hash=hashed_password,
            must_change_password=True,
            is_management=metadata["is_management"],
        )
        db.add(user)
        db.flush()
        users_by_email[email] = user
        if metadata["mentor_email"]:
            pending_mentor_map[email] = metadata["mentor_email"]
        created += 1
        print(f"Created user: {email}")

    # Resolve mentor ids after all users have been added.
    for email, mentor_email in pending_mentor_map.items():
        user = users_by_email.get(email)
        if not user:
            continue
        mentor = users_by_email.get(mentor_email)
        if mentor and user.mentor_id != mentor.id:
            user.mentor_id = mentor.id
            db.add(user)
            updated += 1
            print(f"Set mentor for {email} -> {mentor_email}")

    return created, updated, skipped


def main() -> int:
    default_payload = ROOT_DIR / "final_seed_data" / "projects_seed_payload.json"
    default_users_json = ROOT_DIR / "final_seed_data" / "users.json"

    parser = argparse.ArgumentParser(description="Seed users from a project payload JSON file.")
    parser.add_argument("--payload", default=str(default_payload), help="Path to projects_seed_payload.json")
    parser.add_argument("--users-json", default=str(default_users_json), help="Path to users.json for metadata enrichment")
    parser.add_argument("--organization", default="Healthark", help="Organization name to seed users into")
    parser.add_argument("--org-domain", default="healthark.ai", help="Organization domain when creating a new org")
    parser.add_argument("--password", default="password123", help="Default password for new users")
    parser.add_argument("--dry-run", action="store_true", help="Parse data and show summary without writing to the DB")
    args = parser.parse_args()

    payload_path = Path(args.payload).resolve()
    users_json_path = Path(args.users_json).resolve()

    if not payload_path.exists():
        print(f"Payload not found: {payload_path}")
        return 2

    project_contacts = extract_project_contacts(payload_path)
    enrichment = load_users_enrichment(users_json_path)
    all_contacts = full_contact_set(project_contacts, enrichment)

    print(f"Found {len(project_contacts)} unique project contacts")
    print(f"Including mentor chain, seeding {len(all_contacts)} total users")

    if args.dry_run:
        print("Dry run complete. No database writes were performed.")
        return 0

    db = SessionLocal()
    try:
        org = find_or_create_org(db, args.organization, args.org_domain)
        created, updated, skipped = create_or_update_users(db, org, all_contacts, enrichment, args.password)
        db.commit()
        print("")
        print(f"Summary: created={created}, updated={updated}, skipped={skipped}")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"Error: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
