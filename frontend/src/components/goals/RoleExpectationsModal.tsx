/**
 * RoleExpectationsModal — read-only modal showing the current user's role
 * expectations, opened from the "View Role Expectations" button on Annual
 * Goals → My Goals.
 *
 * Shows all eight competency expectations as a grid of numbered cards, with
 * the stored " | " separators rendered as bullet lines. Reuses
 * RoleExpectationCardData so the field contract stays shared with the inline
 * RoleExpectationsCard (used inside the Self-Review modal). Closes on
 * Esc / X / backdrop.
 */
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { BookOpen, X } from "lucide-react";
import type { RoleExpectationCardData } from "./RoleExpectationsCard";

const FIELDS: {
  readonly key: keyof RoleExpectationCardData;
  readonly label: string;
}[] = [
  { key: "exp_task_execution", label: "Task Execution" },
  { key: "exp_ownership", label: "Ownership" },
  { key: "exp_project_management", label: "Project Management" },
  { key: "exp_client_deliverables", label: "Client Deliverables" },
  { key: "exp_communication", label: "Communication" },
  { key: "exp_mentoring", label: "Mentoring" },
  { key: "exp_firm_growth", label: "Firm Growth" },
  { key: "exp_competency_skills", label: "Competency & Skills" },
];

export function RoleExpectationsModal({
  expectation,
  onClose,
}: {
  readonly expectation: RoleExpectationCardData;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-exp-modal-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/50">
              <BookOpen
                className="h-4 w-4 text-blue-600 dark:text-blue-300"
                aria-hidden="true"
              />
            </div>
            <div>
              <h2
                id="role-exp-modal-title"
                className="font-display text-base font-semibold text-text-main"
              >
                Your Role Expectations
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                {expectation.department_name ?? "—"} ·{" "}
                {expectation.designation_name ?? "—"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body — numbered competency cards, two columns on md+ screens. */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <ol className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            {FIELDS.map(({ key, label }, idx) => {
              const text = expectation[key];
              if (!text) return null;
              return (
                <li
                  key={key}
                  className="rounded-lg border border-border/60 bg-surface-muted/40 p-4"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/50 text-[12px] font-bold text-blue-700 dark:text-blue-300"
                      aria-hidden="true"
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[12px] font-semibold text-text-main leading-snug">
                        {label}
                      </h3>
                      <p className="mt-1 text-[11px] text-text-muted whitespace-pre-wrap leading-snug">
                        {text.replace(/ \| /g, "\n• ")}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end border-t border-border px-6 py-3">
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
