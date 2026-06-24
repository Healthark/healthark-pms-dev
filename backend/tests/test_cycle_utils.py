"""
Pure-function tests for app.core.cycle_utils.

No DB, no app, no env. The active cycle is now a STORED, admin-advanced label
(not date-derived), so these cover parsing the label, advancing it, the
active-cycle-keyed review-window gate, the goal stamp, and the cadence helpers.
"""

import pytest

from app.core.cycle_utils import (
    cycle_keys_for,
    cycles_before,
    extract_fy_label,
    fy_start_year,
    goal_cycle_name_for_active,
    is_review_window_open,
    next_cycle,
    parse_cycle,
)


class TestParseCycle:
    def test_half_yearly(self):
        assert parse_cycle("H1 FY26-27") == ("H1", 2026)
        assert parse_cycle("H2 FY26-27") == ("H2", 2026)

    def test_quarterly(self):
        assert parse_cycle("Q3 FY27-28") == ("Q3", 2027)

    def test_bare_fy_has_no_code(self):
        assert parse_cycle("FY26-27") == (None, 2026)

    def test_legacy_two_digit_form(self):
        assert parse_cycle("H1 FY26") == ("H1", 2026)

    def test_raises_without_fy_token(self):
        with pytest.raises(ValueError):
            parse_cycle("H1")


class TestFyStartYear:
    def test_span_and_bare(self):
        assert fy_start_year("FY26-27") == 2026
        assert fy_start_year("FY26") == 2026


class TestNextCycle:
    def test_half_yearly_h1_to_h2_same_fy(self):
        assert next_cycle("H1 FY26-27", "half_yearly") == "H2 FY26-27"

    def test_half_yearly_h2_rolls_fy(self):
        assert next_cycle("H2 FY26-27", "half_yearly") == "H1 FY27-28"

    def test_quarterly_sequence(self):
        assert next_cycle("Q1 FY26-27", "quarterly") == "Q2 FY26-27"
        assert next_cycle("Q4 FY26-27", "quarterly") == "Q1 FY27-28"

    def test_annual_rolls_fy(self):
        assert next_cycle("FY26-27", "annual") == "FY27-28"

    def test_fy_label_wraps_century(self):
        assert next_cycle("H2 FY99-00", "half_yearly") == "H1 FY00-01"


class TestGoalCycleNameForActive:
    def test_half_yearly(self):
        assert goal_cycle_name_for_active("H1 FY26-27") == "H1 2026"
        assert goal_cycle_name_for_active("H2 FY26-27") == "H2 2026"

    def test_quarter_buckets_to_half(self):
        assert goal_cycle_name_for_active("Q2 FY26-27") == "H1 2026"
        assert goal_cycle_name_for_active("Q3 FY26-27") == "H2 2026"


class TestIsReviewWindowOpen:
    def test_active_cycle_is_open(self):
        assert is_review_window_open("H1", 2026, "H1 FY26-27") is True

    def test_future_cycle_same_fy_is_closed(self):
        assert is_review_window_open("H2", 2026, "H1 FY26-27") is False

    def test_earlier_cycle_backfills_while_active(self):
        # While H2 is active, H1 of the same FY stays open for backfill.
        assert is_review_window_open("H1", 2026, "H2 FY26-27") is True
        assert is_review_window_open("H2", 2026, "H2 FY26-27") is True

    def test_cross_fiscal_year_is_closed(self):
        assert is_review_window_open("H1", 2026, "H1 FY27-28") is False

    def test_quarterly_active_maps_to_half(self):
        # A quarterly active cycle still has a half for goal (H1/H2) windows.
        assert is_review_window_open("H1", 2026, "Q2 FY26-27") is True   # Q1-2 → H1
        assert is_review_window_open("H2", 2026, "Q2 FY26-27") is False
        assert is_review_window_open("H2", 2026, "Q3 FY26-27") is True   # Q3-4 → H2

    def test_annual_active_opens_whole_fy(self):
        assert is_review_window_open("H1", 2026, "FY26-27") is True
        assert is_review_window_open("H2", 2026, "FY26-27") is True


class TestCycleKeyHelpers:
    def test_cycle_keys_for_half(self):
        assert cycle_keys_for("H1") == ("H1", "H2")

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
        assert extract_fy_label("Some weird label") == "Some weird label"
