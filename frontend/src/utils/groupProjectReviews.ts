/**
 * groupProjectReviews — collapse a flat ProjectReviewResponse[] into one
 * row per (employee, project, FY) for the read-only "All Reviews" view.
 *
 * The flat shape (one DB row per cycle) stacks the same person under the
 * same project 2-4 times per year, which both wastes vertical space and
 * forces the reader to mentally re-group. Grouping collapses those rows
 * into a single line with a chip strip showing per-cycle progress.
 *
 * Ported from the Miltenyi PMS. Healthark's ProjectReviewResponse exposes
 * `reviewer_name` (the primary evaluator who filed the review) rather
 * than a dedicated `pm_name`, so the grouped row carries `reviewer_name`.
 * Pure — no React, no fetch.
 */

import type { ProjectReviewResponse } from "../services/project-review.service";
import type { CycleType } from "../services/system-settings.service";
import { extractCyclePeriod, fyTokenToStartYear } from "./fy";

/** Visual states a chip can render as.
 *
 * - `reviewed` — DB row exists, status=reviewed. Click opens detail modal.
 * - `pending`  — PM still owes it: row exists with status=pending, OR no
 *                row exists yet for a past/active cycle in the current FY.
 *                Click opens the detail modal IF a row exists.
 * - `upcoming` — Cycle hasn't begun yet (future period this FY, or any
 *                period of a future FY). Not clickable.
 */
export type CycleChipState = "reviewed" | "pending" | "upcoming";

export interface CycleSlot {
  /** Period prefix used by the org (`Q1`..`Q4` / `H1`/`H2`). Empty
   *  string for annual cadence orgs whose cycles are bare FY tokens. */
  readonly period: string;
  /** Full composite cycle name (e.g. "Q3 FY26-27" / "FY26-27"). */
  readonly cycleName: string;
  /** DB row when one exists for this slot. Null for pending/upcoming. */
  readonly review: ProjectReviewResponse | null;
  readonly state: CycleChipState;
}

/** One row in the grouped table — a single (employee, project, FY) triple. */
export interface GroupedReviewRow {
  /** Stable React key. */
  readonly key: string;
  readonly user_id: number;
  readonly project_id: number;
  /** Fiscal start year (e.g. 2026 → FY 2026-27). */
  readonly fy_year: number;
  readonly employee_name: string;
  readonly project_name: string;
  readonly project_code: string;
  /** Reviewer (primary evaluator) — same value across every cycle in
   *  this group, so it's lifted to the row. Null until someone reviews. */
  readonly reviewer_name: string | null;
  /** Cycle slots in calendar order (Q1 / H1 first). For past FYs contains
   *  only slots that have an existing DB row; for the current/future FY
   *  contains the full cadence with placeholders for cycles without rows. */
  readonly slots: readonly CycleSlot[];
  /** Number of slots with state=reviewed. */
  readonly reviewedCount: number;
  /** Denominator for the progress fraction. Equals slots.length. */
  readonly totalSlots: number;
}

/** Ordered period list per cadence — drives slot enumeration order and
 *  the "is cycle X past / active / future" comparison via array index. */
const PERIODS_BY_CYCLE_TYPE: Record<CycleType, readonly string[]> = {
  annual: [""],
  half_yearly: ["H1", "H2"],
  quarterly: ["Q1", "Q2", "Q3", "Q4"],
};

/**
 * Group a flat list of project reviews into per-(employee, project, FY)
 * rows.
 *
 * @param reviews     Flat list from `/project-reviews/all`.
 * @param cycleType   Org cadence; determines how many slots each group
 *                    renders for current/future FYs. Null → existing rows
 *                    only (defensive fallback while settings load).
 * @param activeCycle `settings.active_cycle_name` — used to split empty
 *                    slots into `pending` (already arrived) vs `upcoming`.
 */
