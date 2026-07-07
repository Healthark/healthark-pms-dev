"""
Secondary evaluator: draft anytime, submit only after the PM.

A Secondary evaluator can start writing (and save a draft of) their Impact
Statement for a team member BEFORE the PM has evaluated them — the queue lists
every member they're bound to, and a draft lazily creates a reviewer-less
PENDING parent review so the impact has somewhere to hang. But they may only
*submit* once the member's PM evaluation is in (the ProjectReview is REVIEWED).
This mirrors the Annual-Goals mentor-review rule ("draft now, submit after the
prior review lands").

Guarded here:
  - queue lists members before the PM starts (placeholder, review_id=None,
    pm_submitted=False),
  - draft before the PM creates a reviewer-less PENDING review + draft row,
  - submit before the PM is blocked (400) and persists nothing,
  - the early draft never leaks to others until the PM finalizes (REVIEWED),
  - the PM's evaluate promotes the placeholder + preserves the draft, after
    which the Secondary can submit,
  - auth guards (non-secondary, self, non-member, ineligible, completed) still
    fire ahead of the PM gate.

Routes are plain functions, so we call them directly against an in-memory
SQLite session (mirrors test_project_multi_pm_routing.py).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_review_routes import (
    get_review,
    get_secondary_evaluation_queue,
    save_secondary_draft,
    submit_pm_evaluation,
    submit_secondary_evaluation,
    update_secondary_evaluation,
)
from app.core.database import Base
from app.models.competency_models import Competency
from app.models.organization_models import Organization
from app.models.project_models import (
    PROJECT_STATUS_ACTIVE,
    PROJECT_STATUS_COMPLETED,
    Project,
    ProjectAssignment,
)
from app.models.project_review_models import (
    EvaluatorStatus,
    PerformanceGroup,
    ProjectReview,
    ProjectReviewEvaluator,
    ProjectReviewStatus,
)
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.project_review_schemas import (
    PMEvaluationSubmit,
    SecondaryEvalDraft,
    SecondaryEvalSubmit,
)

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


def _pm_payload():
    return PMEvaluationSubmit(
        performance_group=next(iter(PerformanceGroup)),
        impact_statement="ok",
        comment_task_execution="ok",
        comment_ownership="ok",
        comment_project_management="ok",
        comment_client_deliverables="ok",
        comment_communication="ok",
        comment_mentoring="ok",
        comment_competency_skills="ok",
    )


def _org_cycle(db):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=ACTIVE_CYCLE))
    return org


def _project(db, org, *, reports_to=None, secondary=None, multi_pm=False,
             status=PROJECT_STATUS_ACTIVE, review_eligible=True):
    _n["i"] += 1
    project = Project(
        org_id=org.id,
        project_code=f"SEC-{_n['i']}",
        name="Proj",
        status=status,
        multi_pm_enabled=multi_pm,
        review_eligible=review_eligible,
        reports_to_id=reports_to.id if reports_to else None,
        secondary_evaluator_id=secondary.id if secondary else None,
    )
    db.add(project)
    db.flush()
    return project


def _assign(db, org, project, user, *, primary=False, manager=None,
            secondary=None):
    # NOTE: review scope is a PROJECT-level flag (Project.review_eligible) on
    # master; the per-member `review_included` column was removed.
    a = ProjectAssignment(
        org_id=org.id,
        project_id=project.id,
        user_id=user.id,
        evaluator_type="Primary" if primary else None,
        manager_id=manager.id if manager else None,
        secondary_evaluator_id=secondary.id if secondary else None,
        is_deleted=False,
    )
    db.add(a)
    db.flush()
    return a


_DEFAULT_COMPETENCY_KEYS = [
    "task_execution", "ownership", "project_management",
    "client_deliverables", "communication", "mentoring", "competency_skills",
]


def _seed_default_competencies(db, org_id):
    """Seed the org's 7 default reviewable competencies so a PM evaluation sent
    via the legacy fixed comment_* fields round-trips through the comments JSON
    (the sole source of truth) and reconstructs on read."""
    for i, key in enumerate(_DEFAULT_COMPETENCY_KEYS, start=1):
        db.add(Competency(
            org_id=org_id, department_id=None, level=None, key=key,
            label=key.replace("_", " ").title(), display_order=i,
            is_reviewable=True, is_deleted=False,
        ))
    db.flush()


def _single_pm_scenario(db):
    """single-PM project: PM + two members, an outside project-level Secondary.
    Returns (org, project, pm, m1, m2, senior, sec)."""
    org = _org_cycle(db)
    pm = _user(db, org.id)
    m1 = _user(db, org.id)
    m2 = _user(db, org.id)
    senior = _user(db, org.id)
    sec = _user(db, org.id)  # NOT a team member
    project = _project(db, org, reports_to=senior, secondary=sec)
    _assign(db, org, project, pm, primary=True)
    _assign(db, org, project, m1)
    _assign(db, org, project, m2)
    _seed_default_competencies(db, org.id)
    db.commit()
    return org, project, pm, m1, m2, senior, sec


# ── Queue lists members before the PM starts ──────────────────────────

def test_secondary_queue_lists_members_before_pm_starts(db):
    _org, project, pm, m1, m2, _senior, sec = _single_pm_scenario(db)

    cards = get_secondary_evaluation_queue(db, sec)
    # Project-level secondary covers every member — the PM included (the
    # reports-to senior reviews the PM, the secondary adds a perspective).
    assert {c.user_id for c in cards} == {pm.id, m1.id, m2.id}
    # No PM review rows exist yet → every card is an active-cycle placeholder,
    # and the PM hasn't submitted so the secondary can't submit yet.
    for c in cards:
        assert c.review_id is None
        assert c.cycle == ACTIVE_CYCLE
        assert c.review_status == "pending"
        assert c.has_draft_content is False
        assert c.pm_submitted is False


def test_secondary_who_is_not_on_the_team_still_gets_the_queue(db):
    """The reported bug: an outside employee named Secondary saw an empty tab
    until the PM acted. They must see the members regardless."""
    _org, _project, _pm, m1, _m2, _senior, sec = _single_pm_scenario(db)
    cards = get_secondary_evaluation_queue(db, sec)
    assert m1.id in {c.user_id for c in cards}


# ── Draft before the PM works; submit is blocked ──────────────────────

def test_secondary_draft_before_pm_shows_as_draft(db):
    _org, project, _pm, m1, _m2, _senior, sec = _single_pm_scenario(db)

    save_secondary_draft(
        project.id, m1.id,
        SecondaryEvalDraft(impact_statement="WIP thoughts"), db, sec,
    )
    # The draft lazily created a reviewer-less PENDING parent review.
    review = db.query(ProjectReview).filter(
        ProjectReview.project_id == project.id, ProjectReview.user_id == m1.id,
    ).one()
    assert review.status == ProjectReviewStatus.PENDING.value
    assert review.reviewer_id is None

    card = next(c for c in get_secondary_evaluation_queue(db, sec) if c.user_id == m1.id)
    assert card.review_status == "pending"        # a draft is not "submitted"
    assert card.has_draft_content is True
    assert card.existing_impact == "WIP thoughts"
    assert card.pm_submitted is False             # PM still hasn't submitted


def test_secondary_cannot_submit_before_pm(db):
    """The new gate: submitting before the PM's evaluation is in → 400, and
    nothing is persisted (no evaluator row, no placeholder review)."""
    _org, project, _pm, m1, _m2, _senior, sec = _single_pm_scenario(db)

    with pytest.raises(HTTPException) as ei:
        submit_secondary_evaluation(
            project.id, m1.id, SecondaryEvalSubmit(impact_statement="early"), db, sec,
        )
    assert ei.value.status_code == 400

    assert db.query(ProjectReviewEvaluator).count() == 0
    assert db.query(ProjectReview).count() == 0
    card = next(c for c in get_secondary_evaluation_queue(db, sec) if c.user_id == m1.id)
    assert card.review_status == "pending"
    assert card.pm_submitted is False


def test_secondary_can_submit_after_pm(db):
    _org, project, pm, m1, _m2, _senior, sec = _single_pm_scenario(db)
    # PM evaluates first → review REVIEWED, which unlocks the secondary submit.
    submit_pm_evaluation(project.id, m1.id, _pm_payload(), db, pm)

    out = submit_secondary_evaluation(
        project.id, m1.id, SecondaryEvalSubmit(impact_statement="Great work."), db, sec,
    )
    assert out.evaluator_id == sec.id
    assert out.status == EvaluatorStatus.SUBMITTED.value
    assert out.impact_statement == "Great work."

    card = next(c for c in get_secondary_evaluation_queue(db, sec) if c.user_id == m1.id)
    assert card.pm_submitted is True
    assert card.review_status == "submitted"


def test_secondary_can_read_pm_review_once_reviewed(db):
    """The Secondary's reference view: once the PM submits (REVIEWED), the
    Secondary may fetch the PM's finalized review — all 7 competency comments
    and the PM's overall impact — via get_review. This is the contract the
    Impact modal's read-only "Project Manager's Review" block depends on.

    The rating is deliberately NOT taken from get_review: its performance_group
    runs through the employee-facing visibility gate, which hides it here (no
    year override enables it). The queue card carries the rating instead —
    reviewer-visible the moment the review is REVIEWED — so both the accessible
    comments and the card-sourced rating are asserted together."""
    _org, project, pm, m1, _m2, _senior, sec = _single_pm_scenario(db)

    payload = PMEvaluationSubmit(
        performance_group=PerformanceGroup.RATING_4,
        impact_statement="Owned the migration end to end.",
        comment_task_execution="Shipped the parser early.",
        comment_ownership="Took full ownership.",
        comment_project_management="Managed risk well.",
        comment_client_deliverables="Client-ready decks.",
        comment_communication="Clear updates.",
        comment_mentoring="Coached two juniors.",
        comment_competency_skills="Deep SQL skills.",
    )
    submit_pm_evaluation(project.id, m1.id, payload, db, pm)

    review = db.query(ProjectReview).filter(
        ProjectReview.project_id == project.id, ProjectReview.user_id == m1.id,
    ).one()

    # The Secondary reads the PM's finalized review (comments + impact + author).
    as_sec = get_review(review.id, db, sec)
    assert as_sec.status == ProjectReviewStatus.REVIEWED
    assert as_sec.comment_task_execution == "Shipped the parser early."
    assert as_sec.comment_competency_skills == "Deep SQL skills."
    assert as_sec.impact_statement == "Owned the migration end to end."
    assert as_sec.reviewer_name == pm.full_name
    # Rating is gated here (no override) — the modal doesn't rely on this field.
    assert as_sec.performance_group is None

    # The rating source of truth for the Secondary's view is the queue card,
    # reviewer-visible once REVIEWED regardless of the employee-facing toggle.
    card = next(c for c in get_secondary_evaluation_queue(db, sec) if c.user_id == m1.id)
    assert card.pm_submitted is True
    assert card.performance_group == "4"


def test_double_submit_conflicts(db):
    _org, project, pm, m1, _m2, _senior, sec = _single_pm_scenario(db)
    submit_pm_evaluation(project.id, m1.id, _pm_payload(), db, pm)  # PM first
    submit_secondary_evaluation(
        project.id, m1.id, SecondaryEvalSubmit(impact_statement="one"), db, sec,
    )
    with pytest.raises(HTTPException) as ei:
        submit_secondary_evaluation(
            project.id, m1.id, SecondaryEvalSubmit(impact_statement="two"), db, sec,
        )
    assert ei.value.status_code == 409


# ── No early leak; PM promotes the placeholder ────────────────────────

def test_early_draft_hidden_from_others(db):
    _org, project, pm, m1, _m2, _senior, sec = _single_pm_scenario(db)
    # Pre-PM, the only write the secondary can make is a draft.
    save_secondary_draft(
        project.id, m1.id, SecondaryEvalDraft(impact_statement="secret"), db, sec,
    )

    review = db.query(ProjectReview).filter(
        ProjectReview.project_id == project.id, ProjectReview.user_id == m1.id,
    ).one()

    # The rated employee cannot open a still-pending review at all.
    with pytest.raises(HTTPException) as ei:
        get_review(review.id, db, m1)
    assert ei.value.status_code == 403

    # The PM may view it, but the secondary's draft is hidden while pending.
    as_pm = get_review(review.id, db, pm)
    assert as_pm.secondary_evaluations == []

    # The author (secondary) always sees their own draft.
    as_author = get_review(review.id, db, sec)
    assert [e.impact_statement for e in as_author.secondary_evaluations] == ["secret"]


def test_pm_evaluate_promotes_placeholder_and_preserves_impact(db):
    _org, project, pm, m1, _m2, _senior, sec = _single_pm_scenario(db)
    # Secondary drafts before the PM (submit is blocked until the PM is in).
    save_secondary_draft(
        project.id, m1.id, SecondaryEvalDraft(impact_statement="kept"), db, sec,
    )

    # PM evaluates the same member → promotes the PENDING row to REVIEWED.
    resp = submit_pm_evaluation(project.id, m1.id, _pm_payload(), db, pm)
    assert resp.status == ProjectReviewStatus.REVIEWED
    assert resp.reviewer_id == pm.id

    review = db.query(ProjectReview).filter(
        ProjectReview.project_id == project.id, ProjectReview.user_id == m1.id,
    ).one()
    assert review.status == ProjectReviewStatus.REVIEWED.value

    # The draft survived the promotion; now the secondary may submit it.
    submit_secondary_evaluation(
        project.id, m1.id, SecondaryEvalSubmit(impact_statement="kept"), db, sec,
    )
    as_pm = get_review(review.id, db, pm)
    assert [e.impact_statement for e in as_pm.secondary_evaluations] == ["kept"]

    # Editing the submitted impact still works after finalization.
    update_secondary_evaluation(
        project.id, m1.id, SecondaryEvalSubmit(impact_statement="edited"), db, sec,
    )
    as_pm2 = get_review(review.id, db, pm)
    assert [e.impact_statement for e in as_pm2.secondary_evaluations] == ["edited"]


# ── Authorization guards (fire ahead of the PM gate) ──────────────────

def test_non_secondary_cannot_submit(db):
    _org, project, _pm, m1, _m2, _senior, _sec = _single_pm_scenario(db)
    other = _user(db, project.org_id)  # not the secondary
    with pytest.raises(HTTPException) as ei:
        submit_secondary_evaluation(
            project.id, m1.id, SecondaryEvalSubmit(impact_statement="x"), db, other,
        )
    assert ei.value.status_code == 403


def test_secondary_cannot_target_a_non_member(db):
    """single-PM secondary is project-level, so _is_member_secondary passes for
    any user_id — the assignment check must still reject a non-member."""
    _org, project, _pm, _m1, _m2, _senior, sec = _single_pm_scenario(db)
    outsider = _user(db, project.org_id)  # not assigned to the project
    with pytest.raises(HTTPException) as ei:
        submit_secondary_evaluation(
            project.id, outsider.id, SecondaryEvalSubmit(impact_statement="x"), db, sec,
        )
    assert ei.value.status_code == 404


def test_ineligible_project_is_not_queued_and_cannot_be_written(db):
    # Review scope is project-level on master: an ineligible project drops the
    # WHOLE team from every review surface, including the secondary queue.
    org = _org_cycle(db)
    pm = _user(db, org.id)
    member = _user(db, org.id)
    sec = _user(db, org.id)
    project = _project(db, org, secondary=sec, review_eligible=False)
    _assign(db, org, project, pm, primary=True)
    _assign(db, org, project, member)
    db.commit()

    assert member.id not in {c.user_id for c in get_secondary_evaluation_queue(db, sec)}
    with pytest.raises(HTTPException) as ei:
        submit_secondary_evaluation(
            project.id, member.id, SecondaryEvalSubmit(impact_statement="x"), db, sec,
        )
    assert ei.value.status_code == 403


def test_cannot_start_draft_on_completed_project(db):
    # Draft is the only pre-PM write; on a completed project starting a fresh
    # impact (which would create a new review row) 409s. Submit can't reach a
    # completed project either (no REVIEWED review exists to submit against).
    org = _org_cycle(db)
    pm = _user(db, org.id)
    member = _user(db, org.id)
    sec = _user(db, org.id)
    project = _project(db, org, secondary=sec, status=PROJECT_STATUS_COMPLETED)
    _assign(db, org, project, pm, primary=True)
    _assign(db, org, project, member)
    db.commit()

    with pytest.raises(HTTPException) as ei:
        save_secondary_draft(
            project.id, member.id, SecondaryEvalDraft(impact_statement="x"), db, sec,
        )
    assert ei.value.status_code == 409


# ── multi-PM: per-member secondary drafts, then submits after the PM ──

def test_multi_pm_per_member_secondary_drafts_then_submits(db):
    org = _org_cycle(db)
    pm = _user(db, org.id)
    member = _user(db, org.id)
    senior = _user(db, org.id)
    sec = _user(db, org.id)
    project = _project(db, org, reports_to=senior, multi_pm=True)
    _assign(db, org, project, pm, primary=True)
    _assign(db, org, project, member, manager=pm, secondary=sec)
    db.commit()

    # sec sees only their member, before any PM review exists.
    cards = get_secondary_evaluation_queue(db, sec)
    assert [c.user_id for c in cards] == [member.id]
    assert cards[0].review_id is None
    assert cards[0].pm_submitted is False

    # Draft works before the PM; submit is blocked.
    save_secondary_draft(
        project.id, member.id, SecondaryEvalDraft(impact_statement="wip"), db, sec,
    )
    with pytest.raises(HTTPException) as ei:
        submit_secondary_evaluation(
            project.id, member.id, SecondaryEvalSubmit(impact_statement="ok"), db, sec,
        )
    assert ei.value.status_code == 400

    # The member's PM (their manager) evaluates → submit unlocks.
    submit_pm_evaluation(project.id, member.id, _pm_payload(), db, pm)
    out = submit_secondary_evaluation(
        project.id, member.id, SecondaryEvalSubmit(impact_statement="ok"), db, sec,
    )
    assert out.evaluator_id == sec.id
    assert out.status == EvaluatorStatus.SUBMITTED.value
