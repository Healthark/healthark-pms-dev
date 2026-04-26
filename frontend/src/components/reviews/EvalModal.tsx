/**
 * EvalModal — Mentor's annual-review evaluation form.
 *
 * Shared between two surfaces:
 *   1. /annual-reviews → Team Review tab — list of mentees, click "Evaluate"
 *   2. /my-mentees/:id → Annual Summary tab — single mentee CTA "Fill Annual Review"
 *
 * Behavior:
 *   - Side-by-side: employee's submitted self-rating + the mentor's rating select.
 *   - Read-only display of the employee's self-review paragraph.
 *   - Mentor textarea + 1–5 rating select.
 *   - Submit calls PATCH /annual-reviews/{id}/mentor-eval (status:
 *     pending_mentor → pending_management). The parent owns the API call
 *     and post-submit refresh via the `onSubmit` callback.
 *
 * Mounted conditionally by the parent (`{target && <EvalModal review={target} … />}`).
 * The modal renders nothing when its `review` prop is non-null but already
 * past pending_mentor — that gating belongs to the parent, not this modal.
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2, Save, Send, X } from "lucide-react";
import type {
  MenteeAnnualReview,
  MentorEvalPayload,
  MentorEvalDraftPayload,
} from "../../services/annual-review.service";
import { PerformanceRatingBadge } from "./PerformanceRatingBadge";
import { PerformanceRatingSelect } from "./PerformanceRatingSelect";
import { formatFyLabel } from "../../utils/fy";

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

interface EvalModalProps {
  readonly review: MenteeAnnualReview;
  readonly onSubmit: (
    reviewId: number,
    payload: MentorEvalPayload,
  ) => Promise<void>;
  readonly onSaveDraft?: (
    reviewId: number,
    payload: MentorEvalDraftPayload,
  ) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly isDraftSaving?: boolean;
  readonly error: string;
}

export function EvalModal({
  review,
  onSubmit,
  onSaveDraft,
  onClose,
  isSaving,
  isDraftSaving = false,
  error,
}: EvalModalProps) {
  // Pre-populate from any existing mentor draft so the mentor can resume.
  const [mentorReview, setMentorReview] = useState(
    review.mentor_overall_review_draft ?? "",
  );
  const [rating, setRating] = useState<number | "">(
    review.mentor_performance_rating_draft ?? "",
  );

  // Re-seed if a different review is opened in this modal instance.
  useEffect(() => {
    setMentorReview(review.mentor_overall_review_draft ?? "");
    setRating(review.mentor_performance_rating_draft ?? "");
  }, [review.id, review.mentor_overall_review_draft, review.mentor_performance_rating_draft]);

  const allFilled =
    mentorReview.trim().length > 0 && typeof rating === "number";

  const handleSubmit = async () => {
    if (typeof rating !== "number") return;
    await onSubmit(review.id, {
      mentor_overall_review: mentorReview,
      mentor_performance_rating: rating,
    });
  };

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return;
    const payload: MentorEvalDraftPayload = {};
    payload.mentor_overall_review = mentorReview;
    if (typeof rating === "number") {
      payload.mentor_performance_rating = rating;
    }
    await onSaveDraft(review.id, payload);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 className="font-display text-base font-semibold text-text-main">
              Evaluate · {review.employee_name}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {formatFyLabel(review.cycle_name)} · Review the self-review and
              record your overall assessment.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-muted">
                Employee Self Rating
              </span>
              <PerformanceRatingBadge
                value={review.self_performance_rating}
                size="md"
              />
            </div>
            <PerformanceRatingSelect
              id="mentor-rating"
              label="Your Overall Rating"
              value={rating}
              onChange={setRating}
            />
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-slate-50 px-4 py-2 border-b border-border">
              <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                Employee's Self Review
              </p>
            </div>
            <div className="p-4">
              <p className="text-sm text-text-main whitespace-pre-wrap">
                {review.self_overall_review || "—"}
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="mentor-overall-review"
              className="block text-xs font-semibold text-text-main mb-1"
            >
              Your Overall Review *
            </label>
            <p className="text-xs text-text-muted mb-2">
              Summarise the year for this mentee — strengths, areas for growth,
              and your overall assessment.
            </p>
            <textarea
              id="mentor-overall-review"
              rows={10}
              className={TEXTAREA_CLS}
              value={mentorReview}
              onChange={(e) => setMentorReview(e.target.value)}
              placeholder={`Your evaluation of ${review.employee_name}'s year…`}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          {onSaveDraft && (
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSaving || isDraftSaving}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {isDraftSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {isDraftSaving ? "Saving…" : "Save Draft"}
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || isDraftSaving || !allFilled}
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSaving ? "Submitting…" : "Submit Evaluation"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
