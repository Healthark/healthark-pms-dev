"""
Project-review comments — competency JSON is the sole source of truth.

``ProjectReview.comments`` (JSON keyed by competency id) is the only store for
per-competency comments; the legacy ``comment_*`` columns have been dropped. The
API request/response contract is unchanged — the fixed comment_* response fields
are reconstructed from the JSON for the default competency set. These tests pin:

  * write paths persist the JSON (keyed by the org's default competency ids),
    whether the client sends the dynamic map or the legacy fixed fields;
  * reads reconstruct the comment_* response fields from the JSON;
  * custom (non-default) competencies live only in the JSON;
  * draft-detection counts content stored in the JSON.

All routes are plain functions, called directly against in-memory SQLite.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_review_routes import (
    _build_review_response,
    _comments_map_for_response,
    _pm_review_has_draft_content,
    get_pm_evaluation_queue,
    get_review,
    save_pm_evaluation_draft,
    submit_pm_evaluation,
)
from app.core.database import Base
from app.models.competency_models import Competency
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project, ProjectAssignment
from app.models.project_review_models import (
    PerformanceGroup,
    ProjectReview,
    ProjectReviewStatus,
)
from app.models.reference_models import Department, Designation
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.project_review_schemas import (
    PMEvaluationDraft,
    PMEvaluationSubmit,
)

ACTIVE_CYCLE = "H1 FY26-27"

# The 7 reviewable default competencies + firm_growth (expectation-only).
_DEFAULTS = [
    ("task_execution", "Task Execution", 1, True),
    ("ownership", "Ownership", 2, True),
    ("project_management", "Project Management", 3, True),
    ("client_deliverables", "Client Deliverables", 4, True),
    ("communication", "Communication", 5, True),
    ("mentoring", "Mentoring", 6, True),
    ("firm_growth", "Firm Growth", 7, False),
    ("competency_skills", "Competency & Skills", 8, True),
]


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


_n = {"i": 0}


def _user(db, org_id, *, role="Staff"):
    _n["i"] += 1
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{_n['i']:04d}",
        full_name=f"User {_n['i']}",
        email=f"user{_n['i']}@example.com",
        role=role,
        password_hash="x",
        is_deleted=False,
    )
    db.add(u)
    db.flush()
    return u


def _seed_defaults(db, org_id):
    """Seed the org's default competency set; return {key: id}."""
    ids = {}
    for key, label, order, reviewable in _DEFAULTS:
        c = Competency(
            org_id=org_id, department_id=None, level=None, key=key, label=label,
            display_order=order, is_reviewable=reviewable, is_deleted=False,
        )
        db.add(c)
        db.flush()
        ids[key] = c.id
    return ids


