/**
 * GoalMentorReviewModal.tsx — Split-panel modal for mentor review of a mentee's
 * self-review.
 *
 * Layout:
 *   Left panel  — read-only display of the mentee's 8 self-review answers.
 *   Right panel — mentor fills their 8 comment fields (or views them read-only
 *                 when a mentor review already exists).
 *
 * The modal is wider than the normal self-review modal (max-w-5xl) to give both
 * panels breathing room.  Each panel scrolls independently.
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { ClipboardCheck, Send, Loader2, X, User, MessageSquarePlus } from "lucide-react";
import type {
  Goal,
  GoalSelfReview,
  GoalMentorReview,
  GoalMentorReviewPayload,
  SelfReviewCycleHalf,
} from "../../services/goal.service";

// ── Competency schema ────────────────────────────────────────────────

const COMPETENCIES = [
  {
    key: "task_execution",
    label: "Task Execution & Problem Solving",
  },
  {
    key: "ownership",
    label: "Ownership & Accountability",
  },
  {
    key: "client_deliverables",
    label: "Building Client-Ready Deliverables",
  },
  {
    key: "communication",
    label: "Communication & Stakeholder Management",
  },
  {
    key: "project_management",
    label: "Project Management and Risk Mitigation",
  },
  {
    key: "mentoring",
    label: "Mentoring and Team Development",
  },
  {
    key: "firm_growth",
    label: "Firm Growth",
  },
  {
    key: "competency_skills",
    label: "Competency and Skills",
  },
] as const;

type CompetencyKey = (typeof COMPETENCIES)[number]["key"];

// ── Helpers ─────────────────────────────────────────────────────────

function emptyMentorForm(): Record<CompetencyKey, string> {
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

function selfReviewValue(sr: GoalSelfReview, key: CompetencyKey): string {
  const map: Record<CompetencyKey, keyof GoalSelfReview> = {
    task_execution:      "self_desc_task_execution",
    ownership:           "self_desc_ownership",
    client_deliverables: "self_desc_client_deliverables",
    communication:       "self_desc_communication",
    project_management:  "self_desc_project_management",
    mentoring:           "self_desc_mentoring",
    firm_growth:         "self_desc_firm_growth",
    competency_skills:   "self_desc_competency_skills",
  };
  return sr[map[key]] as string;
}

function mentorReviewValue(mr: GoalMentorReview, key: CompetencyKey): string {
  const map: Record<CompetencyKey, keyof GoalMentorReview> = {
    task_execution:      "mentor_comment_task_execution",
    ownership:           "mentor_comment_ownership",
    client_deliverables: "mentor_comment_client_deliverables",
    communication:       "mentor_comment_communication",
    project_management:  "mentor_comment_project_management",
    mentoring:           "mentor_comment_mentoring",
    firm_growth:         "mentor_comment_firm_growth",
    competency_skills:   "mentor_comment_competency_skills",
  };
  return mr[map[key]] as string;
}

function cycleLabel(goal: Goal, cycleHalf: SelfReviewCycleHalf): string {
  return goal.fy_year ? `${cycleHalf} FY ${goal.fy_year}` : cycleHalf;
}

// ── Props ────────────────────────────────────────────────────────────

interface GoalMentorReviewModalProps {
  readonly isOpen: boolean;
  readonly goal: Goal | null;
  readonly cycleHalf: SelfReviewCycleHalf | null;
  readonly onClose: () => void;
  readonly onSubmit: (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ) => Promise<void>;
  readonly isSaving: boolean;
  readonly error: string;
}

// ── Component ────────────────────────────────────────────────────────

export function GoalMentorReviewModal({
  isOpen,
  goal,
  cycleHalf,
  onClose,
  onSubmit,
  isSaving,
  error,
}: GoalMentorReviewModalProps) {
  const selfReview =
    goal && cycleHalf
      ? goal.self_reviews.find((sr) => sr.cycle_half === cycleHalf) ?? null
      : null;

  const existingMentorReview =
    goal && cycleHalf
      ? goal.mentor_reviews.find((mr) => mr.cycle_half === cycleHalf) ?? null
      : null;

  const isReadOnly = existingMentorReview !== null;

  const [form, setForm] = useState<Record<CompetencyKey, string>>(emptyMentorForm);

  useEffect(() => {
    if (!isOpen) return;
    if (existingMentorReview) {
      setForm({
        task_execution:      mentorReviewValue(existingMentorReview, "task_execution"),
        ownership:           mentorReviewValue(existingMentorReview, "ownership"),
        client_deliverables: mentorReviewValue(existingMentorReview, "client_deliverables"),
        communication:       mentorReviewValue(existingMentorReview, "communication"),
        project_management:  mentorReviewValue(existingMentorReview, "project_management"),
        mentoring:           mentorReviewValue(existingMentorReview, "mentoring"),
        firm_growth:         mentorReviewValue(existingMentorReview, "firm_growth"),
        competency_skills:   mentorReviewValue(existingMentorReview, "competency_skills"),
      });
    } else {
      setForm(emptyMentorForm());
    }
  }, [isOpen, goal?.id, cycleHalf]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen || !goal || !cycleHalf) return null;

  const setField = (key: CompetencyKey, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const allFilled = COMPETENCIES.every((c) => form[c.key].trim().length > 0);

  const handleSubmit = async () => {
    const payload: GoalMentorReviewPayload = {
      mentor_comment_task_execution:      form.task_execution.trim(),
      mentor_comment_ownership:           form.ownership.trim(),
      mentor_comment_client_deliverables: form.client_deliverables.trim(),
      mentor_comment_communication:       form.communication.trim(),
      mentor_comment_project_management:  form.project_management.trim(),
      mentor_comment_mentoring:           form.mentoring.trim(),
      mentor_comment_firm_growth:         form.firm_growth.trim(),
      mentor_comment_competency_skills:   form.competency_skills.trim(),
    };
    await onSubmit(cycleHalf, payload);
  };

  const label = cycleLabel(goal, cycleHalf);
  const title = isReadOnly
    ? `Mentor Review · ${label} (Submitted)`
    : `Mentor Review · ${label}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mentor-review-modal-title"
    >
      <div className="w-full max-w-5xl rounded-xl bg-surface shadow-xl flex flex-col max-h-[90vh]">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light shrink-0">
              <MessageSquarePlus className="h-5 w-5 text-brand" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="mentor-review-modal-title"
                className="font-display text-base font-semibold text-text-main"
              >
                {title}
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">{goal.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-100 transition-colors"
            aria-label="Close mentor review"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Body — two-panel layout ── */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left: Mentee self-review (read-only) */}
          <div className="w-1/2 border-r border-border flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-slate-50/80 shrink-0">
              <User className="h-4 w-4 text-text-muted" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Mentee Self Review
              </span>
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-4">
              {selfReview === null ? (
                <div className="rounded-lg border border-border bg-slate-50 px-4 py-6 text-center text-sm text-text-muted">
                  The mentee has not submitted their self-review for this half yet.
                </div>
              ) : (
                COMPETENCIES.map((comp, idx) => (
                  <div key={comp.key}>
                    <p className="text-xs font-semibold text-text-main mb-1">
                      {idx + 1}. {comp.label}
                    </p>
                    <div className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                      {selfReviewValue(selfReview, comp.key) || "—"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Mentor review (editable or read-only) */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-brand/5 shrink-0">
              <ClipboardCheck className="h-4 w-4 text-brand" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wider text-brand">
                Your Review
              </span>
              {isReadOnly && (
                <span className="ml-auto text-[10px] font-medium text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                  Submitted
                </span>
              )}
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-4">
              {error && (
                <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
                  {error}
                </p>
              )}

              {selfReview === null && !isReadOnly && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  You can only submit a mentor review once the mentee has submitted their self-review.
                </div>
              )}

              {(selfReview !== null || isReadOnly) &&
                COMPETENCIES.map((comp, idx) => (
                  <div key={comp.key}>
                    <label
                      htmlFor={`mentor-${comp.key}`}
                      className="block text-xs font-semibold text-text-main mb-1"
                    >
                      {idx + 1}. {comp.label}
                      {!isReadOnly && " *"}
                    </label>
                    {isReadOnly ? (
                      <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                        {form[comp.key] || "—"}
                      </div>
                    ) : (
                      <textarea
                        id={`mentor-${comp.key}`}
                        rows={3}
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none"
                        value={form[comp.key]}
                        onChange={(e) => setField(comp.key, e.target.value)}
                        placeholder={`Your assessment of the mentee's ${comp.label.toLowerCase()}…`}
                      />
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4 shrink-0">
          <p className="text-xs text-text-muted">
            {isReadOnly
              ? "Mentor review is locked once submitted."
              : selfReview === null
              ? "Waiting for mentee self-review."
              : "All 8 comments are required."}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
            >
              {isReadOnly ? "Close" : "Cancel"}
            </button>
            {!isReadOnly && selfReview !== null && (
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
                {isSaving ? "Submitting…" : "Submit Review"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
