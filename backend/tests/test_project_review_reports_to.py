"""
Reports-to -> PM project evaluation flow (single-PM projects).

A project's PM (ProjectAssignment.evaluator_type == "Primary") evaluates the
team members; the PM in turn is evaluated by the project's `reports_to` senior
(Project.reports_to_id). Post-PR2 the reports-to endpoints take the reviewee's
user_id explicitly (a "root" — the single Primary here); multi-PM routing is
covered in test_project_multi_pm_routing.py. These endpoints are plain
functions, so we call them directly against an in-memory SQLite session.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_review_routes import (
    get_management_overview,
    get_reports_to_evaluation_queue,
    get_review,
    save_reports_to_evaluation_draft,
    submit_reports_to_evaluation,
    update_review,
)
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project, ProjectAssignment
from app.models.project_review_models import (
    PerformanceGroup,
    ProjectReview,
    ProjectReviewStatus,
)
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.project_review_schemas import PMEvaluationDraft, PMEvaluationSubmit

ACTIVE_CYCLE = "H1 FY26-27"


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


def _scenario(db, *, reports_to=True, with_team=1):
    """Org + active cycle + one project with a PM, a reports-to senior, and
    `with_team` regular members. Returns (org, pm, senior, project, members)."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=ACTIVE_CYCLE))
    pm = _user(db, org.id)
    senior = _user(db, org.id)
    project = Project(
        org_id=org.id,
        project_code="P-1",
        name="Proj",
        status=PROJECT_STATUS_ACTIVE,
        reports_to_id=senior.id if reports_to else None,
    )
    db.add(project)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=pm.id,
        evaluator_type="Primary", is_deleted=False,
    ))
    members = []
    for _ in range(with_team):
        m = _user(db, org.id)
        members.append(m)
        db.add(ProjectAssignment(
            org_id=org.id, project_id=project.id, user_id=m.id, is_deleted=False,
        ))
    db.commit()
    return org, pm, senior, project, members


def _payload():
    return PMEvaluationSubmit(
        performance_group=next(iter(PerformanceGroup)),
        impact_statement="Strong PM leadership on delivery.",
        comment_task_execution="ok",
        comment_ownership="ok",
        comment_project_management="ok",
        comment_client_deliverables="ok",
        comment_communication="ok",
        comment_mentoring="ok",
        comment_competency_skills="ok",
    )


def test_queue_lists_the_pm_for_the_reports_to_senior(db):
    _org, pm, senior, project, _m = _scenario(db)
    cards = get_reports_to_evaluation_queue(db, senior)
    assert len(cards) == 1
    assert cards[0].user_id == pm.id  # the reviewee is the PM (the single root)
    assert cards[0].project_id == project.id
    assert cards[0].review_id is None  # placeholder — no review yet
    assert cards[0].cycle == ACTIVE_CYCLE


def test_queue_empty_for_non_reports_to_and_for_the_pm(db):
    _org, pm, _senior, _project, members = _scenario(db)
    assert get_reports_to_evaluation_queue(db, members[0]) == []  # a team member
    assert get_reports_to_evaluation_queue(db, pm) == []  # the PM isn't their own reviewer


def test_submit_creates_pm_review_authored_by_reports_to(db):
    _org, pm, senior, project, _m = _scenario(db)
    resp = submit_reports_to_evaluation(project.id, pm.id, _payload(), db, senior)

    assert resp.user_id == pm.id  # PM is the reviewee
    assert resp.reviewer_id == senior.id  # reports-to is the author
    assert resp.status == ProjectReviewStatus.REVIEWED

    row = db.query(ProjectReview).filter_by(project_id=project.id, user_id=pm.id).one()
    assert row.reviewer_id == senior.id
    assert row.status == ProjectReviewStatus.REVIEWED.value

    # Queue now shows the reviewed card (no duplicate active-cycle placeholder).
    cards = get_reports_to_evaluation_queue(db, senior)
    assert [c.review_status for c in cards] == ["reviewed"]


def test_submit_forbidden_for_non_reports_to(db):
    _org, pm, _senior, project, members = _scenario(db)
    with pytest.raises(HTTPException) as ei:
        submit_reports_to_evaluation(project.id, pm.id, _payload(), db, members[0])
    assert ei.value.status_code == 403


def test_submit_404_when_project_has_no_pm(db):
    _org, pm, senior, project, _m = _scenario(db)
    db.query(ProjectAssignment).filter_by(
        project_id=project.id, evaluator_type="Primary"
    ).delete()
    db.commit()
    with pytest.raises(HTTPException) as ei:
        submit_reports_to_evaluation(project.id, pm.id, _payload(), db, senior)
    assert ei.value.status_code == 404


