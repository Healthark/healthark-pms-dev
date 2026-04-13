/**
 * MenteeReviewsTab.tsx — Stage 2: Mentor Evaluation.
 *
 * Shows a list of mentee reviews in pending_mentor status.
 * Clicking "Evaluate" opens a split-screen form where the mentor
 * sees the employee's self-description on the left and writes
 * their own feedback on the right for each competency.
 *
 * Placement: src/components/reviews/MenteeReviewsTab.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Users, UserCircle, Send, Loader2, X } from "lucide-react";
import {
  annualReviewService,
  type AnnualReview,
  type MentorEvalPayload,
} from "../../services/annual-review.service";
import { getErrorMessage } from "../../utils/errors";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { StarRating } from "./StarRating";

// ── Constants ───────────────────────────────────────────────────────

const COMPETENCIES = [
  { key: "ownership", label: "Ownership" },
  { key: "productivity", label: "Productivity" },
  { key: "communication", label: "Communication" },
  { key: "leadership", label: "Leadership" },
  { key: "adaptability", label: "Adaptability" },
  { key: "time_management", label: "Time Management" },
] as const;

type CompetencyKey = (typeof COMPETENCIES)[number]["key"];

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

// ── Evaluation Modal ────────────────────────────────────────────────

interface EvalModalProps {
  readonly review: AnnualReview;
  readonly onSubmit: (
    reviewId: number,
    payload: MentorEvalPayload,
  ) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

function EvalModal({
  review,
  onSubmit,
  onClose,
  isSaving,
  error,
}: EvalModalProps) {
  const [comments, setComments] = useState<Record<CompetencyKey, string>>({
    ownership: "",
    productivity: "",
    communication: "",
    leadership: "",
    adaptability: "",
    time_management: "",
  });
  const [mentorStars, setMentorStars] = useState(0);

  const setField = (key: CompetencyKey, value: string) => {
    setComments((prev) => ({ ...prev, [key]: value }));
  };

  const allFilled =
    COMPETENCIES.every((c) => comments[c.key].trim().length > 0) &&
    mentorStars >= 1;

  const handleSubmit = async () => {
    await onSubmit(review.id, {
      mentor_comment_ownership: comments.ownership,
      mentor_comment_productivity: comments.productivity,
      mentor_comment_communication: comments.communication,
      mentor_comment_leadership: comments.leadership,
      mentor_comment_adaptability: comments.adaptability,
      mentor_comment_time_management: comments.time_management,
      mentor_stars: mentorStars,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eval-modal-title"
    >
      <div className="w-full max-w-3xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2
              id="eval-modal-title"
              className="font-display text-base font-semibold text-text-main"
            >
              Mentor Evaluation
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Review the employee's self-appraisal and provide your feedback for
              each competency.
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

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Employee self-rating */}
          {review.self_stars && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-muted">
                Employee Self-Rating:
              </span>
              <StarRating value={review.self_stars} readonly />
            </div>
          )}

          {/* Competency cards — side-by-side */}
          {COMPETENCIES.map((comp, idx) => {
            const selfKey = `self_desc_${comp.key}` as keyof AnnualReview;
            const selfValue = (review[selfKey] as string | null) || "—";

            return (
              <div
                key={comp.key}
                className="rounded-lg border border-border overflow-hidden"
              >
                <div className="bg-slate-50 px-4 py-2 border-b border-border">
                  <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                    {idx + 1}. {comp.label}
                  </p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
                  {/* Left — Employee's self-description (read-only) */}
                  <div className="p-4">
                    <p className="text-xs font-medium text-text-muted mb-1">
                      Employee's Self-Assessment
                    </p>
                    <p className="text-sm text-text-main whitespace-pre-wrap">
                      {selfValue}
                    </p>
                  </div>
                  {/* Right — Mentor's feedback (editable) */}
                  <div className="p-4">
                    <label
                      htmlFor={`mentor-${comp.key}`}
                      className="block text-xs font-medium text-brand mb-1"
                    >
                      Your Feedback *
                    </label>
                    <textarea
                      id={`mentor-${comp.key}`}
                      rows={4}
                      className={TEXTAREA_CLS}
                      value={comments[comp.key]}
                      onChange={(e) => setField(comp.key, e.target.value)}
                      placeholder={`Your evaluation of this employee's ${comp.label.toLowerCase()}...`}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Mentor star rating */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-text-main">
              Your Overall Rating *
            </p>
            <StarRating value={mentorStars} onChange={setMentorStars} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !allFilled}
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

// ── Mentee Card ─────────────────────────────────────────────────────

function MenteeCard({
  review,
  employeeName,
  onEvaluate,
}: {
  readonly review: AnnualReview;
  readonly employeeName: string;
  readonly onEvaluate: (review: AnnualReview) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <UserCircle
          className="h-5 w-5 text-text-muted shrink-0"
          aria-hidden="true"
        />
        <p className="font-medium text-text-main">{employeeName}</p>
      </div>

      <div className="flex items-center gap-2">
        <ReviewStatusBadge status={review.status} />
        <span className="text-xs text-text-muted">
          Cycle: {review.cycle_name}
        </span>
      </div>

      {review.self_stars && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Self-Rating:</span>
          <StarRating value={review.self_stars} readonly />
        </div>
      )}

      <button
        type="button"
        onClick={() => onEvaluate(review)}
        className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
      >
        Evaluate
      </button>
    </div>
  );
}

// ── Tab Component ───────────────────────────────────────────────────

export function MenteeReviewsTab() {
  const [reviews, setReviews] = useState<AnnualReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [evalTarget, setEvalTarget] = useState<AnnualReview | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  // Name map — we need employee names but the review only has user_id.
  // For now, we'll use a simple approach: fetch names from the admin service
  // if available, otherwise show "Employee #{id}".
  const [nameMap, setNameMap] = useState<Record<number, string>>({});

  const loadReviews = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await annualReviewService.getMenteeReviews();
      setReviews(data);

      // Build name map from user relationships
      // Since we don't have names in the review response, we'll use
      // a pragmatic approach — this can be enhanced later with a
      // dedicated endpoint or by including employee_name in the response.
      const map: Record<number, string> = {};
      for (const r of data) {
        if (!map[r.user_id]) {
          map[r.user_id] = `Employee #${r.user_id}`;
        }
      }
      setNameMap(map);
    } catch {
      // stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const handleSubmitEval = async (
    reviewId: number,
    payload: MentorEvalPayload,
  ) => {
    setIsSaving(true);
    setModalError("");
    try {
      await annualReviewService.submitMentorEval(reviewId, payload);
      // Remove from list (it's no longer pending_mentor)
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
      setEvalTarget(null);
    } catch (err: unknown) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">
        Loading mentee reviews…
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
        <Users className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">
          No reviews pending
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Your mentees haven't submitted their self-appraisals yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-muted">
        {reviews.length} review(s) awaiting your evaluation.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {reviews.map((r) => (
          <MenteeCard
            key={r.id}
            review={r}
            employeeName={nameMap[r.user_id] ?? `Employee #${r.user_id}`}
            onEvaluate={setEvalTarget}
          />
        ))}
      </div>

      {/* Evaluation modal */}
      {evalTarget && (
        <EvalModal
          review={evalTarget}
          onSubmit={handleSubmitEval}
          onClose={() => {
            setEvalTarget(null);
            setModalError("");
          }}
          isSaving={isSaving}
          error={modalError}
        />
      )}
    </div>
  );
}
