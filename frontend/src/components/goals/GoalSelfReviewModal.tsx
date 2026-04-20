/**
 * GoalSelfReviewModal.tsx — Owner's reflection on an approved yearly goal.
 *
 * Opens from the Actions column when a goal is in the APPROVED state and
 * the self-review has not yet been submitted.  After submission, the
 * Actions cell flips from "Self Review" to "Requested" and the form is
 * shown in read-only mode.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardCheck, Send, Loader2, X } from "lucide-react";
import type {
  Goal,
  GoalSelfReviewPayload,
} from "../../services/goal.service";

// ── Competency schema — matches backend self_desc_* columns ─────────

const COMPETENCIES = [
  {
    key: "task_execution",
    label: "Task Execution & Problem Solving",
    placeholder:
      "Describe how you executed on this goal, the problems you solved, and the quality of your delivery.",
  },
  {
    key: "ownership",
    label: "Ownership & Accountability",
    placeholder:
      "Describe how you took ownership of this goal end-to-end and the accountability you demonstrated.",
  },
  {
    key: "client_deliverables",
    label: "Building Client-Ready Deliverables",
    placeholder:
      "Describe the client-ready deliverables you produced while working on this goal.",
  },
  {
    key: "communication",
    label: "Communication & Stakeholder Management",
    placeholder:
      "Describe how you communicated progress, managed expectations, and engaged stakeholders.",
  },
  {
    key: "project_management",
    label: "Project Management and Risk Mitigation",
    placeholder:
      "Describe how you planned, tracked timelines, and mitigated risks for this goal.",
  },
  {
    key: "mentoring",
    label: "Mentoring and Team Development",
    placeholder:
      "Describe how you mentored teammates or contributed to team development through this goal.",
  },
  {
    key: "firm_growth",
    label: "Firm Growth",
    placeholder:
      "Describe how your work on this goal contributed to firm growth — new capabilities, client relationships, or revenue.",
  },
  {
    key: "competency_skills",
    label: "Competency and Skills",
    placeholder:
      "Describe the competencies and skills you built or demonstrated while delivering this goal.",
  },
] as const;

type CompetencyKey = (typeof COMPETENCIES)[number]["key"];

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

// ── Helpers ─────────────────────────────────────────────────────────

function emptyForm(): Record<CompetencyKey, string> {
  return {
    task_execution: "",
    ownership: "",
    client_deliverables: "",
    communication: "",
    project_management: "",
    mentoring: "",
    firm_growth: "",
    competency_skills: "",
  };
}

function readFromGoal(goal: Goal): Record<CompetencyKey, string> {
  return {
    task_execution: goal.self_desc_task_execution ?? "",
    ownership: goal.self_desc_ownership ?? "",
    client_deliverables: goal.self_desc_client_deliverables ?? "",
    communication: goal.self_desc_communication ?? "",
    project_management: goal.self_desc_project_management ?? "",
    mentoring: goal.self_desc_mentoring ?? "",
    firm_growth: goal.self_desc_firm_growth ?? "",
    competency_skills: goal.self_desc_competency_skills ?? "",
  };
}

// ── Props ───────────────────────────────────────────────────────────

interface GoalSelfReviewModalProps {
  readonly isOpen: boolean;
  readonly goal: Goal | null;
  readonly onClose: () => void;
  readonly onSubmit: (payload: GoalSelfReviewPayload) => Promise<void>;
  readonly isSaving: boolean;
  readonly error: string;
}

// ── Component ───────────────────────────────────────────────────────

export function GoalSelfReviewModal({
  isOpen,
  goal,
  onClose,
  onSubmit,
  isSaving,
  error,
}: GoalSelfReviewModalProps) {
  const isSubmitted = Boolean(goal?.self_review_submitted_at);

  // Seed the form from the goal when it has a prior submission, else empty.
  const [form, setForm] = useState<Record<CompetencyKey, string>>(() =>
    goal && isSubmitted ? readFromGoal(goal) : emptyForm(),
  );

  // Re-seed when the modal is opened for a different goal.
  // Using a keyed remount in the parent would also work, but resetting
  // state on goal.id change keeps this component self-contained.
  const [lastGoalId, setLastGoalId] = useState<number | null>(goal?.id ?? null);
  if (goal && goal.id !== lastGoalId) {
    setLastGoalId(goal.id);
    setForm(isSubmitted ? readFromGoal(goal) : emptyForm());
  }

  if (!isOpen || !goal) return null;

  const setField = (key: CompetencyKey, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const allFilled = COMPETENCIES.every((c) => form[c.key].trim().length > 0);

  const handleSubmit = async () => {
    const payload: GoalSelfReviewPayload = {
      self_desc_task_execution: form.task_execution.trim(),
      self_desc_ownership: form.ownership.trim(),
      self_desc_client_deliverables: form.client_deliverables.trim(),
      self_desc_communication: form.communication.trim(),
      self_desc_project_management: form.project_management.trim(),
      self_desc_mentoring: form.mentoring.trim(),
      self_desc_firm_growth: form.firm_growth.trim(),
      self_desc_competency_skills: form.competency_skills.trim(),
    };
    await onSubmit(payload);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-review-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light">
              <ClipboardCheck
                className="h-5 w-5 text-brand"
                aria-hidden="true"
              />
            </div>
            <div>
              <h2
                id="self-review-modal-title"
                className="font-display text-base font-semibold text-text-main"
              >
                {isSubmitted ? "Self Review (Submitted)" : "Self Review"}
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                {goal.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-100 transition-colors"
            aria-label="Close self-review"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {!isSubmitted && (
            <p className="text-xs text-text-muted">
              Reflect on your delivery against this goal across all 8
              competencies. Once submitted, your mentor will review your
              self-assessment.
            </p>
          )}

          {COMPETENCIES.map((comp, idx) => (
            <div key={comp.key}>
              <label
                htmlFor={`goal-self-${comp.key}`}
                className="block text-xs font-semibold text-text-main mb-1"
              >
                {idx + 1}. {comp.label}
                {!isSubmitted && " *"}
              </label>
              {isSubmitted ? (
                <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm text-text-main whitespace-pre-wrap">
                  {form[comp.key] || "—"}
                </div>
              ) : (
                <textarea
                  id={`goal-self-${comp.key}`}
                  rows={4}
                  className={INPUT_CLS}
                  value={form[comp.key]}
                  onChange={(e) => setField(comp.key, e.target.value)}
                  placeholder={comp.placeholder}
                />
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <p className="text-xs text-text-muted">
            {isSubmitted
              ? "Self-review is locked once submitted."
              : "All 8 reflections are required."}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
            >
              {isSubmitted ? "Close" : "Cancel"}
            </button>
            {!isSubmitted && (
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
                {isSaving ? "Submitting…" : "Submit Self Review"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
