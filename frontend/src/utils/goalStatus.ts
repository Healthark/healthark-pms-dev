/**
 * goalStatus.ts — Goal lifecycle helpers shared across the frontend.
 *
 * Centralises:
 *   - The "post-approval" state set, used to gate edit affordances and to
 *     decide whether self-/mentor-review actions are visible at all.
 *   - The client-side mirror of `cycle_utils.is_review_window_open` so
 *     surfaces like SelfReviewCycleMenu can disable buttons before the
 *     server rejects them.
 */

import type { ApprovalStatus } from "../services/goal.service";

/** Goals in any of these states are locked from employee editing and
 *  count as "approved" in dashboard / mentee-stat rollups. */
export const POST_APPROVAL_STATES: readonly ApprovalStatus[] = [
  "approved",
  "h1_self_reviewed",
  "h1_mentor_reviewed",
  "h2_self_reviewed",
  "h2_mentor_reviewed",
];

const POST_APPROVAL_SET: ReadonlySet<ApprovalStatus> = new Set(
  POST_APPROVAL_STATES,
);

export function isPostApproved(status: ApprovalStatus): boolean {
  return POST_APPROVAL_SET.has(status);
}

/** Same calendar logic as backend `cycle_utils.current_half_and_fy`. */
export function currentHalfAndFy(
  today: Date = new Date(),
  fiscalStartMonth = 4,
): { half: "H1" | "H2"; fyYear: number } {
  const month = today.getMonth() + 1; // 1–12
  const year = today.getFullYear();
  const fiscalYear = month >= fiscalStartMonth ? year : year - 1;
  const relativeMonth = ((month - fiscalStartMonth) % 12 + 12) % 12;
  const half: "H1" | "H2" = relativeMonth < 6 ? "H1" : "H2";
  return { half, fyYear: fiscalYear };
}

/**
 * Mirror of backend `cycle_utils.is_review_window_open`.
 *
 * Rule:
 *   - Same FY required (no cross-year reviews).
 *   - H1 reviews open at the start of H1 and stay open through the end
 *     of the FY (so H1 backfill is allowed during H2 of the same FY).
 *   - H2 reviews open at the start of H2 and stay open through the end
 *     of the FY.
 *
 * Returns false (locked) when goalFyYear is null (legacy goals without a
 * stamped cycle_name).
 */
export function isHalfWindowOpen(
  half: "H1" | "H2",
  goalFyYear: number | null,
  fiscalStartMonth = 4,
  today: Date = new Date(),
): boolean {
  if (goalFyYear == null) return false;
  const { half: currentHalf, fyYear: currentFy } = currentHalfAndFy(
    today,
    fiscalStartMonth,
  );
  if (currentFy !== goalFyYear) return false;
  if (half === "H2") return currentHalf === "H2";
  // H1 — open in both halves of the same FY.
  return true;
}
