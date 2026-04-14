/**
 * SecondaryEvalTab.tsx — Secondary Evaluator's Impact Statement Queue.
 *
 * Shows cards for reviewed project reviews where the current user
 * is assigned as a Secondary evaluator and hasn't submitted yet.
 * Clicking "Write Impact Statement" opens a simple modal.
 *
 * Placement: src/components/project-reviews/SecondaryEvalTab.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  UserCircle, Briefcase, Send, Loader2, X, ClipboardList,
} from "lucide-react";
import {
  projectReviewService,
  type ProjectReviewResponse,
  type SecondaryEvalPayload,
} from "../../services/project-review.service";
import { getErrorMessage } from "../../utils/errors";

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

// ── Impact Statement Modal ──────────────────────────────────────────

interface ImpactModalProps {
  readonly review: ProjectReviewResponse;
  readonly onSubmit: (reviewId: number, payload: SecondaryEvalPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

function ImpactModal({ review, onSubmit, onClose, isSaving, error }: ImpactModalProps) {
  const [impactStatement, setImpactStatement] = useState("");

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="secondary-eval-title"
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="secondary-eval-title" className="font-display text-base font-semibold text-text-main">
              Secondary Feedback
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {review.employee_name} — {review.project_name}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
          )}

          <div>
            <label htmlFor="sec-impact" className="block text-xs font-semibold text-text-main mb-1">
              Impact Statement *
            </label>
            <p className="text-xs text-text-muted mb-2">
              Share your perspective on {review.employee_name}'s contribution to this project.
            </p>
            <textarea
              id="sec-impact"
              rows={5}
              className={TEXTAREA_CLS}
              value={impactStatement}
              onChange={(e) => setImpactStatement(e.target.value)}
              placeholder="Describe your observations about this team member's impact, collaboration, and contributions…"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(review.id, { impact_statement: impactStatement })}
            disabled={isSaving || !impactStatement.trim()}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {isSaving ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Review Card ─────────────────────────────────────────────────────

function SecondaryCard({
  review,
  onWriteImpact,
}: {
  readonly review: ProjectReviewResponse;
  readonly onWriteImpact: (review: ProjectReviewResponse) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm flex flex-col gap-3">
      <span className="self-start rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
        Secondary Evaluator
      </span>

      <div className="flex items-center gap-2">
        <UserCircle className="h-5 w-5 text-text-muted shrink-0" aria-hidden="true" />
        <p className="font-medium text-text-main">{review.employee_name}</p>
      </div>

      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {review.project_name}
        <span className="font-mono">({review.project_code})</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
          Reviewed by PM
        </span>
        <span className="text-xs text-text-muted">Cycle: {review.cycle}</span>
      </div>

      <button
        type="button"
        onClick={() => onWriteImpact(review)}
        className="mt-auto rounded-lg bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
      >
        Write Impact Statement
      </button>
    </div>
  );
}

// ── Tab Component ───────────────────────────────────────────────────

export function SecondaryEvalTab() {
  const [reviews, setReviews] = useState<ProjectReviewResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [impactTarget, setImpactTarget] = useState<ProjectReviewResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadReviews = useCallback(async () => {
    setIsLoading(true);
    try {
      setReviews(await projectReviewService.getSecondaryQueue());
    } catch {
      // stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const handleSubmit = async (reviewId: number, payload: SecondaryEvalPayload) => {
    setIsSaving(true);
    setModalError("");
    try {
      await projectReviewService.submitSecondaryEval(reviewId, payload);
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
      setImpactTarget(null);
    } catch (err: unknown) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">
        Loading secondary reviews…
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
        <ClipboardList className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">No secondary reviews pending</p>
        <p className="mt-1 text-sm text-text-muted">Reviews will appear here after the PM completes their evaluations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-muted">
        {reviews.length} review(s) awaiting your impact statement.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {reviews.map((r) => (
          <SecondaryCard
            key={r.id}
            review={r}
            onWriteImpact={(review) => {
              setModalError("");
              setImpactTarget(review);
            }}
          />
        ))}
      </div>

      {impactTarget && (
        <ImpactModal
          review={impactTarget}
          onSubmit={handleSubmit}
          onClose={() => {
            setImpactTarget(null);
            setModalError("");
          }}
          isSaving={isSaving}
          error={modalError}
        />
      )}
    </div>
  );
}