def _scenario(db):
    """Org + active cycle + project with a PM (Primary) and one member, plus
    the seeded default competency set. Returns (org, pm, member, project, ids)."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=ACTIVE_CYCLE))
    pm = _user(db, org.id)
    member = _user(db, org.id)
    project = Project(
        org_id=org.id, project_code="P-1", name="Proj", status=PROJECT_STATUS_ACTIVE,
    )
    db.add(project)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=pm.id,
        evaluator_type="Primary", is_deleted=False,
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=member.id, is_deleted=False,
    ))
    ids = _seed_defaults(db, org.id)
    db.commit()
    return org, pm, member, project, ids


def _payload():
    return PMEvaluationSubmit(
        performance_group=PerformanceGroup.RATING_3,
        impact_statement="Solid delivery.",
        comment_task_execution="TE",
        comment_ownership="OWN",
        comment_project_management="PMG",
        comment_client_deliverables="CD",
        comment_communication="COMM",
        comment_mentoring="MENT",
        comment_competency_skills="CS",
    )


# ── Write path persists JSON (from legacy fixed fields) ───────────────────

def test_submit_from_fixed_fields_writes_json(db):
    org, pm, member, project, ids = _scenario(db)
    resp = submit_pm_evaluation(project.id, member.id, _payload(), db, pm)

    # Response contract unchanged — comment_* fields present (reconstructed).
    assert resp.comment_task_execution == "TE"
    assert resp.comment_competency_skills == "CS"

    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()
    # JSON written, keyed by the 7 reviewable competency ids (no firm_growth).
    assert row.comments == {
        str(ids["task_execution"]): "TE",
        str(ids["ownership"]): "OWN",
        str(ids["project_management"]): "PMG",
        str(ids["client_deliverables"]): "CD",
        str(ids["communication"]): "COMM",
        str(ids["mentoring"]): "MENT",
        str(ids["competency_skills"]): "CS",
    }
    assert str(ids["firm_growth"]) not in row.comments


def test_get_review_reconstructs_from_json(db):
    org, pm, member, project, ids = _scenario(db)
    submit_pm_evaluation(project.id, member.id, _payload(), db, pm)
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()

    resp = get_review(row.id, db, pm)
    assert resp.comment_task_execution == "TE"
    assert resp.comment_mentoring == "MENT"


# ── JSON is the sole source of truth ──────────────────────────────────────

def test_response_follows_json(db):
    org, pm, member, project, ids = _scenario(db)
    submit_pm_evaluation(project.id, member.id, _payload(), db, pm)
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()

    # Editing the JSON changes the reconstructed response field.
    row.comments = {**row.comments, str(ids["task_execution"]): "EDITED"}
    db.commit()

    resp = _build_review_response(row, db)
    assert resp.comment_task_execution == "EDITED"


def test_legacy_field_none_for_soft_deleted_default_competency(db):
    """If a default competency is soft-deleted after a review was written, its
    fixed comment_* response field can no longer be reconstructed (the id no
    longer maps to a default key) — but the comment survives in the `comments`
    map and the embedded competencies, which render it."""
    org, pm, member, project, ids = _scenario(db)
    submit_pm_evaluation(project.id, member.id, _payload(), db, pm)
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()

    db.query(Competency).filter(Competency.id == ids["mentoring"]).update(
        {Competency.is_deleted: True}
    )
    db.commit()

    resp = _build_review_response(row, db)
    # The legacy fixed field no longer reconstructs (default-key lookup misses).
    assert resp.comment_mentoring is None
    # But the comment is preserved in the id-keyed map + embedded competencies.
    assert resp.comments[str(ids["mentoring"])] == "MENT"
    assert any(c.id == ids["mentoring"] for c in resp.competencies)
    # Still-resolving fields reconstruct normally.
    assert resp.comment_task_execution == "TE"


# ── Draft-detection honours the JSON ──────────────────────────────────────

def test_has_draft_content_detects_json_only(db):
    org, pm, member, project, ids = _scenario(db)
    row = ProjectReview(
        org_id=org.id, user_id=member.id, project_id=project.id, cycle=ACTIVE_CYCLE,
        status=ProjectReviewStatus.DRAFT.value, is_deleted=False,
        comments={str(ids["ownership"]): "typed something"},
    )
    assert _pm_review_has_draft_content(row) is True


def test_has_draft_content_false_for_empty_placeholder(db):
    org, pm, member, project, ids = _scenario(db)
    row = ProjectReview(
        org_id=org.id, user_id=member.id, project_id=project.id, cycle=ACTIVE_CYCLE,
        status=ProjectReviewStatus.PENDING.value, is_deleted=False,
        comments={str(ids["ownership"]): "   "},  # whitespace only
    )
    assert _pm_review_has_draft_content(row) is False


# ── PR 3: dynamic API surface (additive, invisible) ───────────────────────

def test_response_exposes_comments_map(db):
    """ProjectReviewResponse carries the {competency_id: text} map alongside
    the legacy comment_* fields, so the frontend can render dynamically."""
    org, pm, member, project, ids = _scenario(db)
    submit_pm_evaluation(project.id, member.id, _payload(), db, pm)
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()

    resp = get_review(row.id, db, pm)
    assert resp.comments == {
        str(ids["task_execution"]): "TE",
        str(ids["ownership"]): "OWN",
        str(ids["project_management"]): "PMG",
        str(ids["client_deliverables"]): "CD",
        str(ids["communication"]): "COMM",
        str(ids["mentoring"]): "MENT",
        str(ids["competency_skills"]): "CS",
    }
    # Legacy fields still populated (default set) — invisible to old clients.
    assert resp.comment_task_execution == "TE"


def test_comments_map_none_for_empty_placeholder(db):
    org, pm, member, project, ids = _scenario(db)
    row = ProjectReview(
        org_id=org.id, user_id=member.id, project_id=project.id, cycle=ACTIVE_CYCLE,
        status=ProjectReviewStatus.PENDING.value, is_deleted=False, comments=None,
    )
    db.add(row)
    db.commit()
    assert _comments_map_for_response(row) is None


def test_response_embeds_competencies_by_stored_ids(db):
    """The review response embeds the competencies it was written against,
    resolved by the ids in its comments and ordered by display_order."""
    org, pm, member, project, ids = _scenario(db)
    submit_pm_evaluation(project.id, member.id, _payload(), db, pm)
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()

    resp = get_review(row.id, db, pm)
    # The 7 reviewable competencies (firm_growth is not in comments), ordered
    # by display_order.
    assert [c.key for c in resp.competencies] == [
        "task_execution", "ownership", "project_management",
        "client_deliverables", "communication", "mentoring", "competency_skills",
    ]
    assert [c.id for c in resp.competencies] == [
        ids["task_execution"], ids["ownership"], ids["project_management"],
        ids["client_deliverables"], ids["communication"], ids["mentoring"],
        ids["competency_skills"],
    ]


def test_embed_resolves_soft_deleted_competency(db):
    """A competency soft-deleted after a review was written still resolves its
    label in that review's embed — so the historical review renders intact."""
    org, pm, member, project, ids = _scenario(db)
    submit_pm_evaluation(project.id, member.id, _payload(), db, pm)
    db.query(Competency).filter(Competency.id == ids["mentoring"]).update(
        {Competency.is_deleted: True}
    )
    db.commit()
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()

    resp = get_review(row.id, db, pm)
    mentoring = next(c for c in resp.competencies if c.id == ids["mentoring"])
    assert mentoring.label == "Mentoring"


