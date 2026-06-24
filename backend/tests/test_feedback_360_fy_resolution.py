"""
Pure-function test for 360-feedback fiscal-year resolution.

The active cycle is admin-advanced (not date-derived), so current_active_fy
parses the stored active_cycle_name into its fiscal-year start. This keeps
360 on the same FY every other module reads from the same stored label.
"""

from app.services.feedback_360_service import current_active_fy


class TestCurrentActiveFy:
    def test_parses_fy_from_active_cycle(self):
        assert current_active_fy("H1 FY26-27") == 2026
        assert current_active_fy("H2 FY26-27") == 2026
        assert current_active_fy("H1 FY27-28") == 2027

    def test_bare_fy_label(self):
        assert current_active_fy("FY25-26") == 2025
