"""Pure-function tests for the FY/half period-label resolvers that key the
split override system (annual review per FY, goals/project per half)."""
from app.core.cycle_utils import _half_label_of_cycle_string, canonical_period_label


class TestHalfLabel:
    def test_goal_stamp(self):
        # Goals stamp "H1 2026"/"H2 2026" → canonical half label.
        assert _half_label_of_cycle_string("H1 2026") == "H1 FY26-27"
        assert _half_label_of_cycle_string("H2 2026") == "H2 FY26-27"

    def test_project_cycle(self):
        assert _half_label_of_cycle_string("H1 FY26-27") == "H1 FY26-27"
        # Quarterly codes fold into halves.
        assert _half_label_of_cycle_string("Q3 FY26-27") == "H2 FY26-27"

    def test_bare_fy_or_missing_has_no_half(self):
        assert _half_label_of_cycle_string("FY26-27") is None
        assert _half_label_of_cycle_string(None) is None


class TestCanonicalPeriod:
    def test_fy_label(self):
        assert canonical_period_label("FY26-27") == "FY26-27"

    def test_half_label(self):
        assert canonical_period_label("H1 FY26-27") == "H1 FY26-27"
        assert canonical_period_label("h2 fy26-27") == "H2 FY26-27"

    def test_invalid(self):
        assert canonical_period_label("garbage") is None
        assert canonical_period_label(None) is None