export function groupProjectReviews(
  reviews: readonly ProjectReviewResponse[],
  cycleType: CycleType | null,
  activeCycle: string | null,
): GroupedReviewRow[] {
  const periods = cycleType ? PERIODS_BY_CYCLE_TYPE[cycleType] : null;
  const activePeriod = activeCycle ? extractCyclePeriod(activeCycle) ?? "" : null;
  const activeFyYear = activeCycle ? fyTokenToStartYear(activeCycle) : null;
  const activePeriodIdx =
    periods && activePeriod !== null ? periods.indexOf(activePeriod) : -1;

  // ── Step 1: bucket reviews by (user_id, project_id, fy_year) ─────
  const buckets = new Map<string, ProjectReviewResponse[]>();
  for (const r of reviews) {
    const fy = r.cycle ? fyTokenToStartYear(r.cycle) : null;
    if (fy === null) continue; // skip rows with un-parseable cycle
    const key = `${r.user_id}_${r.project_id}_${fy}`;
    const arr = buckets.get(key);
    if (arr) arr.push(r);
    else buckets.set(key, [r]);
  }

  // ── Step 2: build a GroupedReviewRow per bucket ──────────────────
  const groups: GroupedReviewRow[] = [];
  for (const [key, bucketReviews] of buckets) {
    const first = bucketReviews[0];
    const fy = fyTokenToStartYear(first.cycle) ?? 0;
    const isCurrentOrFutureFy = activeFyYear !== null && fy >= activeFyYear;
    const renderFullCadence =
      isCurrentOrFutureFy && periods !== null && periods.length > 0;

    let slots: CycleSlot[];
    if (renderFullCadence) {
      // Full-cadence slots, slotting in existing rows by period.
      const byPeriod = new Map<string, ProjectReviewResponse>();
      for (const r of bucketReviews) {
        const p = extractCyclePeriod(r.cycle) ?? "";
        byPeriod.set(p, r);
      }
      slots = (periods as readonly string[]).map((period, idx) => {
        const review = byPeriod.get(period) ?? null;
        if (review) {
          const state: CycleChipState =
            review.status === "reviewed" ? "reviewed" : "pending";
          return { period, cycleName: review.cycle, review, state };
        }
        // No row: pending if the cycle has already arrived (past/active
        // period of the current FY), otherwise upcoming.
        const cycleName = period
          ? `${period} ${cycleSpanFromYear(fy)}`
          : cycleSpanFromYear(fy);
        const isPastOrActivePeriod =
          fy === activeFyYear && activePeriodIdx >= 0 && idx <= activePeriodIdx;
        return {
          period,
          cycleName,
          review: null,
          state: isPastOrActivePeriod ? "pending" : "upcoming",
        };
      });
    } else {
      // Past FY (or unknown cadence): one slot per existing row.
      slots = bucketReviews
        .map((r) => {
          const period = extractCyclePeriod(r.cycle) ?? "";
          const state: CycleChipState =
            r.status === "reviewed" ? "reviewed" : "pending";
          return { period, cycleName: r.cycle, review: r, state };
        })
        .sort((a, b) => a.period.localeCompare(b.period));
    }

    const reviewedCount = slots.filter((s) => s.state === "reviewed").length;
    groups.push({
      key,
      user_id: first.user_id,
      project_id: first.project_id,
      fy_year: fy,
      employee_name: first.employee_name,
      project_name: first.project_name,
      project_code: first.project_code,
      reviewer_name: first.reviewer_name ?? null,
      slots,
      reviewedCount,
      totalSlots: slots.length,
    });
  }

  // Default ordering: employee asc, then FY desc.
  groups.sort((a, b) => {
    const nameCmp = a.employee_name.localeCompare(b.employee_name);
    if (nameCmp !== 0) return nameCmp;
    return b.fy_year - a.fy_year;
  });

  return groups;
}

/** Render the FY token for a start year (local mirror of
 *  fyStartYearToToken to avoid a circular import). */
function cycleSpanFromYear(year: number): string {
  const yy = (year % 100).toString().padStart(2, "0");
  const nn = ((year + 1) % 100).toString().padStart(2, "0");
  return `FY${yy}-${nn}`;
}
