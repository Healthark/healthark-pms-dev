"""
Admin Competency Framework editor.

CRUD over the department/level competency framework (the ``competencies`` table)
plus the role→level mapping (``Designation.level``). Admin-only.

A "competency" is the group of rows sharing (department, key): label,
is_reviewable and display_order are shared across its level rows; expectation is
per (competency, level) cell. department_id/level NULL is the org DEFAULT set
(the fallback shown for departments without their own framework).

Deletes are SOFT (is_deleted) so historical reviews — which render by the
competency ids stored in their comments — keep resolving. New competencies get
a stable auto-slugified key; the dynamic write payload lets custom-key comments
be saved.
"""

import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func

from app.api.dependencies import CurrentUser, DbSession
from app.core.cache import designations_cache
from app.models.competency_models import Competency
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.schemas.admin_schemas import (
    DesignationBrief,
    DesignationLevelUpdate,
    FrameworkCell,
    FrameworkCellUpdate,
    FrameworkCompetency,
    FrameworkCompetencyCreate,
    FrameworkCompetencyUpdate,
    FrameworkLevelAdd,
    FrameworkResponse,
)

router = APIRouter()

_DEFAULT_CELL_KEY = "default"


def _require_admin(current_user: User) -> None:
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )


def _slugify(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return s or "competency"


def _dept_scope(query, department_id: Optional[int]):
    """Filter a Competency query to a department, or the org default set."""
    if department_id is None:
        return query.filter(
            Competency.department_id.is_(None), Competency.level.is_(None)
        )
    return query.filter(Competency.department_id == department_id)


def _unique_key(db: DbSession, org_id: int, department_id: Optional[int], label: str) -> str:
    """A key not used by any competency (incl. soft-deleted) in this dept scope,
    so a new competency never collides with a removed one's stored ids."""
    base = _slugify(label)
    existing = {
        r[0]
        for r in _dept_scope(
            db.query(Competency.key).filter(Competency.org_id == org_id),
            department_id,
        ).distinct()
    }
    key = base
    i = 2
    while key in existing:
        key = f"{base}_{i}"
        i += 1
    return key


def _dept_designations(db: DbSession, org_id: int, department_id: int) -> List[Designation]:
    return (
        db.query(Designation)
        .filter(
            Designation.org_id == org_id,
            Designation.department_id == department_id,
            Designation.is_active == True,  # noqa: E712
        )
        .order_by(Designation.level, Designation.name)
        .all()
    )


def _dept_levels(db: DbSession, org_id: int, department_id: int) -> List[int]:
    """Levels present for a department = union of competency-row levels and the
    levels its designations map to. Defaults to [1] for a brand-new framework."""
    comp_levels = {
        r[0]
        for r in db.query(Competency.level)
        .filter(
            Competency.org_id == org_id,
            Competency.department_id == department_id,
            Competency.level.isnot(None),
        )
        .distinct()
    }
    desig_levels = {
        d.level for d in _dept_designations(db, org_id, department_id) if d.level is not None
    }
    return sorted(comp_levels | desig_levels) or [1]


def _framework_for(
    db: DbSession, org_id: int, department_id: Optional[int]
) -> FrameworkResponse:
    is_default = department_id is None
    rows = (
        _dept_scope(
            db.query(Competency).filter(
                Competency.org_id == org_id,
                Competency.is_deleted.is_(False),
            ),
            department_id,
        )
        .order_by(Competency.display_order, Competency.level, Competency.id)
        .all()
    )

    groups: dict[str, dict] = {}
    for r in rows:
        g = groups.get(r.key)
        if g is None:
            g = {
                "key": r.key,
                "label": r.label,
                "is_reviewable": r.is_reviewable,
                "display_order": r.display_order,
                "cells": {},
            }
            groups[r.key] = g
        cell_key = _DEFAULT_CELL_KEY if is_default else str(r.level)
        g["cells"][cell_key] = FrameworkCell(competency_id=r.id, expectation=r.expectation)

    competencies = [
        FrameworkCompetency(**g)
        for g in sorted(groups.values(), key=lambda x: (x["display_order"], x["label"]))
    ]

    levels: List[int] = []
    designations: List[DesignationBrief] = []
    if not is_default:
        levels = _dept_levels(db, org_id, department_id)
        designations = [
            DesignationBrief.model_validate(d, from_attributes=True)
            for d in _dept_designations(db, org_id, department_id)
        ]

    return FrameworkResponse(
        is_default=is_default,
        department_id=department_id,
        levels=levels,
        competencies=competencies,
        designations=designations,
    )


def _validate_department(db: DbSession, org_id: int, department_id: Optional[int]) -> None:
    if department_id is None:
        return
    dept = (
        db.query(Department)
        .filter(Department.id == department_id, Department.org_id == org_id)
        .first()
    )
    if not dept:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Department not found."
        )


# ── Reads ──────────────────────────────────────────────────────────────

@router.get("", response_model=FrameworkResponse)
def get_framework(
    db: DbSession,
    current_user: CurrentUser,
    department_id: Optional[int] = Query(None),
):
    """The framework matrix for a department (omit department_id → org default set)."""
    _require_admin(current_user)
    _validate_department(db, current_user.org_id, department_id)
    return _framework_for(db, current_user.org_id, department_id)


# ── Writes ─────────────────────────────────────────────────────────────

