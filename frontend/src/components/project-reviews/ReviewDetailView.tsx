/**
 * ReviewDetailView.tsx — Employee's View of a Submitted Review.
 *
 * Shows:
 *   - Project context header
 *   - 8 competency self-descriptions (always visible)
 *   - Primary evaluator's side-by-side comments (once Primary submits)
 *   - Performance group + impact statement from Primary
 *   - Secondary impact statements (once Primary has submitted)
 *   - "Waiting for evaluation" state if Primary hasn't submitted yet
 *
 * Placement: src/components/project-reviews/ReviewDetailView.tsx
 */

import { useState, useEffect } from "react";
import { ArrowLeft, Briefcase, Star, MessageSquare, UserCircle, Loader2 } from "lucide-react";
import {
  projectReviewService,
  type ProjectReviewResponse,
  type EvaluatorResponse,
} from "../../services/project-review.service";

const COMPETENCIES = [
  { key: "task_execution", label: "Task Execution & Problem Solving" },
  { key: "ownership", label: "Ownership & Accountability" },
  { key: "project_management", label: "Project Management and Risk Mitigation" },
  { key: "client_deliverables", label: "Building Client-Ready Deliverables" },
  { key: "communication", label: "Communication & Client/Stakeholder Management" },
  { key: "mentoring", label: "Mentoring and Team Development" },
  { key: "firm_growth", label: "Firm Growth" },
  { key: "competency_skills", label: "Competency and Skills" },
] as const;

type CompKey = (typeof COMPETENCIES)[number]["key"];

interface ReviewDetailViewProps {
  readonly reviewId: number;
  readonly onBack: () => void;
}

// ── Performance Group Badge ─────────────────────────────────────────

const PG_COLORS: Record<string, { bg: string; text: string }> = {
  "Needs Improvement": { bg: "bg-red-50", text: "text-red-700" },
  "Meeting Expectations": { bg: "bg-slate-100", text: "text-slate-700" },
  "Exceeding Expectations": { bg: "bg-blue-50", text: "text-blue-700" },
  "Meeting High Expectations": { bg: "bg-amber-50", text: "text-amber-700" },
  "Exceeding High Expectations": { bg: "bg-green-50", text: "text-green-700" },
};

function PerformanceGroupBadge({ group }: { readonly group: string }) {
  const colors = PG_COLORS[group] ?? PG_COLORS["Meeting Expectations"];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${colors.bg} ${colors.text}`}>
      <Star className="h-3.5 w-3.5" aria-hidden="true" />
      {group}
    </span>
  );
}

// ── Component ───────────────────────────────────────────────────────

export function ReviewDetailView({ reviewId, onBack }: ReviewDetailViewProps) {
  const [review, setReview] = useState<ProjectReviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setIsLoading(true);
    projectReviewService
      .getReview(reviewId)
      .then(setReview)
      .catch(() => setError("Failed to load review."))
      .finally(() => setIsLoading(false));
  }, [reviewId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" aria-hidden="true" />
      </div>
    );
  }

  if (error || !review) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-brand transition-colors">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <p className="text-sm text-red-600">{error || "Review not found."}</p>
      </div>
    );
  }

  const primaryEval = review.evaluators.find((e) => e.evaluator_type === "Primary");
  const secondaryEvals = review.evaluators.filter((e) => e.evaluator_type === "Secondary");
  const hasPrimaryFeedback = primaryEval !== undefined;

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-brand transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to My Reviews
      </button>

      {/* Project header */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light">
            <Briefcase className="h-5 w-5 text-brand" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold text-text-main">
              {review.project_name}
            </h1>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-text-muted font-mono">{review.project_code}</span>
              <span className="text-xs text-text-muted">Cycle: {review.cycle}</span>
              <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                Submitted
              </span>
            </div>
          </div>
        </div>

        {/* Performance Group — shown if Primary has evaluated */}
        {hasPrimaryFeedback && primaryEval.performance_group && (
          <div className="mt-4">
            <PerformanceGroupBadge group={primaryEval.performance_group} />
          </div>
        )}
      </div>

      {/* Waiting state — if Primary hasn't submitted yet */}
      {!hasPrimaryFeedback && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your self-review has been submitted. Waiting for your project manager's evaluation.
        </div>
      )}

      {/* 8 Competency Sections — side-by-side when Primary feedback exists */}
      <div className="space-y-4">
        {COMPETENCIES.map((comp, idx) => {
          const selfKey = `self_desc_${comp.key}` as keyof ProjectReviewResponse;
          const selfValue = (review[selfKey] as string | null) ?? "—";

          const commentKey = `comment_${comp.key}` as keyof EvaluatorResponse;
          const primaryComment = hasPrimaryFeedback
            ? (primaryEval[commentKey] as string | null)
            : null;

          return (
            <div key={comp.key} className="rounded-lg border border-border overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b border-border">
                <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                  {idx + 1}. {comp.label}
                </p>
              </div>

              <div className={`grid ${hasPrimaryFeedback ? "grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border" : "grid-cols-1"}`}>
                {/* Self-description */}
                <div className="p-4">
                  <p className="text-xs font-medium text-text-muted mb-1">
                    Your Self-Assessment
                  </p>
                  <p className="text-sm text-text-main whitespace-pre-wrap">
                    {selfValue}
                  </p>
                </div>

                {/* Primary comment */}
                {hasPrimaryFeedback && (
                  <div className="p-4 bg-blue-50/30">
                    <p className="text-xs font-medium text-blue-700 mb-1">
                      Manager's Evaluation
                    </p>
                    <p className="text-sm text-text-main whitespace-pre-wrap">
                      {primaryComment ?? "—"}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Primary Impact Statement */}
      {hasPrimaryFeedback && primaryEval.impact_statement && (
        <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-5 space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-600" aria-hidden="true" />
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
              Manager's Impact Statement
            </p>
          </div>
          <p className="text-sm text-blue-900 whitespace-pre-wrap">
            {primaryEval.impact_statement}
          </p>
          <p className="text-xs text-blue-600">
            — {primaryEval.evaluator_name}
          </p>
        </div>
      )}

      {/* Secondary Impact Statements */}
      {hasPrimaryFeedback && secondaryEvals.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
            Additional Feedback
          </p>
          {secondaryEvals.map((ev) => (
            <div
              key={ev.id}
              className="rounded-lg border border-border bg-slate-50 p-4 space-y-1.5"
            >
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <UserCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {ev.evaluator_name}
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium">
                  {ev.evaluator_type}
                </span>
              </div>
              <p className="text-sm text-text-main whitespace-pre-wrap">
                {ev.impact_statement ?? "—"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}