def test_submit_404_when_reviewee_is_not_a_root(db):
    """A team member (not a root) can't be evaluated via the reports-to flow."""
    _org, _pm, senior, project, members = _scenario(db)
    with pytest.raises(HTTPException) as ei:
        submit_reports_to_evaluation(project.id, members[0].id, _payload(), db, senior)
    assert ei.value.status_code == 404


def test_reports_to_can_view_pm_review_even_if_not_the_author(db):
    """is_reports_to access branch: a senior who is the project's reports_to but
    did NOT author the review can still view it."""
    _org, pm, senior, project, _m = _scenario(db)
    other = _user(db, project.org_id)
    rv = ProjectReview(
        org_id=project.org_id, project_id=project.id, user_id=pm.id,
        reviewer_id=other.id, cycle=ACTIVE_CYCLE,
        status=ProjectReviewStatus.REVIEWED.value, is_deleted=False,
    )
    db.add(rv)
    db.commit()
    got = get_review(rv.id, db, senior)
    assert got.id == rv.id


def test_pm_sees_own_review_once_reviewed(db):
    _org, pm, senior, project, _m = _scenario(db)
    resp = submit_reports_to_evaluation(project.id, pm.id, _payload(), db, senior)
    got = get_review(resp.id, db, pm)  # is_owner
    assert got.user_id == pm.id
    assert got.status == ProjectReviewStatus.REVIEWED


def test_draft_saves_without_reviewing(db):
    _org, pm, senior, project, _m = _scenario(db)
    draft = save_reports_to_evaluation_draft(
        project.id, pm.id, PMEvaluationDraft(impact_statement="WIP"), db, senior
    )
    assert draft.status == ProjectReviewStatus.DRAFT
    row = db.query(ProjectReview).filter_by(project_id=project.id, user_id=pm.id).one()
    assert row.status == ProjectReviewStatus.DRAFT.value
    assert row.reviewer_id == senior.id
    assert row.impact_statement == "WIP"


def test_management_overview_includes_the_pm_row(db):
    org, pm, senior, project, _members = _scenario(db, with_team=1)
    submit_reports_to_evaluation(project.id, pm.id, _payload(), db, senior)
    admin = _user(db, org.id, role="Admin")

    summaries = get_management_overview(db, admin, None)
    assert len(summaries) == 1
    summary = summaries[0]
    # 1 team member + the PM's own row = 2.
    assert summary.total_members == 2
    pm_rows = [m for m in summary.members if m.user_id == pm.id]
    assert len(pm_rows) == 1
    assert pm_rows[0].employee_name.endswith("(PM)")
    assert pm_rows[0].review_status == "reviewed"
    assert summary.reviewed_count == 1  # only the PM's review is done


def test_submitting_the_pm_twice_returns_409(db):
    _org, pm, senior, project, _m = _scenario(db)
    submit_reports_to_evaluation(project.id, pm.id, _payload(), db, senior)
    with pytest.raises(HTTPException) as ei:
        submit_reports_to_evaluation(project.id, pm.id, _payload(), db, senior)
    assert ei.value.status_code == 409


def test_pm_cannot_submit_the_reports_to_evaluation(db):
    """The PM is not their project's reports-to, so they can't author their own
    PM evaluation via the reports-to endpoint."""
    _org, pm, _senior, project, _m = _scenario(db)
    with pytest.raises(HTTPException) as ei:
        submit_reports_to_evaluation(project.id, pm.id, _payload(), db, pm)
    assert ei.value.status_code == 403


def test_pm_cannot_edit_their_own_pm_review(db):
    """Regression guard: the PM is the project's Primary, so update_review's
    is_current_pm branch would otherwise let them rewrite the evaluation their
    reports-to senior wrote about them."""
    _org, pm, senior, project, _m = _scenario(db)
    resp = submit_reports_to_evaluation(project.id, pm.id, _payload(), db, senior)
    with pytest.raises(HTTPException) as ei:
        update_review(resp.id, _payload(), db, pm)
    assert ei.value.status_code == 403


def test_reports_to_can_edit_the_pm_review_they_authored(db):
    _org, pm, senior, project, _m = _scenario(db)
    resp = submit_reports_to_evaluation(project.id, pm.id, _payload(), db, senior)
    edited = _payload()
    edited.impact_statement = "Revised assessment of the PM."
    out = update_review(resp.id, edited, db, senior)
    assert out.impact_statement == "Revised assessment of the PM."
    assert out.reviewer_id == senior.id
