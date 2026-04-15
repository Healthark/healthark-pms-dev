from datetime import date
from app.models.system_settings_models import CycleType

def get_current_cycle_info(current_date: date, cycle_type: CycleType, fiscal_start_month: int = 4):
    month = current_date.month
    # Determine the fiscal year (if month is before April, it's still the previous fiscal year's cycle)
    fiscal_year = current_date.year if month >= fiscal_start_month else current_date.year - 1
    
    # Calculate month index relative to fiscal start (0 to 11)
    # If start is April (4), then April=0, Jan=9, March=11
    relative_month = (month - fiscal_start_month) % 12
    
    if cycle_type == CycleType.QUARTERLY:
        # Q1: 0-2, Q2: 3-5, Q3: 6-8, Q4: 9-11
        q_num = (relative_month // 3) + 1
        return f"{fiscal_year}-Q{q_num}"
        
    elif cycle_type == CycleType.HALF_YEARLY:
        # H1: 0-5, H2: 6-11
        h_num = (relative_month // 6) + 1
        return f"{fiscal_year}-H{h_num}"
        
    else:  
        # ANNUAL fallback (handles CycleType.ANNUAL)
        return f"{fiscal_year}-Annual"