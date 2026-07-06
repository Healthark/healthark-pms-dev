"""
Competency resolution — the department/level-aware competency framework.

Central place that answers "which competencies apply here?" for a given
(department, level), with a fallback to the org DEFAULT set when that
(department, level) hasn't defined its own framework.

Used by the read endpoint today; the review-form / expectation cutover will
consume the same helper so resolution logic lives in exactly one place.
"""

from sqlalchemy.orm import Session

from app.models.competency_models import Competency


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
