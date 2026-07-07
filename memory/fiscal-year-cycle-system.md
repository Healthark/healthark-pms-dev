---
name: fiscal-year-cycle-system
description: How Healthark PMS models fiscal years, cycles, and review windows
metadata:
  type: reference
---

Fiscal year starts April (`FISCAL_START_MONTH=4`). Cycle logic lives in `backend/app/core/cycle_utils.py`; frontend mirror in `frontend/src/utils/fy.ts`.

- Active cycle is a STORED admin-advanced value (`SystemSettings.active_cycle_name`, e.g. "H1 FY26-27"), not calendar-derived. Advanced via admin cycle rollout endpoints; logged in `CycleRolloutLog`.
- Cadences share one column family: annual (bare FY), half_yearly (H1/H2), quarterly (Q1-Q4). Quarterly folds into halves for goals (Q1-2→H1, Q3-4→H2).
- Cycle-string shapes differ by entity (a known footgun): annual goals stamp `cycle_name` as "H1 2026" (4-digit fiscal YEAR, not FY token); annual reviews store bare FY "FY26-27"; project reviews store "H1 FY26-27". `cycle_utils` has resolvers (`_fy_label_of_*`, `_half_label_of_*`) to normalize.
- `is_review_window_open`: same-FY required + target cycle at-or-before active cycle (backfill allowed).

See [[project-overview]] for the two-tier override gating that sits on top of this.
