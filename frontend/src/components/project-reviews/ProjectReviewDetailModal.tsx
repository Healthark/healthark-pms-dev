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
import { Briefcase, Lock, MessageSquare, UserCircle, X } from "lucide-react";
import type { ProjectReviewResponse } from "../../services/project-review.service";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";
import { PROJECT_COMPETENCIES } from "./CompetencyBlock";

interface ProjectReviewDetailModalProps {
  readonly review: ProjectReviewResponse;
  readonly onClose: () => void;
  /** Whether to render the performance rating. Admin passes `true`. */
  readonly projectRatingsVisible: boolean;
}

export function ProjectReviewDetailModal({
  review,
  onClose,
  projectRatingsVisible,
}: ProjectReviewDetailModalProps) {
  // Only show competency blocks the PM actually filled in.
  const filledComps = PROJECT_COMPETENCIES.filter((c) => {
    const v = review[c.commentKey];
    return typeof v === "string" && v.trim().length > 0;
  });

  const submittedEvals = (review.secondary_evaluations ?? []).filter(
    (e) => e.status === "submitted",
  );

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
                  {review.project_name}
                  <span className="ml-1.5 text-[11px] font-mono text-text-muted">
                    {review.project_code}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-text-muted">
                  {review.employee_name} · {review.cycle}
                  {review.reviewer_name && (
                    <>
                      {" · Reviewer: "}
                      {review.reviewer_name}
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
