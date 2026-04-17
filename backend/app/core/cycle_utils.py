from datetime import date
from app.models.system_settings_models import CycleType

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