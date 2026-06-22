/**
 * CycleReviewChip — single-cycle pill inside the All Reviews tab's
 * "Cycle Reviews" cell.
 *
 * The All Reviews tab groups reviews by (employee, project, FY) so a
 * single row carries a strip of chips — one per cycle in the FY. Each
 * chip encodes the cycle's state at a glance:
 *
 *   • Reviewed — green pill. Click opens the review's detail modal.
 *   • Pending  — amber pill. Row exists but PM hasn't submitted yet
 *                (or no row exists for an already-arrived cycle). Click
 *                opens the detail modal only when a DB row backs it.
 *   • Upcoming — slate dashed outline, faded. Cycle hasn't begun yet.
 *                Non-clickable.
 *
 * Ported from the Miltenyi PMS, with dark-mode variants added to match
 * Healthark's themed surfaces.
 */

import type { CycleSlot, CycleChipState } from "../../utils/groupProjectReviews";

interface CycleReviewChipProps {
  readonly slot: CycleSlot;
  /** When true, render at reduced opacity (de-emphasis for context). */
  readonly dimmed?: boolean;
  /** Click handler. Called only for clickable states (reviewed + pending
   *  with a backing DB row). Upcoming slots ignore clicks. */
  readonly onClick?: (slot: CycleSlot) => void;
}

const CHIP_BASE =
  "inline-flex items-center justify-center min-w-[34px] px-2 py-0.5 rounded-md text-[11px] font-semibold tabular-nums whitespace-nowrap select-none transition-opacity";

const STATE_CLASSES: Record<CycleChipState, string> = {
  reviewed:
    "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800",
  pending:
    "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800",
  upcoming:
    "bg-slate-50 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 cursor-not-allowed",
};

/** Hover background applied only when the chip is actually clickable. */
const HOVER_CLASSES: Record<CycleChipState, string> = {
  reviewed: "hover:bg-green-200 dark:hover:bg-green-900/50 cursor-pointer",
  pending: "hover:bg-amber-200 dark:hover:bg-amber-900/50 cursor-pointer",
  upcoming: "",
};

/** Human-readable tooltip per state. */
function tooltipFor(slot: CycleSlot): string {
  switch (slot.state) {
    case "reviewed": {
      const rating = slot.review?.performance_group ?? null;
      const reviewer = slot.review?.reviewer_name ?? null;
      const parts = [`${slot.cycleName} — submitted`];
      if (rating) parts.push(`rating ${rating}`);
      if (reviewer) parts.push(`by ${reviewer}`);
      return parts.join(" · ");
    }
    case "pending":
      return `${slot.cycleName} — pending PM evaluation`;
    case "upcoming":
      return `${slot.cycleName} — future cycle`;
  }
}

export function CycleReviewChip({
  slot,
  dimmed = false,
  onClick,
}: CycleReviewChipProps) {
  // Clickable iff a real DB row backs the slot AND the state has a
  // meaningful detail view.
  const clickable =
    (slot.state === "reviewed" || slot.state === "pending") &&
    slot.review !== null;
  const interactiveClasses = clickable ? HOVER_CLASSES[slot.state] : "";
  const classes = `${CHIP_BASE} ${STATE_CLASSES[slot.state]} ${interactiveClasses} ${
    dimmed ? "opacity-40" : ""
  }`;
  const label = slot.period || "FY";

  if (clickable && onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(slot)}
        title={tooltipFor(slot)}
        className={classes}
      >
        {label}
      </button>
    );
  }
  return (
    <span title={tooltipFor(slot)} className={classes}>
      {label}
    </span>
  );
}
