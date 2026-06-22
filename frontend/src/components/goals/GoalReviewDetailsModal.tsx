/**
 * GoalReviewDetailsModal — read-only renderer for a single goal's self- and
 * mentor-review content. Used by the admin "All Goals" tab so an admin can
 * audit the qualitative reflections, not just the status badge.
 *
 * The All Goals list response is slim (no review text), so this fetches the
 * full goal via GET /goals/{id}. For an admin that endpoint returns the
 * SUBMITTED reviews with drafts stripped (the per-FY visibility embargo is
 * bypassed for admin oversight) — so HR sees the same finalized picture a
 * mentor would, never the mentee's work-in-progress.
 */

import { createPortal } from "react-dom";
import { ClipboardCheck, Loader2, MessageSquare, UserCircle, X } from "lucide-react";
import type { TeamGoal, SelfReviewCycleHalf } from "../../services/goal.service";
import { useGoalDetail } from "../../queries/goals";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { ApprovalStatusBadge } from "./ApprovalStatusBadge";
import { formatFyYearSpan } from "../../utils/fy";
import { halfDisplayLabel } from "../../utils/goalStatus";

interface GoalReviewDetailsModalProps {
  readonly goal: TeamGoal;
  readonly onClose: () => void;
}

/** Canonical order so H1 lands above H2, Q1..Q4 in numeric order regardless
 *  of the order the API returned the rows in. */
const CYCLE_ORDER: SelfReviewCycleHalf[] = ["H1", "H2", "Q1", "Q2", "Q3", "Q4"];

export function GoalReviewDetailsModal({
  goal,
  onClose,
}: GoalReviewDetailsModalProps) {
  const { settings } = useSystemSettings();
  const cycleType = settings?.cycle_type ?? null;
  const { data: detail, isPending } = useGoalDetail(goal.id);

  const selfReviews = detail?.self_reviews ?? [];
  const mentorReviews = detail?.mentor_reviews ?? [];

  // Halves with at least one submitted self- OR mentor-review (drafts excluded).
  const halves = CYCLE_ORDER.filter((h) => {
    const sr = selfReviews.find((r) => r.cycle_half === h && !r.is_draft);
    const mr = mentorReviews.find((r) => r.cycle_half === h && !r.is_draft);
    return !!sr || !!mr;
  });

  const description = detail?.description ?? goal.description;
  const fyLabel = goal.fy_year ? formatFyYearSpan(goal.fy_year) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-review-details-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl bg-surface shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light shrink-0">
              <ClipboardCheck className="h-4 w-4 text-brand" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="goal-review-details-title"
                className="font-display text-base font-semibold text-text-main truncate"
              >
                {goal.title}
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                {goal.owner_name}
                {fyLabel && <> · {fyLabel}</>}
                {goal.manager_name && <> · Mentor: {goal.manager_name}</>}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-text-main">Status:</span>
            <ApprovalStatusBadge status={goal.approval_status} />
          </div>

          {description && description.trim().length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Description
              </h3>
              <div className="rounded-lg border border-border bg-surface px-4 py-3">
                <p className="text-[13px] text-text-main whitespace-pre-wrap leading-relaxed">
                  {description}
                </p>
              </div>
            </section>
          )}

          {isPending ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-muted px-4 py-6 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading reviews…
            </div>
          ) : halves.length === 0 ? (
            <section className="rounded-lg border border-dashed border-border bg-background/50 px-4 py-6 text-center">
              <p className="text-sm italic text-text-muted">
                No self or mentor reviews submitted yet.
              </p>
            </section>
          ) : (
            halves.map((half) => {
              const sr = selfReviews.find(
                (r) => r.cycle_half === half && !r.is_draft,
              );
              const mr = mentorReviews.find(
                (r) => r.cycle_half === half && !r.is_draft,
              );
              return (
                <section key={half} className="space-y-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    {halfDisplayLabel(half, cycleType)} Reviews
                  </h3>

                  {sr ? (
                    <div className="rounded-lg border border-border bg-blue-50/30 dark:bg-blue-950/30 px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">
                        <UserCircle className="h-3 w-3" aria-hidden="true" />
                        Self-Review
                      </div>
                      <p className="text-[13px] text-text-main whitespace-pre-wrap leading-relaxed">
                        {sr.self_overall_review}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-background/50 px-4 py-2 text-[12px] italic text-text-muted">
                      No self-review submitted for {halfDisplayLabel(half, cycleType)}.
                    </div>
                  )}

                  {mr ? (
                    <div className="rounded-lg border border-border bg-emerald-50/30 dark:bg-emerald-950/30 px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">
                        <MessageSquare className="h-3 w-3" aria-hidden="true" />
                        Mentor Review
                      </div>
                      <p className="text-[13px] text-text-main whitespace-pre-wrap leading-relaxed">
                        {mr.mentor_overall_review}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-background/50 px-4 py-2 text-[12px] italic text-text-muted">
                      No mentor review submitted for {halfDisplayLabel(half, cycleType)}.
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border px-6 py-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
