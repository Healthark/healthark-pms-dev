from datetime import date
from app.models.system_settings_models import CycleType


def extract_fy_label(cycle_name: str) -> str:
    """
    Extract the bare fiscal-year label from any cycle name.

    The active_cycle_name on SystemSettings follows the cadence of the org's
    review cycle (e.g. "H1 FY26", "Q2 FY26"), but yearly goals belong to a
    full fiscal year, not a half or quarter.  This helper strips the period
    prefix so the goal is stamped with just the year it belongs to.

        "H1 FY26"  →  "FY26"
        "Q3 FY27"  →  "FY27"
        "FY26"     →  "FY26"   (already bare — returned unchanged)
    """
    for token in cycle_name.upper().split():
        if token.startswith("FY"):
            return token
    return cycle_name  # Fallback: return as-is if pattern not found


def get_current_cycle_info(current_date: date, cycle_type: CycleType, fiscal_start_month: int = 4) -> str:
    """
    Returns the cycle name in the canonical format used across the app:
      half_yearly → "H1 FY26"   (April–September 2026)
      quarterly   → "Q1 FY26"   (April–June 2026)
      annual      → "FY26"

    FY is named for the calendar year in which it STARTS (fiscal_start_month).
    Example: fiscal_start_month=4, today=April 2026 → FY26 (starts April 2026).
    """
    month = current_date.month
    fiscal_year = current_date.year if month >= fiscal_start_month else current_date.year - 1
    fy_short = str(fiscal_year)[-2:]  # e.g. 2026 → "26" (FY named for the year it starts)

    relative_month = (month - fiscal_start_month) % 12

    if cycle_type == CycleType.QUARTERLY:
        q_num = (relative_month // 3) + 1
        return f"Q{q_num} FY{fy_short}"

    elif cycle_type == CycleType.HALF_YEARLY:
        h_num = (relative_month // 6) + 1
        return f"H{h_num} FY{fy_short}"

    else:
        return f"FY{fy_short}"