import { useState } from "react";
import { createPortal } from "react-dom";
import type { TeamGoal } from "../../services/goal.service";

interface RequestChangesModalProps {
  readonly goal: TeamGoal;
  readonly onSend: (feedback: string) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

/**
 * "Request Changes" modal — used by the mentor on both Team Goals and Mentee
 * Goals. Shared so the two surfaces can't drift. The mentor types feedback the
 * backend stores as manager_feedback while flipping the goal to
 * changes_requested.
 */
export function RequestChangesModal({
  goal,
  onSend,
  onClose,
  isSaving,
  error,
}: RequestChangesModalProps) {
  const [feedback, setFeedback] = useState("");

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-changes-modal-title"
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h2
            id="request-changes-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            Request Changes
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Explain what needs to be revised for{" "}
            <strong>{goal.owner_name}</strong>.
          </p>
        </div>

        <div className="px-6 py-5 space-y-3">
          {error && (
            <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
          <label
            htmlFor="request-changes-text"
            className="block text-xs font-medium text-text-muted mb-1"
          >
            Feedback *
          </label>
          <textarea
            id="request-changes-text"
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Please make the target more specific and measurable."
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSend(feedback)}
            disabled={isSaving || !feedback.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {isSaving ? "Sending…" : "Send Feedback"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
