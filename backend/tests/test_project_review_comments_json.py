"""
Project-review comments — expand phase (competency JSON as source of truth).

PR 2 makes ``ProjectReview.comments`` (JSON keyed by competency id) the read
source of truth while the legacy ``comment_*`` columns are dual-written for
rollback safety. The API request/response contract is unchanged, so this is an
invisible plumbing change. These tests pin that:

  * write paths dual-write the JSON (keyed by the org's default competency ids)
    AND the columns;
  * reads reconstruct the comment_* response fields from the JSON;
  * when JSON and columns disagree, the JSON wins (it's the source of truth);
  * when JSON is absent (a row written by pre-cutover code), reads fall back to
    the columns;
  * draft-detection counts content stored in either place.

All routes are plain functions, called directly against in-memory SQLite.
"""
from __future__ import annotations

import pytest
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
from app.schemas.project_review_schemas import PMEvaluationSubmit

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


# ── Write path dual-writes JSON + columns ─────────────────────────────────

def test_submit_dual_writes_json_and_columns(db):
    org, pm, member, project, ids = _scenario(db)
    resp = submit_pm_evaluation(project.id, member.id, _payload(), db, pm)

    # Response contract unchanged — comment_* fields present.
    assert resp.comment_task_execution == "TE"
    assert resp.comment_competency_skills == "CS"

    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()
    # Legacy columns still written (rollback safety).
    assert row.comment_task_execution == "TE"
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


# ── JSON is the source of truth ───────────────────────────────────────────

def test_json_wins_over_columns(db):
    org, pm, member, project, ids = _scenario(db)
    submit_pm_evaluation(project.id, member.id, _payload(), db, pm)
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()

    # Diverge the JSON from the column; the response must follow the JSON.
    row.comments = {**row.comments, str(ids["task_execution"]): "FROM_JSON"}
    db.commit()

    resp = _build_review_response(row, db)
    assert resp.comment_task_execution == "FROM_JSON"  # JSON wins
    assert row.comment_task_execution == "TE"           # column untouched


def test_per_field_fallback_for_unresolvable_json_id(db):
    """Hardening: if the JSON holds a competency id that no longer resolves
    (e.g. a default competency later soft-deleted/re-flagged), that field must
    fall back to the column rather than silently dropping to None."""
    org, pm, member, project, ids = _scenario(db)
    submit_pm_evaluation(project.id, member.id, _payload(), db, pm)
    row = db.query(ProjectReview).filter_by(
        project_id=project.id, user_id=member.id
    ).one()

    # Simulate mentoring's default competency being soft-deleted after write:
    # its stored JSON id (ids["mentoring"]) will no longer resolve.
    db.query(Competency).filter(Competency.id == ids["mentoring"]).update(
        {Competency.is_deleted: True}
    )
    db.commit()

    resp = _build_review_response(row, db)
    # Unresolvable id → column value shows through (not dropped to None).
    assert resp.comment_mentoring == "MENT"
    # Still-resolving ids continue to come from the JSON source of truth.
    assert resp.comment_task_execution == "TE"


def test_column_fallback_when_json_absent(db):
    """A row written by pre-cutover code has columns but no JSON — reads must
    fall back to the columns."""
    org, pm, member, project, ids = _scenario(db)
    row = ProjectReview(
        org_id=org.id, user_id=member.id, project_id=project.id, cycle=ACTIVE_CYCLE,
        reviewer_id=pm.id, status=ProjectReviewStatus.REVIEWED.value, is_deleted=False,
        comment_task_execution="LEGACY", comment_ownership="LEGACY-O",
        comments=None,
    )
    db.add(row)
    db.commit()

    resp = _build_review_response(row, db)
    assert resp.comment_task_execution == "LEGACY"
    assert resp.comment_ownership == "LEGACY-O"


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
    assert _comments_map_for_response(db, row) is None


def test_comments_map_built_from_columns_for_legacy_row(db):
    """A legacy row (columns, no JSON) still yields a map keyed by the default
    competency ids."""
    org, pm, member, project, ids = _scenario(db)
    row = ProjectReview(
        org_id=org.id, user_id=member.id, project_id=project.id, cycle=ACTIVE_CYCLE,
        reviewer_id=pm.id, status=ProjectReviewStatus.REVIEWED.value, is_deleted=False,
        comment_task_execution="LEGACY", comments=None,
    )
    db.add(row)
    db.commit()
    m = _comments_map_for_response(db, row)
    assert m[str(ids["task_execution"])] == "LEGACY"


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
