"""
Pure-function tests for the 360-feedback remarks anonymity gating.

No DB, no app, no env. These cover the two helpers that decide whether a
free-text remark is safe to surface:
    - normalize_remark()      trims + collapses blanks to None
    - select_visible_remarks() per-cohort reviewer-threshold gate

The gate mirrors the rating matrix: a cohort's remarks appear ONLY once
that cohort has `min_reviewers_per_cohort` reviewers total, so no single
remark can be pinned to its author.
"""

from app.services.feedback_360_service import (
    normalize_remark,
    select_visible_remarks,
)


class TestNormalizeRemark:
    def test_none_stays_none(self):
        assert normalize_remark(None) is None

    def test_blank_and_whitespace_collapse_to_none(self):
        assert normalize_remark("") is None
        assert normalize_remark("   ") is None
        assert normalize_remark("\n\t  \n") is None

    def test_trims_surrounding_whitespace(self):
        assert normalize_remark("  great mentor  ") == "great mentor"

    def test_preserves_inner_content(self):
        assert normalize_remark("line one\nline two") == "line one\nline two"


THRESHOLD = 3


class TestSelectVisibleRemarks:
    def test_cohort_below_threshold_is_hidden(self):
        # 2 worked-with reviewers (below 3) — their remark is withheld.
        reviews = [
            (True, "helpful"),
            (True, "supportive"),
        ]
        assert select_visible_remarks(reviews, THRESHOLD) == []

    def test_cohort_at_threshold_is_shown(self):
        reviews = [
            (True, "helpful"),
            (True, "supportive"),
            (True, None),  # no remark, but still counts toward the cohort
        ]
        assert select_visible_remarks(reviews, THRESHOLD) == [
            (True, "helpful"),
            (True, "supportive"),
        ]

    def test_each_cohort_gated_independently(self):
        # worked-with has 3 reviewers (shown); not-worked-with has 2 (hidden).
        reviews = [
            (True, "a"),
            (True, "b"),
            (True, "c"),
            (False, "x"),
            (False, "y"),
        ]
        out = select_visible_remarks(reviews, THRESHOLD)
        assert out == [(True, "a"), (True, "b"), (True, "c")]

    def test_both_cohorts_cleared_orders_worked_first(self):
        reviews = [
            (False, "n1"),
            (True, "w1"),
            (False, "n2"),
            (True, "w2"),
            (False, "n3"),
            (True, "w3"),
        ]
        out = select_visible_remarks(reviews, THRESHOLD)
        # Worked-with cohort first, then not-worked-with; insertion order
        # preserved within each cohort.
        assert out == [
            (True, "w1"),
            (True, "w2"),
            (True, "w3"),
            (False, "n1"),
            (False, "n2"),
            (False, "n3"),
        ]

    def test_blank_remarks_dropped_but_still_count(self):
        # 3 reviewers clear the gate, but only one left real text.
        reviews = [
            (True, "  real note  "),
            (True, "   "),
            (True, None),
        ]
        out = select_visible_remarks(reviews, THRESHOLD)
        assert out == [(True, "real note")]

    def test_empty_input(self):
        assert select_visible_remarks([], THRESHOLD) == []
