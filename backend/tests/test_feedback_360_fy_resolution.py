"""
Pure-function tests for 360-feedback fiscal-year resolution.

No DB, no app. These guard the fix where `current_active_fy` must honor
the org's configured `fiscal_start_month` (passed in by the route from
`system_settings`) instead of always using the deployment env default —
otherwise 360 reviews land in a different FY than every other module
whenever an org's fiscal start differs from the env value.
"""

from datetime import date

from app.core.config import settings
from app.services.feedback_360_service import current_active_fy


class TestCurrentActiveFy:
    def test_fiscal_start_month_shifts_the_fy_boundary(self):
        # Same calendar date, different fiscal-year start → different FY.
        # This is the bug the fix guards: 360 used the env month and
        # ignored the org's configured fiscal_start_month.
        d = date(2026, 2, 15)
        # April-start FY: Feb 2026 still belongs to the FY that began
        # April 2025, so its start year is 2025.
        assert current_active_fy(d, fiscal_start_month=4) == 2025
        # Calendar-year FY (January start): Feb 2026 belongs to FY 2026.
        assert current_active_fy(d, fiscal_start_month=1) == 2026

    def test_july_start_vs_april_start(self):
        d = date(2026, 5, 1)
        # April-start: May 2026 is inside FY26-27 (start year 2026).
        assert current_active_fy(d, fiscal_start_month=4) == 2026
        # July-start: May 2026 still belongs to the FY that began
        # July 2025 (start year 2025).
        assert current_active_fy(d, fiscal_start_month=7) == 2025

    def test_falls_back_to_env_fiscal_start_month_when_unset(self):
        # Omitting the argument must reproduce the deployment env default
        # exactly — backward-compatible with callers that can't supply
        # the org's setting.
        d = date(2026, 2, 15)
        assert current_active_fy(d) == current_active_fy(
            d, fiscal_start_month=settings.FISCAL_START_MONTH
        )
