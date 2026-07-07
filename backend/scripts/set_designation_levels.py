"""
Set Designation.level per department/role from the canonical competency-matrix
source of truth.

The Competency Framework admin tab derives its level columns (and the
role->level panel) directly from `Designation.level`, so the levels must match
the agreed matrix. This script is the single, re-runnable place that mapping
lives.

Matching is tolerant of punctuation / encoding drift: role names are compared on
a normalized key (lowercased, every run of non-alphanumeric characters collapsed
to a single space). That lets it match rows like the mojibake'd
"Consultant <?> Business Development" and "Manager - HRBP." without hand-editing
the DB.

Usage (from the backend/ directory, with the venv active):
    python scripts/set_designation_levels.py            # DRY RUN (no writes)
    python scripts/set_designation_levels.py --apply    # commit the changes

Blank levels in the source matrix are controlled by --blank:
    --blank skip   (default) leave the current DB level untouched
    --blank null   set the level to NULL (no level)
"""

import argparse
import os
import re
import sys

# Allow `python scripts/set_designation_levels.py` from the backend/ dir.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal  # noqa: E402
from app.models.organization_models import Organization  # noqa: E402
from app.models.reference_models import Department, Designation  # noqa: E402

ORG_NAME = "Healthark"

# ── Canonical source of truth: department -> {role: level} ──────────────
# `None` = blank in the source matrix (see --blank).
MATRIX: dict[str, dict[str, int | None]] = {
    "Accounts": {
        "Executive": 1,
        "Finance Executive": 1,
        "Senior Account Executive": 2,
        "Senior Finance Executive": 2,
    },
    "HR & Admin": {
        "Admin Executive": 1,
        "Executive": 1,
        "HR Consultant": 1,
        "HR Executive": 1,
        "HR Manager": 3,
        "Manager": 3,
        "Manager - HRBP.": 3,
        "Senior HR Executive": 2,
        "Senior Talent Acquisition Executive": 2,
        "Talent Acquisition Executive": 1,
    },
    "Information Data Technology (IDT)": {
        "Architect": 5,
        "Associate Data Analyst": 1,
        "Associate Data Engineer": 1,
        "Associate Data Scientist": 1,
        "Associate Director": 1,
        "Associate Manager": None,
        "Business Analyst": 2,
        "Consultant": 1,
        "Consultant - Data Science": 1,
        "Data Analyst": 2,
        "Data Engineer": 2,
        "Data Scientist": 2,
        "Lead Data Engineer": 4,
        "Lead Data Scientist": 4,
        "Manager": None,
        "Regulatory Affairs Specialist": None,
        "Senior Business Analyst": 3,
        "Senior Consultant": 3,
        "Senior Data Analyst": 3,
        "Senior Data Engineer": 3,
        "Senior Data Scientist": 3,
        "Senior Software Developer": 3,
        "Senior Software Engineer": 3,
        "Software Developer": 3,
    },
    "Operation": {
        "Assistant Manager": 2,
        "Executive": 1,
        "IT Support Executive": 1,
        "System Administrator": 1,
    },
    "Real-World Evidence (RWE)": {
        "Associate Director": 5,
        "Consultant": 1,
        "Manager": 3,
    },
    "Sales & Marketing": {
        "Consultant": 1,
        "Consultant - Business Development": 1,
        "Executive": 1,
        "Graphic Designer": 1,
        "Junior SEO Executive": 1,
        "Manager": 3,
        "Marketing Associate": 1,
        "Marketing Lead": 4,
        "SEO Associate": 1,
        "SEO Executive": 1,
        "Senior Consultant": 2,
        "Senior Graphic Designer": 2,
        "Senior Marketing Associate": 2,
        "Senior SEO Associate": 2,
    },
    "Strategy Consulting": {
        "Associate Director": 5,
        "Commercial Analytics - Consultant": 1,
        "Consultant": 1,
        "Contractor": 1,
        "Director": 6,
        "Engagement Manager": 4,
        "Manager": 3,
        "Market Research Analyst": 1,
        "Partner": None,
        "Senior Consultant": 2,
    },
}


def norm(s: str) -> str:
    """Normalize a role/department name for tolerant matching."""
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="commit changes (default: dry run)")
    ap.add_argument(
        "--blank",
        choices=["skip", "null"],
        default="skip",
        help="how to handle blank source levels (default: skip = leave unchanged)",
    )
    args = ap.parse_args()

    db = SessionLocal()
    try:
        org = db.query(Organization).filter(Organization.name == ORG_NAME).first()
        if not org:
            print(f"!! Org {ORG_NAME!r} not found."); return 1

        depts = {
            d.name: d
            for d in db.query(Department).filter(Department.org_id == org.id).all()
        }

        changes: list[tuple[str, str, object, object]] = []  # dept, role, old, new
        unchanged = 0
        missing_in_db: list[tuple[str, str]] = []
        not_in_matrix: list[tuple[str, str, object]] = []

        for dept_name, roles in MATRIX.items():
            dept = depts.get(dept_name)
            if not dept:
                print(f"!! Department not found in DB: {dept_name!r}")
                continue

            db_desigs = (
                db.query(Designation)
                .filter(
                    Designation.org_id == org.id,
                    Designation.department_id == dept.id,
                )
                .all()
            )
            by_norm = {norm(d.name): d for d in db_desigs}
            covered: set[int] = set()

            for role, level in roles.items():
                target = by_norm.get(norm(role))
                if target is None:
                    missing_in_db.append((dept_name, role))
                    continue
                covered.add(target.id)

                if level is None and args.blank == "skip":
                    unchanged += 1
                    continue
                new_level = None if level is None else level
                if target.level == new_level:
                    unchanged += 1
                    continue
                changes.append((dept_name, target.name, target.level, new_level))
                target.level = new_level

            for d in db_desigs:
                if d.id not in covered and d.is_active:
                    not_in_matrix.append((dept_name, d.name, d.level))

        # ── Report ──────────────────────────────────────────────────────
        print("=" * 72)
        print(f"MODE: {'APPLY' if args.apply else 'DRY RUN'}   blank-policy: {args.blank}")
        print("=" * 72)

        print(f"\nCHANGES ({len(changes)}):")
        cur = None
        for dept_name, role, old, new in changes:
            if dept_name != cur:
                print(f"\n  ## {dept_name}"); cur = dept_name
            o = "-" if old is None else old
            n = "NULL" if new is None else new
            print(f"    {role:45} {o} -> {n}")
        if not changes:
            print("  (none — DB already matches)")

        if missing_in_db:
            print(f"\nMATRIX ROLES NOT FOUND IN DB ({len(missing_in_db)}):")
            for dept_name, role in missing_in_db:
                print(f"    {dept_name} / {role!r}")

        if not_in_matrix:
            print(f"\nACTIVE DB ROLES NOT IN THE MATRIX (left untouched) ({len(not_in_matrix)}):")
            cur = None
            for dept_name, role, lvl in not_in_matrix:
                if dept_name != cur:
                    print(f"  ## {dept_name}"); cur = dept_name
                print(f"    {role:45} level={lvl}")

        print(f"\nSUMMARY: {len(changes)} to change, {unchanged} already correct, "
              f"{len(missing_in_db)} matrix-miss, {len(not_in_matrix)} extra-in-db")

        if args.apply and changes:
            db.commit()
            print("\n[OK] Committed.")
        elif changes:
            db.rollback()
            print("\n(dry run - nothing written. Re-run with --apply to commit.)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
