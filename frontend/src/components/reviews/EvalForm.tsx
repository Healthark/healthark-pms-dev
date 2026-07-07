/**
 * EvalForm — pure form body for the mentor's annual evaluation.
 *
 * Auto-save semantics (debounced):
 *   - Field changes are mirrored to a server-side draft 1500ms after the
 *     last edit, via a TanStack v5 useMutation. No more "fire on unmount" —
 *     unmount only cancels any pending debounced call so the form never
 *     resurrects deleted typing.
 *   - The explicit "Save Draft" button forces an immediate save.
 *   - Cancel/X cancels any pending autosave (matches the prior "explicit
 *     dismiss does not auto-save" behaviour).
 *   - Submit cancels any pending autosave; the server replaces the draft
 *     with the final values anyway.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Save, Send, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import type {
  MenteeAnnualReview,
  MentorEvalPayload,
  MentorEvalDraftPayload,
} from "../../services/annual-review.service";
import { PerformanceRatingSelect } from "./PerformanceRatingSelect";
import { AutoGrowTextarea } from "../common/AutoGrowTextarea";
import { formatFyLabel } from "../../utils/fy";
import { useDebounce } from "../../hooks/useDebounce";

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";

const AUTOSAVE_DEBOUNCE_MS = 1500;

export interface EvalFormProps {
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
  /**
   * Optional external "saving draft" indicator. The component now owns its
   * own draft mutation, so this prop is OR'd with the local mutation's
   * pending state for backwards compatibility with parents that still
   * track this separately.
   */
  readonly isDraftSaving?: boolean;
  readonly error: string;
}

function buildDraftPayload(
  mentorReview: string,
  rating: number | "",
): MentorEvalDraftPayload {
  const payload: MentorEvalDraftPayload = {
    mentor_overall_review: mentorReview,
  };
  if (typeof rating === "number") {
    payload.mentor_performance_rating = rating;
  }
  return payload;
}

export function EvalForm({
  review,
  onSubmit,
  onSaveDraft,
  onClose,
  isSaving,
  isDraftSaving: externalIsDraftSaving = false,
  error,
}: EvalFormProps) {
  const [mentorReview, setMentorReview] = useState(
    review.mentor_overall_review_draft ?? "",
  );
  const [rating, setRating] = useState<number | "">(
    review.mentor_performance_rating_draft ?? "",
  );

  // Baseline = what the server-side draft currently holds. We only autosave
  // when the local values diverge from this; after a successful save, we
  // reset it so a follow-up no-op edit doesn't re-fire.
  const baselineRef = useRef({
    mentorReview: review.mentor_overall_review_draft ?? "",
    rating: (review.mentor_performance_rating_draft ?? "") as number | "",
  });

  // Re-seed only when we switch to a DIFFERENT review (mentee / FY). We
  // deliberately DON'T reseed when this same review's draft fields change:
  // saving a draft invalidates ['mentees'], so the freshly-persisted draft
  // flows back through the cache — reseeding on that would clobber the
  // mentor's in-progress edits (e.g. text typed after an autosave fired, or
  // the value they just saved). Identity change is the only reseed trigger;
  // the draft fields are read fresh inside the effect but intentionally left
  // out of the deps.
  const skipNextAutosaveRef = useRef(true);
  useEffect(() => {
    const seededReview = review.mentor_overall_review_draft ?? "";
    const seededRating = (review.mentor_performance_rating_draft ?? "") as
      | number
      | "";
    setMentorReview(seededReview);
    setRating(seededRating);
    baselineRef.current = {
      mentorReview: seededReview,
      rating: seededRating,
    };
    skipNextAutosaveRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.id]);

  const saveDraftMutation = useMutation({
    mutationFn: async (vars: {
      reviewId: number;
      payload: MentorEvalDraftPayload;
    }) => {
      if (!onSaveDraft) return;
      await onSaveDraft(vars.reviewId, vars.payload);
    },
    onSuccess: (_data, vars) => {
      baselineRef.current = {
        mentorReview: vars.payload.mentor_overall_review ?? "",
        rating:
          typeof vars.payload.mentor_performance_rating === "number"
            ? vars.payload.mentor_performance_rating
            : "",
      };
    },
  });

  const [debouncedAutosave, cancelAutosave] = useDebounce(
    (reviewId: number, nextReview: string, nextRating: number | "") => {
      saveDraftMutation.mutate({
        reviewId,
        payload: buildDraftPayload(nextReview, nextRating),
      });
    },
    AUTOSAVE_DEBOUNCE_MS,
  );

  // Field-change watcher: trigger debounced autosave when the local state
  // diverges from the last-persisted baseline. Skip after a reseed so we
  // don't fire on the initial hydration.
  useEffect(() => {
    if (!onSaveDraft) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    const baseline = baselineRef.current;
    const isDirty =
      mentorReview !== baseline.mentorReview || rating !== baseline.rating;
    if (!isDirty) return;
    debouncedAutosave(review.id, mentorReview, rating);
  }, [mentorReview, rating, review.id, onSaveDraft, debouncedAutosave]);

  const allFilled =
    mentorReview.trim().length > 0 && typeof rating === "number";

  const closeWithoutAutoSave = () => {
    cancelAutosave();
    onClose();
  };

  const handleSubmit = async () => {
    if (typeof rating !== "number") return;
    cancelAutosave(); // submit replaces the draft anyway
    await onSubmit(review.id, {
      mentor_overall_review: mentorReview,
      mentor_performance_rating: rating,
    });
  };

  const handleSaveDraft = () => {
    if (!onSaveDraft) return;
    cancelAutosave();
    saveDraftMutation.mutate({
      reviewId: review.id,
      payload: buildDraftPayload(mentorReview, rating),
    });
  };

  const isDraftSaving = saveDraftMutation.isPending || externalIsDraftSaving;

  return (
    <>
      {/* ── Header ── */}
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
          onClick={closeWithoutAutoSave}
          className="rounded-md p-1.5 text-text-muted hover:bg-surface-muted transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 space-y-6">
        {error && (
          <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        )}

        <PerformanceRatingSelect
          id="mentor-rating"
          label="Overall Rating"
          value={rating}
          onChange={setRating}
        />

        <div className="rounded-lg border border-border overflow-hidden">
          <div className="bg-surface-muted px-4 py-2 border-b border-border">
            <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
              Employee's Self Review
            </p>
          </div>
          <div className="p-4">
            <p className="text-sm text-text-main whitespace-pre-wrap break-words">
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
          <AutoGrowTextarea
            id="mentor-overall-review"
            minRows={10}
            className={TEXTAREA_CLS}
            value={mentorReview}
            onChange={(e) => setMentorReview(e.target.value)}
            placeholder={`Your evaluation of ${review.employee_name}'s year…`}
          />
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
        <button
          type="button"
          onClick={closeWithoutAutoSave}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors"
        >
          Cancel
        </button>
        {onSaveDraft && (
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSaving || isDraftSaving}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-surface-muted disabled:opacity-50 transition-colors"
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
    </>
  );
}
