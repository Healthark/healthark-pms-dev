"""
Pure-function tests for app.core.cycle_utils.

No DB, no app, no env — these run in CI without setup. They cover the calendar
math that determines which fiscal year / half / quarter "today" belongs to,
and the review-window backfill rule.
"""

from datetime import date

from app.core.cycle_utils import (
    current_half_and_fy,
    current_quarter_and_fy,
    cycle_keys_for,
    cycles_before,
    extract_fy_label,
    is_review_window_open,
)


class TestCurrentHalfAndFy:
    def test_h1_h2_boundary_at_october_first(self):
        # Last day of H1 is September 30; H2 begins October 1.
        assert current_half_and_fy(date(2026, 9, 30), 4) == ("H1", 2026)
        assert current_half_and_fy(date(2026, 10, 1), 4) == ("H2", 2026)

    def test_fy_rollover_at_april_first(self):
        # March 2027 is still FY26-27.
        assert current_half_and_fy(date(2027, 3, 31), 4) == ("H2", 2026)
        # April 2027 flips to FY27-28.
        assert current_half_and_fy(date(2027, 4, 1), 4) == ("H1", 2027)

    def test_january_calendar_year_is_previous_fiscal_year(self):
        # Jan 2027 belongs to FY26-27 (April 2026 → March 2027).
        assert current_half_and_fy(date(2027, 1, 15), 4) == ("H2", 2026)


class TestCurrentQuarterAndFy:
    def test_quarter_boundaries(self):
        assert current_quarter_and_fy(date(2026, 4, 1), 4) == ("Q1", 2026)
        assert current_quarter_and_fy(date(2026, 7, 1), 4) == ("Q2", 2026)
        assert current_quarter_and_fy(date(2026, 10, 1), 4) == ("Q3", 2026)
        assert current_quarter_and_fy(date(2027, 1, 1), 4) == ("Q4", 2026)
        assert current_quarter_and_fy(date(2027, 4, 1), 4) == ("Q1", 2027)


class TestReviewWindowOpen:
    def test_current_cycle_is_open(self):
        assert is_review_window_open("H1", 2026, date(2026, 5, 1)) is True

    def test_future_cycle_same_fy_is_closed(self):
        assert is_review_window_open("H2", 2026, date(2026, 5, 1)) is False

    def test_past_cycle_same_fy_remains_open_for_backfill(self):
        # H1 should remain backfillable while we're in H2 of the same FY.
        assert is_review_window_open("H1", 2026, date(2026, 11, 1)) is True

    def test_cross_fiscal_year_backfill_is_blocked(self):
        # Once FY26-27 ends, you cannot retroactively open its H1.
        assert is_review_window_open("H1", 2026, date(2027, 5, 1)) is False

    def test_quarterly_windows_follow_same_rule(self):
        assert is_review_window_open("Q3", 2026, date(2026, 11, 1)) is True
        assert is_review_window_open("Q4", 2026, date(2026, 11, 1)) is False
        # Backfill within FY: Q1 still open in Q4.
        assert is_review_window_open("Q1", 2026, date(2027, 2, 1)) is True


class TestCycleKeyHelpers:
    def test_cycle_keys_for_half(self):
        assert cycle_keys_for("H1") == ("H1", "H2")
        assert cycle_keys_for("H2") == ("H1", "H2")

    def test_cycle_keys_for_quarterly(self):
        assert cycle_keys_for("Q3") == ("Q1", "Q2", "Q3", "Q4")

    def test_cycles_before(self):
        assert cycles_before("H1") == ()
        assert cycles_before("H2") == ("H1",)
        assert cycles_before("Q3") == ("Q1", "Q2")


class TestExtractFyLabel:
    def test_spans_2_digit_form(self):
        assert extract_fy_label("H1 FY26-27") == "FY26-27"
        assert extract_fy_label("Q3 FY27-28") == "FY27-28"

    def test_bare_fy_returned_unchanged(self):
        assert extract_fy_label("FY26-27") == "FY26-27"

    def test_legacy_single_year_form(self):
        assert extract_fy_label("H1 FY26") == "FY26"

    def test_unparseable_input_returned_as_is(self):
        # Defensive fallback when the cycle name doesn't contain an FY token.
        assert extract_fy_label("Some weird label") == "Some weird label"
