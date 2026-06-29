import { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Collapsible "Your Role Expectations" reference card.
 *
 * Single source of truth for the card shown on the Annual Goals (My Goals)
 * page and inside the Goal Self-Review modal, so the two never drift. Shows
 * all eight competency expectations for one role, with the stored " | "
 * separators rendered as bullet lines.
 *
 * Accepts any object carrying the fields below — both the profile
 * `UserRoleExpectation` and the project-review `RoleExpectation` satisfy it.
 */
export interface RoleExpectationCardData {
  readonly department_name: string | null;
  readonly designation_name: string | null;
  readonly exp_task_execution: string | null;
  readonly exp_ownership: string | null;
  readonly exp_project_management: string | null;
  readonly exp_client_deliverables: string | null;
  readonly exp_communication: string | null;
  readonly exp_mentoring: string | null;
  readonly exp_firm_growth: string | null;
  readonly exp_competency_skills: string | null;
}

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

export function RoleExpectationsCard({
  expectation,
  title = "Your Role Expectations",
  defaultOpen = false,
  emptyMessage,
}: {
  readonly expectation: RoleExpectationCardData | null;
  /** Header label — override for the mentor view (e.g. "Asha's Role Expectations"). */
  readonly title?: string;
  readonly defaultOpen?: boolean;
  /**
   * When set and `expectation` is null, render the card shell with this muted
   * note instead of returning null — so callers (e.g. the mentor review form)
   * can surface "no expectations configured for this role" rather than a
   * silently-blank section. Without it, a null expectation renders nothing.
   */
  readonly emptyMessage?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!expectation) {
    if (!emptyMessage) return null;
    return (
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-50/50 dark:bg-blue-950/50">
          <BookOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-300 shrink-0" />
          <span className="text-xs font-semibold text-text-main">{title}</span>
        </div>
        <div className="px-4 py-3 bg-blue-50/20 dark:bg-blue-950/20 border-t border-border">
          <p className="text-xs text-text-muted leading-relaxed">
            {emptyMessage}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 bg-blue-50/50 dark:bg-blue-950/50 hover:bg-blue-50/80 dark:hover:bg-blue-950/80 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-main">
          <BookOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-300 shrink-0" />
          {title}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-text-muted shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-text-muted shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 bg-blue-50/20 dark:bg-blue-950/20 border-t border-border">
          {FIELDS.map(({ key, label }) => {
            const text = expectation[key];
            if (!text) return null;
            return (
              <div key={key}>
                <p className="text-[11px] font-semibold text-text-main mb-0.5">
                  {label}
                </p>
                <p className="text-xs text-text-muted whitespace-pre-wrap leading-relaxed">
                  {text.replace(/ \| /g, "\n• ")}
                </p>
              </div>
            );
          })}
          <p className="text-[10px] text-text-muted pt-1 border-t border-border">
            {expectation.department_name} · {expectation.designation_name}
          </p>
        </div>
      )}
    </div>
  );
}
