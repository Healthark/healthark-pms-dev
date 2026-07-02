/**
 * ProjectReviewDetailModal — read-only renderer for a single
 * ProjectReviewResponse, used by the Admin "All Reviews" tab.
 *
 * The full review content (7 competency comments + impact statement +
 * secondary impact statements) already rides on the row payload, so the
 * modal doesn't fetch anything — it just renders.
 *
 * Ported from the Miltenyi PMS; uses Healthark's `PROJECT_COMPETENCIES`
 * framework and `reviewer_name`.
 *
 * Rating visibility is a **parent decision** (`projectRatingsVisible`).
 * The Admin surface passes `true` because the org-wide
 * `project_ratings_visible` flag is an Employee-facing gate, not an Admin
 * one. When false, the rating row renders a "Hidden" placeholder.
 */

import { createPortal } from "react-dom";
import { Briefcase, Clock, Lock, MessageSquare, UserCircle, X } from "lucide-react";
import type { ProjectReviewResponse } from "../../services/project-review.service";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";
import { PROJECT_COMPETENCIES } from "./CompetencyBlock";

/** Minimal header context for the read-only "not yet evaluated" placeholder,
 *  used when `review` is null — a pending cycle on the All Reviews tab that
 *  the PM hasn't started, so no DB row exists to render. */
export interface PendingReviewContext {
  readonly project_name: string;
  readonly project_code: string;
  readonly employee_name: string;
  readonly cycle: string;
  readonly reviewer_name: string | null;
}

interface ProjectReviewDetailModalProps {
  /** The review to render, or `null` to show the pending placeholder — in
   *  which case `pendingContext` supplies the header. */
  readonly review: ProjectReviewResponse | null;
  /** Header context for the placeholder when `review` is null. */
  readonly pendingContext?: PendingReviewContext;
  readonly onClose: () => void;
  /** Whether to render the performance rating. Admin passes `true`. */
  readonly projectRatingsVisible: boolean;
}

export function ProjectReviewDetailModal({
  review,
  pendingContext,
  onClose,
  projectRatingsVisible,
}: ProjectReviewDetailModalProps) {
  // Header comes from the real review, or the placeholder context when the
  // cycle hasn't been evaluated yet. Exactly one of the two is present.
  const header = review ?? pendingContext;
  if (!header) return null;
  const isPending = review === null;

  // Only show competency blocks the PM actually filled in.
  const filledComps = review
    ? PROJECT_COMPETENCIES.filter((c) => {
        const v = review[c.commentKey];
        return typeof v === "string" && v.trim().length > 0;
      })
    : [];

  const submittedEvals = review
    ? (review.secondary_evaluations ?? []).filter(
        (e) => e.status === "submitted",
      )
    : [];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proj-review-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-xl bg-surface shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/40 shrink-0">
                <Briefcase
                  className="h-4 w-4 text-indigo-600 dark:text-indigo-300"
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0">
                <h2
                  id="proj-review-modal-title"
                  className="font-display text-base font-semibold text-text-main truncate"
                >
                  {header.project_name}
                  <span className="ml-1.5 text-[11px] font-mono text-text-muted">
                    {header.project_code}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-text-muted">
                  {header.employee_name} · {header.cycle}
                  {header.reviewer_name && (
                    <>
                      {" · Reviewer: "}
                      {header.reviewer_name}
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isPending ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/40">
                <Clock
                  className="h-6 w-6 text-amber-500 dark:text-amber-300"
                  aria-hidden="true"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-main">
                  Not yet evaluated
                </p>
                <p className="mt-1 max-w-sm text-[13px] text-text-muted">
                  The PM hasn&rsquo;t started this review for{" "}
                  <span className="font-medium text-text-main">
                    {header.cycle}
                  </span>{" "}
                  yet. Ratings and feedback will appear here once it&rsquo;s
                  submitted.
                </p>
              </div>
            </div>
          ) : (
          <>
          {/* Project rating */}
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-text-main">
              Project Rating:
            </span>
            {projectRatingsVisible ? (
              <PerformanceRatingBadge value={review.performance_group} size="md" />
            ) : (
              <span className="inline-flex items-center gap-1 text-[12px] text-text-muted/70">
                <Lock className="h-3 w-3" aria-hidden="true" />
                Hidden
              </span>
            )}
          </div>

          {/* Competency comments */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Manager&rsquo;s Competency Feedback
            </h3>
            {filledComps.length === 0 ? (
              <p className="text-sm italic text-text-muted">
                No competency comments recorded.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filledComps.map((c) => (
                  <div
                    key={c.key}
                    className="rounded-lg border border-border bg-surface-muted px-3 py-2.5"
                  >
                    <p className="text-[11px] font-semibold text-text-main mb-1">
                      {c.label}
                    </p>
                    <p className="text-[12px] text-text-muted whitespace-pre-wrap leading-snug">
                      {review[c.commentKey]}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* PM impact statement */}
          {review.impact_statement &&
            review.impact_statement.trim().length > 0 && (
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  <MessageSquare className="h-3 w-3" aria-hidden="true" />
                  Manager&rsquo;s Impact Statement
                </h3>
                <div className="rounded-lg border border-border bg-blue-50/30 dark:bg-blue-950/20 px-4 py-3">
                  <p className="text-[13px] text-text-main whitespace-pre-wrap leading-relaxed">
                    {review.impact_statement}
                  </p>
                </div>
              </section>
            )}

          {/* Secondary impact statements */}
          {submittedEvals.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                <UserCircle className="h-3 w-3" aria-hidden="true" />
                Secondary Impact Statements
              </h3>
              <div className="space-y-2">
                {submittedEvals.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-lg border border-border bg-emerald-50/30 dark:bg-emerald-950/20 px-4 py-3"
                  >
                    <p className="text-[12px] font-semibold text-text-main mb-1">
                      {ev.evaluator_name}
                    </p>
                    <p className="text-[13px] text-text-muted whitespace-pre-wrap leading-relaxed">
                      {ev.impact_statement || <span className="italic">—</span>}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
          </>
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
