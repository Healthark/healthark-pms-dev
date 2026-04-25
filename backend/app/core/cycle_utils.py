from datetime import date, datetime
from app.models.system_settings_models import CycleType


def get_goal_cycle_name(created_at: datetime, fiscal_start_month: int = 4) -> str:
    """
    Derive the half-yearly cycle label for an annual goal from its creation timestamp.

    Returns "H1 YYYY" or "H2 YYYY" where YYYY is the 4-digit fiscal start year.

    Examples (fiscal_start_month=4, Indian FY):
        April 2026    → "H1 2026"   (H1 FY26: Apr–Sep 2026)
        October 2026  → "H2 2026"   (H2 FY26: Oct 2026–Mar 2027)
        February 2027 → "H2 2026"   (still H2 FY26)
        October 2025  → "H2 2025"   (H2 FY25: Oct 2025–Mar 2026)
    """
    month = created_at.month
    year = created_at.year
    fiscal_year = year if month >= fiscal_start_month else year - 1
    relative_month = (month - fiscal_start_month) % 12
    h_num = (relative_month // 6) + 1
    return f"H{h_num} {fiscal_year}"


def extract_fy_label(cycle_name: str) -> str:
    """
    Extract the bare fiscal-year label from any cycle name.

    The active_cycle_name on SystemSettings follows the cadence of the org's
    review cycle (e.g. "H1 FY26-27", "Q2 FY26-27"), but annual goals belong
    to a full fiscal year, not a half or quarter.  This helper strips the
    period prefix so the goal is stamped with just the year it belongs to.

        "H1 FY26-27"  →  "FY26-27"
        "Q3 FY27-28"  →  "FY27-28"
        "FY26-27"     →  "FY26-27"   (already bare — returned unchanged)
        "H1 FY26"     →  "FY26"      (legacy 2-digit form, still tolerated)
    """
    for token in cycle_name.upper().split():
        if token.startswith("FY"):
            return token
    return cycle_name  # Fallback: return as-is if pattern not found


def get_current_cycle_info(current_date: date, cycle_type: CycleType, fiscal_start_month: int = 4) -> str:
    """
    Returns the cycle name in the canonical format used across the app:
      half_yearly → "H1 FY26-27"   (April–September 2026, FY 2026-2027)
      quarterly   → "Q1 FY26-27"   (April–June 2026)
      annual      → "FY26-27"

    The FY token spells out the spanning fiscal year (e.g. FY26-27 = April 2026
    through March 2027) so the display is unambiguous regardless of when in the
    calendar year you read it.
    Example: fiscal_start_month=4, today=April 2026 → FY26-27 (starts April 2026).
    """
    month = current_date.month
    fiscal_year = current_date.year if month >= fiscal_start_month else current_date.year - 1
    fy_label = _format_fy_span(fiscal_year)  # e.g. 2026 → "FY26-27"

    relative_month = (month - fiscal_start_month) % 12

    if cycle_type == CycleType.QUARTERLY:
        q_num = (relative_month // 3) + 1
        return f"Q{q_num} {fy_label}"

    elif cycle_type == CycleType.HALF_YEARLY:
        h_num = (relative_month // 6) + 1
        return f"H{h_num} {fy_label}"

    else:
        return fy_label


def _format_fy_span(fiscal_year: int) -> str:
    """Render the FY token as a spanning two-year window: 2026 → 'FY26-27'.

    Wraps year-mod-100 cleanly across century boundaries (FY99 → FY99-00).
    """
    a = fiscal_year % 100
    b = (fiscal_year + 1) % 100
    return f"FY{a:02d}-{b:02d}"