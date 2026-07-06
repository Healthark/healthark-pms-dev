import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Save, Send, X } from "lucide-react";
import type {
  SecondaryEvalPayload,
  SecondaryEvalDraftPayload,
} from "../../services/project-review.service";

/**
 * Minimal header data ImpactModal needs. Secondary writes are keyed on
 * (project_id, user_id) — the impact may be created before the PM's review
 * row exists, so there's no review id to target.
 */
export interface ImpactModalRow {
  employee_name: string;
  project_name: string;
  review_status: string; // "pending" | "submitted" | ...
  project_id: number;
  user_id: number | null;
  existingImpact?: string;
}

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none disabled:bg-surface-muted disabled:text-text-muted disabled:cursor-not-allowed";

interface ImpactModalProps {
  readonly row: ImpactModalRow;
  /** When true, inputs are disabled and the submit button is hidden. */
  readonly readOnly?: boolean;
  /** Whether the member's PM evaluation is in (review reviewed). The Secondary
   *  can always Save Draft, but can only Submit once this is true. Defaults to
   *  true so callers that don't pass it keep the pre-gate behavior. */
  readonly pmSubmitted?: boolean;
  readonly onSubmit: (
    projectId: number,
    userId: number,
    payload: SecondaryEvalPayload,
  ) => Promise<void>;
  readonly onSaveDraft?: (
    projectId: number,
    userId: number,
    payload: SecondaryEvalDraftPayload,
  ) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly isDraftSaving?: boolean;
  readonly error: string;
}

export function ImpactModal({
  row,
  readOnly = false,
  pmSubmitted = true,
  onSubmit,
  onSaveDraft,
  onClose,
  isSaving,
  isDraftSaving = false,
  error,
}: ImpactModalProps) {
  const isEdit = row.review_status === "submitted";
  const isDraft = row.review_status === "draft";
  const [impactStatement, setImpactStatement] = useState(row.existingImpact ?? "");

  // The Secondary can draft before the PM, but can only submit once the PM's
  // evaluation is in. An already-submitted row (isEdit) is only reachable
  // after the PM finalized, so editing stays open regardless.
  const canSubmit = pmSubmitted || isEdit;

  const title = readOnly
    ? "Secondary Feedback"
    : isEdit
      ? "Edit Feedback"
      : isDraft
        ? "Secondary Feedback (Draft)"
        : "Secondary Feedback";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              {readOnly ? (
                <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  View Only
                </span>
              ) : isEdit ? (
                <span className="rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Editing
                </span>
              ) : null}
              <h2 className="font-display text-base font-semibold text-text-main">
                {title}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              {row.employee_name} — {row.project_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
          {!readOnly && !canSubmit && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              You can save a draft now, but you can only submit your review once
              the Project Manager has submitted their evaluation for this team
              member.
            </div>
          )}
          <div>
            <label
              htmlFor="sec-impact"
              className="block text-xs font-semibold text-text-main mb-1"
            >
              Overall Review {!readOnly && "*"}
            </label>
            {!readOnly && (
              <p className="text-xs text-text-muted mb-2">
                Share your perspective on {row.employee_name}'s contribution.
              </p>
            )}
            <textarea
              id="sec-impact"
              rows={5}
              className={TEXTAREA_CLS}
              value={impactStatement}
              onChange={(e) => setImpactStatement(e.target.value)}
              placeholder="Describe observations about impact, collaboration, and contributions…"
              disabled={readOnly}
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors"
          >
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && onSaveDraft && row.user_id !== null && (
            <button
              type="button"
              onClick={() =>
                onSaveDraft(row.project_id, row.user_id as number, {
                  impact_statement: impactStatement,
                })
              }
              disabled={isSaving || isDraftSaving}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-surface-muted disabled:opacity-50 transition-colors"
            >
              {isDraftSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isDraftSaving ? "Saving…" : "Save Draft"}
            </button>
          )}
          {!readOnly && row.user_id !== null && (
            <button
              type="button"
              onClick={() =>
                onSubmit(row.project_id, row.user_id as number, {
                  impact_statement: impactStatement,
                })
              }
              disabled={isSaving || isDraftSaving || !impactStatement.trim() || !canSubmit}
              title={
                !canSubmit
                  ? "The Project Manager must submit their evaluation before you can submit yours."
                  : undefined
              }
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {isSaving
                ? isEdit
                  ? "Saving…"
                  : "Submitting…"
                : isEdit
                ? "Save Changes"
                : "Submit"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
