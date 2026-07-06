"""
Project Code / Name are free-form: no character pattern and no max length.

Regression for the Admin Panel "Create New Project" 422 (string_too_long) hit
when a code contained spaces and hyphens and ran past the old 20-char cap, e.g.
"Project_ERROR Replication - 1". The DB column is an unbounded String, so the
schema only keeps the required, non-empty rule (min_length=1). These tests pin
that whitespace + hyphens are accepted and that no length ceiling remains.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.project_schemas import (
    AssignmentCreate,
    ProjectCreate,
    ProjectUpdate,
)

# The exact input from the bug report — 29 chars, spaces + a hyphen. It was
# rejected by the old max_length=20 with type "string_too_long".
LONG_CODE = "Project_ERROR Replication - 1"


def _single_pm_create(**over):
    """A minimal valid single-PM ProjectCreate, overridable per test."""
    kwargs = dict(
        project_code=LONG_CODE,
        name="Market Access Study - Q2 2026",
        reports_to_id=999,
        assignments=[AssignmentCreate(user_id=1, evaluator_type="Primary")],
    )
    kwargs.update(over)
    return ProjectCreate(**kwargs)


# ── Create ───────────────────────────────────────────────────────────

def test_create_accepts_long_code_with_spaces_and_hyphen():
    project = _single_pm_create()
    assert project.project_code == LONG_CODE
    assert len(project.project_code) > 20  # past the old cap


def test_create_accepts_long_name_with_spaces_and_hyphen():
    long_name = "A - very - long project name with spaces " * 3
    project = _single_pm_create(name=long_name)
    assert project.name == long_name


def test_create_still_rejects_empty_code():
    # min_length=1 must survive — the code is still required and non-empty.
    with pytest.raises(ValidationError) as ei:
        _single_pm_create(project_code="")
    assert "project_code" in str(ei.value)


# ── Update ───────────────────────────────────────────────────────────

def test_update_accepts_long_code_with_spaces_and_hyphen():
    upd = ProjectUpdate(project_code=LONG_CODE)
    assert upd.project_code == LONG_CODE


def test_update_still_rejects_empty_code():
    with pytest.raises(ValidationError) as ei:
        ProjectUpdate(project_code="")
    assert "project_code" in str(ei.value)