def test_embed_empty_for_review_without_comments(db):
    org, pm, member, project, ids = _scenario(db)
    row = ProjectReview(
        org_id=org.id, user_id=member.id, project_id=project.id, cycle=ACTIVE_CYCLE,
        status=ProjectReviewStatus.PENDING.value, is_deleted=False, comments=None,
    )
    db.add(row)
    db.commit()
    resp = _build_review_response(row, db)
    assert resp.competencies == []


def _full_map(ids):
    return {
        ids["task_execution"]: "TE", ids["ownership"]: "OWN",
        ids["project_management"]: "PMG", ids["client_deliverables"]: "CD",
        ids["communication"]: "COMM", ids["mentoring"]: "MENT",
        ids["competency_skills"]: "CS",
    }


# ── PR 6a: dynamic write payload (competency-id -> text map) ───────────────

def test_submit_via_comments_map_writes_json(db):
    """Submitting the dynamic map stores it as the review's comments JSON; the
    response still exposes the reconstructed comment_* fields (default set)."""
    org, pm, member, project, ids = _scenario(db)
    payload = PMEvaluationSubmit(
        performance_group=PerformanceGroup.RATING_3,
        impact_statement="ok",
        comments=_full_map(ids),
    )
    resp = submit_pm_evaluation(project.id, member.id, payload, db, pm)
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()
    assert row.comments == {str(k): v for k, v in _full_map(ids).items()}
    assert resp.comment_ownership == "OWN"  # reconstructed from JSON


def test_submit_via_comments_map_custom_competency(db):
    """A custom (non-default-key) competency's comment is stored in the JSON
    only — no legacy column exists for it, and the legacy columns are cleared."""
    org, pm, member, project, ids = _scenario(db)
    custom = Competency(
        org_id=org.id, department_id=5, level=2, key="custom_x",
        label="Custom X", display_order=1, is_reviewable=True, is_deleted=False,
    )
    db.add(custom)
    db.flush()
    db.commit()
    payload = PMEvaluationSubmit(
        performance_group=PerformanceGroup.RATING_3,
        impact_statement="ok",
        comments={custom.id: "custom feedback"},
    )
    submit_pm_evaluation(project.id, member.id, payload, db, pm)
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()
    assert row.comments == {str(custom.id): "custom feedback"}


def test_submit_rejects_empty_comment_value(db):
    org, pm, member, project, ids = _scenario(db)
    payload = PMEvaluationSubmit(
        performance_group=PerformanceGroup.RATING_3,
        impact_statement="ok",
        comments={ids["ownership"]: "   "},
    )
    with pytest.raises(HTTPException) as ei:
        submit_pm_evaluation(project.id, member.id, payload, db, pm)
    assert ei.value.status_code == 422


def test_submit_rejects_incomplete_legacy_fields(db):
    """No map + not all fixed fields present → 422 (replaces the schema-level
    required check now that the fixed fields are optional)."""
    org, pm, member, project, ids = _scenario(db)
    payload = PMEvaluationSubmit(
        performance_group=PerformanceGroup.RATING_3,
        impact_statement="ok",
        comment_task_execution="only one",
    )
    with pytest.raises(HTTPException) as ei:
        submit_pm_evaluation(project.id, member.id, payload, db, pm)
    assert ei.value.status_code == 422


def test_draft_via_comments_map(db):
    org, pm, member, project, ids = _scenario(db)
    payload = PMEvaluationDraft(comments={ids["ownership"]: "draft text"})
    save_pm_evaluation_draft(project.id, member.id, payload, db, pm)
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()
    assert row.comments == {str(ids["ownership"]): "draft text"}


def test_pm_queue_card_carries_department_and_level(db):
    """The PM queue card exposes the reviewee's department_id + designation
    level, so the frontend can fetch the applicable competency set."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=ACTIVE_CYCLE))
    dept = Department(org_id=org.id, name="Strategy")
    db.add(dept)
    db.flush()
    desig = Designation(org_id=org.id, department_id=dept.id, name="Manager", level=4)
    db.add(desig)
    db.flush()
    pm = _user(db, org.id)
    member = _user(db, org.id)
    member.designation_id = desig.id
    project = Project(
        org_id=org.id, project_code="P-1", name="Proj", status=PROJECT_STATUS_ACTIVE,
    )
    db.add(project)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=pm.id,
        evaluator_type="Primary", is_deleted=False,
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=member.id,
        department_id=dept.id, is_deleted=False,
    ))
    db.commit()

    cards = get_pm_evaluation_queue(db, pm)
    card = next(c for c in cards if c.user_id == member.id)
    assert card.department_id == dept.id
    assert card.level == 4
