"""
Competency resolution — the department/level-aware competency framework.

Central place that answers "which competencies apply here?" for a given
(department, level), with a fallback to the org DEFAULT set when that
(department, level) hasn't defined its own framework.

Used by the read endpoint today; the review-form / expectation cutover will
consume the same helper so resolution logic lives in exactly one place.
"""

import re

from sqlalchemy.orm import Session

from app.data.competency_framework import load_framework
from app.models.competency_models import Competency
from app.models.reference_models import Department


def get_competency_set(
    db: Session,
    org_id: int,
    department_id: int | None,
    level: int | None,
) -> tuple[list[Competency], bool]:
    """Resolve the active competency set for a (department, level).

    Returns ``(competencies, is_default)``:

      * If the given (department, level) has its own non-deleted competencies,
        those are returned with ``is_default=False``.
      * Otherwise the org DEFAULT set (department_id/level NULL) is returned
        with ``is_default=True`` — the caller can surface this as a
        "framework not defined for this role — using default" flag.

    Only non-deleted competencies are returned, ordered by ``display_order``
    then ``id`` for a stable sequence.
    """
    if department_id is not None and level is not None:
        scoped = (
            db.query(Competency)
            .filter(
                Competency.org_id == org_id,
                Competency.department_id == department_id,
                Competency.level == level,
                Competency.is_deleted.is_(False),
            )
            .order_by(Competency.display_order, Competency.id)
            .all()
        )
        if scoped:
            return scoped, False

    defaults = (
        db.query(Competency)
        .filter(
            Competency.org_id == org_id,
            Competency.department_id.is_(None),
            Competency.level.is_(None),
            Competency.is_deleted.is_(False),
        )
        .order_by(Competency.display_order, Competency.id)
        .all()
    )
    return defaults, True


def get_competencies_by_ids(
    db: Session,
    org_id: int,
    ids: list[int],
) -> list[Competency]:
    """Resolve specific competencies by id, ordered by ``display_order``.

    Used to render a review against the exact competencies it was written for
    (the ids stored in its comments). Deliberately does NOT filter
    ``is_deleted`` — a competency removed after a review was written must still
    resolve its label so the historical review renders correctly. Scoped to the
    org for safety. Returns [] for an empty id list.
    """
    if not ids:
        return []
    return (
        db.query(Competency)
        .filter(Competency.org_id == org_id, Competency.id.in_(ids))
        .order_by(Competency.display_order, Competency.id)
        .all()
    )


def _find_department(db: Session, org_id: int, key: str, aliases=()) -> "Department | None":
    """Match a framework department key to an org Department.

    Departments are often named more verbosely than the framework's short keys
    (e.g. the "IDT" framework vs a "Information Data Technology (IDT)"
    department). Match, in order: an exact case-insensitive hit on the key or any
    alias, then a word-boundary hit of the key/alias inside a department name —
    so "IDT" matches "…(IDT)" and "Strategy" matches "Strategy Consulting",
    without matching unrelated departments.
    """
    depts = db.query(Department).filter(Department.org_id == org_id).all()
    names = [key, *aliases]
    by_lower = {d.name.strip().lower(): d for d in depts}
    for n in names:
        hit = by_lower.get(n.strip().lower())
        if hit:
            return hit
    for d in depts:
        for n in names:
            if re.search(rf"\b{re.escape(n)}\b", d.name, flags=re.IGNORECASE):
                return d
    return None


def seed_competency_framework(db: Session, org_id: int) -> None:
    """Seed the department/level competency framework for an org (idempotent).

    - Fills the org DEFAULT set's (department/level NULL) expectation with the
      framework's default text ("Not defined") so departments without their own
      framework surface that under each competency.
    - For each department named in the framework (IDT, Strategy, RWE) that
      exists in this org, creates the per-level competencies with their
      expectation text. Get-or-create keyed by (org, department, level, key),
      so it's safe to re-run and to run alongside the migration.

    Designation levels are intentionally NOT set here (HR maps roles→levels
    separately); until then a reviewee resolves to level 1 or, for an
    undefined department, the org default set.
    """
    fw = load_framework()
    canon = fw["competencies"]  # canonical, ordered
    default_exp = fw.get("default_expectation") or ""

    # 0. Ensure the org DEFAULT set (department/level NULL) exists — one row per
    # canonical competency — and carries the default expectation. Get-or-create
    # so it works whether or not the earlier migration already seeded it.
    for order, comp in enumerate(canon, start=1):
        existing = (
            db.query(Competency)
            .filter(
                Competency.org_id == org_id,
                Competency.department_id.is_(None),
                Competency.level.is_(None),
                Competency.key == comp["key"],
            )
            .first()
        )
        if existing:
            if not existing.expectation:
                existing.expectation = default_exp
        else:
            db.add(
                Competency(
                    org_id=org_id,
                    department_id=None,
                    level=None,
                    key=comp["key"],
                    label=comp["label"],
                    display_order=order,
                    is_reviewable=comp["is_reviewable"],
                    is_deleted=False,
                    expectation=default_exp,
                )
            )
    db.flush()

    for dept_name, data in fw["departments"].items():
        dept = _find_department(db, org_id, dept_name, data.get("aliases", ()))
        if not dept:
            continue
        for level_str, texts in data["levels"].items():
            level = int(level_str)
            for order, comp in enumerate(canon, start=1):
                key = comp["key"]
                text = texts.get(key) or ""
                exists = (
                    db.query(Competency)
                    .filter(
                        Competency.org_id == org_id,
                        Competency.department_id == dept.id,
                        Competency.level == level,
                        Competency.key == key,
                    )
                    .first()
                )
                if exists:
                    # Backfill a BLANK expectation from the framework — e.g. a
                    # row created empty via the admin UI before the framework
                    # was seeded. Never overwrite text an admin already entered.
                    if text and not (exists.expectation and exists.expectation.strip()):
                        exists.expectation = text
                    continue
                db.add(
                    Competency(
                        org_id=org_id,
                        department_id=dept.id,
                        level=level,
                        key=key,
                        label=comp["label"],
                        display_order=order,
                        is_reviewable=comp["is_reviewable"],
                        is_deleted=False,
                        expectation=text,
                    )
                )
    db.flush()
