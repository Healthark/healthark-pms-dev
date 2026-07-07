/**
 * evalStatusBadge.ts — Status flow for the unified evaluation queue.
 *
 * A review row moves through: Pending → Draft → (terminal). The terminal label
 * depends on the evaluator role:
 *   - a PM / reports-to (primary) evaluation ends **PM Reviewed** (the PM
 *     finalized their evaluation),
 *   - a Secondary impact statement ends **Completed** (the secondary submitted).
 *
 * A Secondary row also surfaces an intermediate **PM Reviewed** once the
 * member's PM evaluation has landed (`pm_submitted`) but the secondary hasn't
 * drafted or submitted yet — signalling their own submit is now unblocked. So
 * a secondary row reads: Pending → (Draft | PM Reviewed) → (Draft | Completed).
 *
 * Kept as a pure function (no JSX) so the flow can be unit-tested directly; the
 * `tone` maps to colours/icons at the render site.
 */

export type EvalStatusTone = "done" | "awaiting" | "draft" | "pending";

/** Stable filter key — the Status filter buckets by this so it always matches
 *  the rendered badge (both PM-Reviewed variants share `pm_reviewed`). */
export type EvalStatusKey = "pending" | "draft" | "pm_reviewed" | "completed";

export interface EvalStatusBadge {
  readonly label: string;
  readonly tone: EvalStatusTone;
  readonly key: EvalStatusKey;
}

/** The subset of a queue row the flow depends on. */
export interface EvalStatusInput {
  readonly type: "primary" | "secondary" | "reports_to";
  /** "pending" | "reviewed" (primary/reports-to done) | "submitted" (secondary done). */
  readonly review_status: string;
  /** A real saved-but-unsubmitted draft (not a pre-seeded placeholder). */
  readonly has_draft_content: boolean;
  /** Secondary only: the member's PM evaluation is in (review reviewed). */
  readonly pm_submitted?: boolean;
}

export function getEvalStatusBadge(row: EvalStatusInput): EvalStatusBadge {
  const isDone = row.review_status !== "pending";
  if (isDone) {
    // Secondary rows finalize as "Completed"; PM / reports-to as "PM Reviewed".
    return row.review_status === "submitted"
      ? { label: "Completed", tone: "done", key: "completed" }
      : { label: "PM Reviewed", tone: "done", key: "pm_reviewed" };
  }
  // A saved draft (PM, reports-to, or secondary) takes precedence — it's the
  // most specific signal of the row's own progress.
  if (row.has_draft_content) return { label: "Draft", tone: "draft", key: "draft" };
  // Secondary, still pending with no draft, but the PM's evaluation has landed
  // → their submit is unblocked. It stays "PM Reviewed" (never falls back to
  // "Pending") until the secondary submits and it becomes "Completed".
  if (row.type === "secondary" && row.pm_submitted) {
    return { label: "PM Reviewed", tone: "awaiting", key: "pm_reviewed" };
  }
  // Pending is reserved for a genuinely pending PM review (no PM eval yet).
  return { label: "Pending", tone: "pending", key: "pending" };
}
