"""
Pure-data invariants for test-seed.py (the production-test seed).

No DB, no app, no env beyond what importing the models already needs. These
guard the static roster / goal / project / review tables against the exact
bug classes that bit us while authoring the seed: duplicate emails, dangling
mentor references, and users missing from one of the per-user tables.

The seed file has a hyphen in its name, so it's loaded by path rather than
imported as a module.
"""

import importlib.util
from pathlib import Path

import pytest

SEED_PATH = Path(__file__).resolve().parents[1] / "test-seed.py"


@pytest.fixture(scope="module")
def seed():
    spec = importlib.util.spec_from_file_location("test_seed_mod", SEED_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# USER_SPECS layout: (key, name, email, dept, desig, role, is_mgmt, mentor_key)
EXPECTED_MENTORS = {
    "purav": None, "sudeep": None,
    "amol": "purav", "dhaval": "purav",
    "shreshta": "sudeep", "ritu": "sudeep",
    "devanshi": "amol",
    "aakash": "dhaval", "zaahid": "dhaval",
    "divya": "shreshta",
    "riya": "ritu", "shivang": "riya",
    "dhruv": "shivang",
}
EXPECTED_EMAILS = {
    "purav": "drpuravgandhi@healthark.ai", "sudeep": "ski@healthark.ai",
    "amol": "amol@healthark.ai", "dhaval": "dhaval@healthark.ai",
    "shreshta": "shreshta@healthark.ai", "ritu": "ritu@healthark.ai",
    "divya": "divya@healthark.ai", "riya": "riya@healthark.ai",
    "shivang": "shivang@healthark.ai", "dhruv": "dhruv.s@healthark.ai",
    "aakash": "aakash.p@healthark.ai", "zaahid": "zaahid@healthark.ai",
    "devanshi": "devanshi@healthark.ai",
}
EXPECTED_MGMT = {"purav", "sudeep", "amol"}


def _by_key(seed):
    return {s[0]: s for s in seed.USER_SPECS}


class TestRoster:
    def test_thirteen_users(self, seed):
        assert len(seed.USER_SPECS) == 13

    def test_keys_unique(self, seed):
        keys = [s[0] for s in seed.USER_SPECS]
        assert len(keys) == len(set(keys))

    def test_emails_unique(self, seed):
        # The original brief collided Dhaval + Amol on amol@healthark.ai;
        # the DB enforces a unique (org, email) index, so this must hold.
        emails = [s[2] for s in seed.USER_SPECS]
        assert len(emails) == len(set(emails)), "duplicate email in roster"

    def test_emails_match_agreed_values(self, seed):
        actual = {s[0]: s[2] for s in seed.USER_SPECS}
        assert actual == EXPECTED_EMAILS

    def test_all_emails_on_healthark_domain(self, seed):
        assert all(s[2].endswith("@healthark.ai") for s in seed.USER_SPECS)

    def test_management_users_are_admins(self, seed):
        for s in seed.USER_SPECS:
            key, role, is_mgmt = s[0], s[5], s[6]
            if is_mgmt:
                assert role == "Admin", f"{key} is management but not Admin"

    def test_exact_management_set(self, seed):
        mgmt = {s[0] for s in seed.USER_SPECS if s[6]}
        assert mgmt == EXPECTED_MGMT


class TestHierarchy:
    def test_mentor_map_matches_brief(self, seed):
        actual = {s[0]: s[-1] for s in seed.USER_SPECS}
        assert actual == EXPECTED_MENTORS

    def test_mentor_keys_resolve(self, seed):
        keys = {s[0] for s in seed.USER_SPECS}
        for s in seed.USER_SPECS:
            mentor_key = s[-1]
            if mentor_key is not None:
                assert mentor_key in keys, f"{s[0]} → unknown mentor {mentor_key}"

    def test_top_management_has_no_mentor(self, seed):
        by_key = _by_key(seed)
        assert by_key["purav"][-1] is None
        assert by_key["sudeep"][-1] is None

    def test_no_self_mentor(self, seed):
        for s in seed.USER_SPECS:
            assert s[0] != s[-1]

    def test_no_mentor_cycles(self, seed):
        mentors = {s[0]: s[-1] for s in seed.USER_SPECS}
        for start in mentors:
            seen, cur = set(), start
            while cur is not None:
                assert cur not in seen, f"mentor cycle through {cur}"
                seen.add(cur)
                cur = mentors[cur]


class TestGoals:
    def test_every_user_has_a_goal_set(self, seed):
        assert set(seed.GOAL_SETS) == {s[0] for s in seed.USER_SPECS}

    def test_three_states_per_user(self, seed):
        for key, sets in seed.GOAL_SETS.items():
            assert set(sets) == {"approved", "draft", "changes_requested"}, key

    def test_titles_and_descriptions_present(self, seed):
        for key, sets in seed.GOAL_SETS.items():
            for state, spec in sets.items():
                title, desc = spec[0], spec[1]
                assert title.strip(), f"{key}/{state} empty title"
                assert desc.strip(), f"{key}/{state} empty description"

    def test_changes_requested_has_feedback(self, seed):
        for key, sets in seed.GOAL_SETS.items():
            cr = sets["changes_requested"]
            assert len(cr) == 3 and cr[2].strip(), f"{key} changes_requested missing feedback"

    def test_approved_has_progress_notes(self, seed):
        for key, sets in seed.GOAL_SETS.items():
            approved = sets["approved"]
            assert len(approved) == 3 and approved[2].strip(), f"{key} approved missing progress"

    def test_goal_cycle_is_current_fy(self, seed):
        assert seed.GOAL_CYCLE_NAME == "H1 2026"
        assert seed.GOAL_FY_YEAR == 2026
        assert seed.CURRENT_FY_LABEL == "FY26-27"


class TestProjects:
    def test_one_project_per_department(self, seed):
        user_depts = {s[3] for s in seed.USER_SPECS}
        proj_depts = [p[3] for p in seed.PROJECT_SPECS]
        assert len(proj_depts) == len(set(proj_depts)), "duplicate project department"
        assert set(proj_depts) == user_depts, "every department needs exactly one project"

    def test_project_member_keys_resolve(self, seed):
        keys = {s[0] for s in seed.USER_SPECS}
        for code, _name, _desc, _dept, pm, members, reports, secondary in seed.PROJECT_SPECS:
            for k in [pm, *members, reports, secondary]:
                assert k in keys, f"{code} references unknown user {k}"

    def test_pm_not_in_member_list(self, seed):
        for p in seed.PROJECT_SPECS:
            pm, members = p[4], p[5]
            assert pm not in members, f"{p[0]} lists PM as a regular member"

    def test_projects_marked_completed(self, seed):
        assert seed.PROJECT_STATUS_COMPLETED == "completed"

    def test_review_plan_matches_assignments(self, seed):
        # Every reviewed person must be the PM or an assigned member, and
        # every assigned person (PM + members) must be reviewed.
        for code, _n, _d, _dep, pm, members, _r, _s in seed.PROJECT_SPECS:
            plan = seed.PROJECT_REVIEW_PLAN[code]
            assert set(plan) == {pm, *members}, f"{code} review plan / assignment mismatch"

    def test_performance_groups_in_range(self, seed):
        for code, plan in seed.PROJECT_REVIEW_PLAN.items():
            for member, pg in plan.items():
                assert pg in {"1", "2", "3", "4", "5"}, f"{code}/{member} bad pg {pg}"


class TestAnnualReviews:
    def test_every_user_has_an_annual_plan(self, seed):
        assert set(seed.ANNUAL_PLAN) == {s[0] for s in seed.USER_SPECS}

    def test_ratings_in_range(self, seed):
        for key, (_self, _mentor, rating) in seed.ANNUAL_PLAN.items():
            assert 1 <= rating <= 5, f"{key} rating out of range"

    def test_completed_fy_constants(self, seed):
        assert seed.COMPLETED_ANNUAL_CYCLE == "FY25-26"
        # Project reviews are FY-scoped — the cycle tag is the bare FY label,
        # no H1/H2 prefix (one review per employee per project per year).
        assert seed.COMPLETED_PROJECT_CYCLE == "FY25-26"
        assert seed.F360_FY == 2025


class TestFeedback360:
    def test_twelve_question_keys(self, seed):
        # Must match the live registry the API validates against.
        from app.feedback_360.questions import VALID_QUESTION_KEYS
        assert set(seed._F360_KEYS) == set(VALID_QUESTION_KEYS)
        assert len(seed._F360_KEYS) == 12

    def test_all_q_requires_twelve_values(self, seed):
        with pytest.raises(AssertionError):
            seed._all_q([5, 5, 5])
        assert len(seed._all_q([4] * 12)) == 12