@router.post("/competencies", response_model=FrameworkResponse, status_code=status.HTTP_201_CREATED)
def create_competency(
    payload: FrameworkCompetencyCreate, db: DbSession, current_user: CurrentUser
):
    """Add a competency across the department's levels (single row for the
    default set)."""
    _require_admin(current_user)
    org_id = current_user.org_id
    _validate_department(db, org_id, payload.department_id)

    key = _unique_key(db, org_id, payload.department_id, payload.label)
    # Append after the existing competencies (max order + 1, so it never
    # collides with an order freed by a soft-delete).
    max_order = _dept_scope(
        db.query(func.coalesce(func.max(Competency.display_order), 0)).filter(
            Competency.org_id == org_id, Competency.is_deleted.is_(False)
        ),
        payload.department_id,
    ).scalar() or 0

    if payload.department_id is None:
        levels: List[Optional[int]] = [None]
    else:
        levels = list(_dept_levels(db, org_id, payload.department_id))

    for lvl in levels:
        db.add(
            Competency(
                org_id=org_id,
                department_id=payload.department_id,
                level=lvl,
                key=key,
                label=payload.label,
                display_order=max_order + 1,
                is_reviewable=payload.is_reviewable,
                is_deleted=False,
                expectation=None,
            )
        )
    db.commit()
    return _framework_for(db, org_id, payload.department_id)


@router.patch("/competencies", response_model=FrameworkResponse)
def update_competency(
    payload: FrameworkCompetencyUpdate, db: DbSession, current_user: CurrentUser
):
    """Rename / retoggle reviewable / reorder a competency across its level rows."""
    _require_admin(current_user)
    org_id = current_user.org_id
    rows = (
        _dept_scope(
            db.query(Competency).filter(
                Competency.org_id == org_id,
                Competency.key == payload.key,
                Competency.is_deleted.is_(False),
            ),
            payload.department_id,
        ).all()
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competency not found.")
    for r in rows:
        if payload.label is not None:
            r.label = payload.label
        if payload.is_reviewable is not None:
            r.is_reviewable = payload.is_reviewable
        if payload.display_order is not None:
            r.display_order = payload.display_order
    db.commit()
    return _framework_for(db, org_id, payload.department_id)


@router.delete("/competencies", response_model=FrameworkResponse)
def delete_competency(
    db: DbSession,
    current_user: CurrentUser,
    key: str = Query(...),
    department_id: Optional[int] = Query(None),
):
    """Soft-delete a competency (all its level rows). Historical reviews keep
    resolving the removed competency by id."""
    _require_admin(current_user)
    org_id = current_user.org_id
    rows = (
        _dept_scope(
            db.query(Competency).filter(
                Competency.org_id == org_id,
                Competency.key == key,
                Competency.is_deleted.is_(False),
            ),
            department_id,
        ).all()
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competency not found.")
    for r in rows:
        r.is_deleted = True
    db.commit()
    return _framework_for(db, org_id, department_id)


@router.patch("/cells/{competency_id}", response_model=FrameworkResponse)
def update_cell(
    competency_id: int,
    payload: FrameworkCellUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Set one (competency, level) cell's expectation text."""
    _require_admin(current_user)
    org_id = current_user.org_id
    row = (
        db.query(Competency)
        .filter(Competency.id == competency_id, Competency.org_id == org_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cell not found.")
    row.expectation = payload.expectation
    db.commit()
    return _framework_for(db, org_id, row.department_id)


@router.post("/levels", response_model=FrameworkResponse)
def add_level(payload: FrameworkLevelAdd, db: DbSession, current_user: CurrentUser):
    """Add a level column to a department — create an empty-expectation cell for
    each existing competency at that level."""
    _require_admin(current_user)
    org_id = current_user.org_id
    _validate_department(db, org_id, payload.department_id)

    # One representative row per competency key (for label/is_reviewable/order).
    reps: dict[str, Competency] = {}
    for r in (
        db.query(Competency)
        .filter(
            Competency.org_id == org_id,
            Competency.department_id == payload.department_id,
            Competency.is_deleted.is_(False),
        )
        .all()
    ):
        reps.setdefault(r.key, r)

    for key, rep in reps.items():
        exists = (
            db.query(Competency)
            .filter(
                Competency.org_id == org_id,
                Competency.department_id == payload.department_id,
                Competency.level == payload.level,
                Competency.key == key,
                Competency.is_deleted.is_(False),
            )
            .first()
        )
        if exists:
            continue
        db.add(
            Competency(
                org_id=org_id,
                department_id=payload.department_id,
                level=payload.level,
                key=key,
                label=rep.label,
                display_order=rep.display_order,
                is_reviewable=rep.is_reviewable,
                is_deleted=False,
                expectation=None,
            )
        )
    db.commit()
    return _framework_for(db, org_id, payload.department_id)


@router.patch("/designations/{designation_id}", response_model=DesignationBrief)
def set_designation_level(
    designation_id: int,
    payload: DesignationLevelUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Set a designation's level (role→level mapping)."""
    _require_admin(current_user)
    org_id = current_user.org_id
    d = (
        db.query(Designation)
        .filter(Designation.id == designation_id, Designation.org_id == org_id)
        .first()
    )
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Designation not found.")
    d.level = payload.level
    db.commit()
    # /admin/designations + framework resolution read this; drop the cache.
    designations_cache.invalidate(org_id)
    db.refresh(d)
    return DesignationBrief.model_validate(d, from_attributes=True)
