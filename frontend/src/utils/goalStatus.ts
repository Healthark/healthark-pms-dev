/**
 * goalStatus.ts — Goal lifecycle helpers shared across the frontend.
 *
 * Mirrors backend `app/core/cycle_utils.py`. Two cadences are supported:
 *   - Half-yearly orgs use H1 / H2 (two windows per FY).
 *   - Quarterly  orgs use Q1 / Q2 / Q3 / Q4 (four windows per FY).
 * The org's `cycle_type` from SystemSettings decides which family is in
 * play. The cycle code's prefix (`H` vs `Q`) is also a reliable cadence
 * marker on its own — `cycleKeysFor` recovers it without a second arg.
 */

import type { ApprovalStatus, SelfReviewCycleHalf } from "../services/goal.service";
import { extractCyclePeriod, extractFyToken, fyTokenToStartYear } from "./fy";

/** Goals in any of these states are locked from employee editing and
 *  count as "approved" in dashboard / mentee-stat rollups. Covers both
 *  cadences so a single check works for any org. */
export const POST_APPROVAL_STATES: readonly ApprovalStatus[] = [
  "approved",
  "h1_self_reviewed",
  "h1_mentor_reviewed",
  "h2_self_reviewed",
  "h2_mentor_reviewed",
  "q1_self_reviewed",
  "q1_mentor_reviewed",
  "q2_self_reviewed",
  "q2_mentor_reviewed",
  "q3_self_reviewed",
  "q3_mentor_reviewed",
  "q4_self_reviewed",
  "q4_mentor_reviewed",
];

const POST_APPROVAL_SET: ReadonlySet<ApprovalStatus> = new Set(
  POST_APPROVAL_STATES,
);

export function isPostApproved(status: ApprovalStatus): boolean {
  return POST_APPROVAL_SET.has(status);
}

// ── Cadence helpers ─────────────────────────────────────────────────

const HALF_KEYS:    readonly SelfReviewCycleHalf[] = ["H1", "H2"];
const QUARTER_KEYS: readonly SelfReviewCycleHalf[] = ["Q1", "Q2", "Q3", "Q4"];

/** Pick the cadence list for an org's `cycle_type`. */
export function cycleKeysForType(
  cycleType: string | null | undefined,
): readonly SelfReviewCycleHalf[] {
  return cycleType === "quarterly" ? QUARTER_KEYS : HALF_KEYS;
}

/** Recover the cadence list from a single cycle code's prefix. */
export function cycleKeysFor(
  code: SelfReviewCycleHalf,
): readonly SelfReviewCycleHalf[] {
  return code.startsWith("Q") ? QUARTER_KEYS : HALF_KEYS;
}

/**
 * Display label for a cycle code. The data column already stores the
 * appropriate prefix (H/Q) per cadence, so this is mostly a passthrough —
 * but the legacy half-yearly→quarterly translation case (cycle_type
 * "quarterly" with H1/H2 stored values) still flips the display.
 */
export function halfDisplayLabel(
  half: SelfReviewCycleHalf,
  cycleType?: string | null,
): string {
  // Legacy: H1/H2 stored on a quarterly org → show as Q1/Q2.
  if (cycleType === "quarterly") {
    if (half === "H1") return "Q1";
    if (half === "H2") return "Q2";
  }
  return half;
}

// ── Time-window gate (keyed off the manually-set active cycle) ───────

/**
 * Mirror of backend `cycle_utils.is_review_window_open`.
 *
 * The active cycle is admin-advanced (stored on SystemSettings), NOT derived
 * from the calendar. A cycle's window is open when its FY matches the active
 * cycle's FY and it is at or before the active cycle (so earlier cycles in the
 * same FY stay open for backfill). A quarterly active cycle still maps to a
 * half (Q1-2 → H1, Q3-4 → H2); an annual active cycle opens the whole FY.
 * Returns false when the goal has no stamped FY or the active cycle is unset.
 */
export function isHalfWindowOpen(
  cycle: SelfReviewCycleHalf,
  goalFyYear: number | null,
  activeCycleName: string | null | undefined,
): boolean {
  if (goalFyYear == null || !activeCycleName) return false;
  const activeFy = fyTokenToStartYear(extractFyToken(activeCycleName));
  if (activeFy == null || activeFy !== goalFyYear) return false;
  const activeCode = extractCyclePeriod(activeCycleName);
  if (activeCode == null) return true; // annual cadence — the whole FY is open
  const keys = cycleKeysFor(cycle);
  let activeIdx: number;
  if ((keys as readonly string[]).includes(activeCode)) {
    activeIdx = keys.indexOf(activeCode as SelfReviewCycleHalf);
  } else if (activeCode.startsWith("Q") && keys === HALF_KEYS) {
    activeIdx = activeCode === "Q1" || activeCode === "Q2" ? 0 : 1;
  } else {
    return false;
  }
  return keys.indexOf(cycle) <= activeIdx;
}
