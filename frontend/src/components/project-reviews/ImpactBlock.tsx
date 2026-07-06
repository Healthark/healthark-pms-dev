import { MessageSquare, User, UserCircle } from "lucide-react";
import type {
  ProjectReviewResponse,
  SecondaryEvalResponse,
} from "../../services/project-review.service";

/**
 * Submitted secondary-evaluator impact statements for a reviewed project.
 * Extracted so the PM's read-only view (EvalModal) can show it too, not just
 * the My Reviews detail panel + table expanded row. Renders nothing when the
 * list is empty.
 */
export function SecondaryFeedback({
  evaluations,
  compact,
}: {
  readonly evaluations: SecondaryEvalResponse[] | null | undefined;
  readonly compact?: boolean;
}) {
  if (!evaluations || evaluations.length === 0) return null;
  return (
    <div
      className={`${
        compact ? "rounded-lg p-3" : "rounded-xl p-5"
      } border border-dashed border-border bg-background/50`}
    >
      <h3 className="text-[12px] font-bold uppercase tracking-widest text-text-muted mb-3 flex items-center gap-2">
        <User className="h-3.5 w-3.5" /> Secondary Feedback
      </h3>
      <div className="flex flex-col gap-3">
        {evaluations.map((ev) => (
          <div
            key={ev.id}
            className="flex flex-col gap-1.5 pb-3 border-b border-border/50 last:border-0 last:pb-0"
          >
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-main">
              <UserCircle className="h-4 w-4 text-text-muted" />
              {ev.evaluator_name}
              <span className="ml-2 rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-bold tracking-wider text-text-muted uppercase">
                Secondary
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-text-muted pl-5 whitespace-pre-wrap">
              {ev.impact_statement ?? "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders the PM's overall impact statement plus any submitted
 * secondary-evaluator impact statements for a reviewed project.
 * Used by both the My Reviews grid detail panel and the table
 * expanded row.
 */
export function ImpactBlock({
  review,
  compact,
}: {
  readonly review: ProjectReviewResponse;
  readonly compact?: boolean;
}) {
  return (
    <>
      {review.impact_statement && (
        <div
          className={`${
            compact ? "rounded-lg p-3" : "rounded-xl p-5"
          } border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/50`}
        >
          <h3 className="text-[12px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300 mb-2 flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5" /> Overall Review
          </h3>
          <p
            className={`leading-relaxed text-text-main whitespace-pre-wrap ${
              compact ? "text-[13px]" : "text-[13.5px]"
            }`}
          >
            {review.impact_statement}
          </p>
        </div>
      )}

      <SecondaryFeedback
        evaluations={review.secondary_evaluations}
        compact={compact}
      />
    </>
  );
}
