/**
 * SelfReviewForm.tsx — Employee Self-Review Form (8 Competencies).
 *
 * Shows a full-page form with:
 *   - Project context header (name, code, dates, role)
 *   - 8 competency text areas with descriptive placeholders
 *   - Submit button (all fields required)
 *   - Back navigation
 *
 * On submit, the review is immediately set to "Submitted" status
 * and the employee is returned to the project list.
 *
 * Placement: src/components/project-reviews/SelfReviewForm.tsx
 */

import { useState } from "react";
import { ArrowLeft, Send, Loader2, Briefcase, CalendarDays } from "lucide-react";
import {
  projectReviewService,
  type MyProjectReviewCard,
  type SelfReviewPayload,
} from "../../services/project-review.service";
import { getErrorMessage } from "../../utils/errors";
import { useToast } from "../../hooks/useToast";
import { useConfirm } from "../../hooks/useConfirm";

// ── 8 Competencies ──────────────────────────────────────────────────

const COMPETENCIES = [
  {
    key: "task_execution",
    label: "Task Execution & Problem Solving",
    placeholder: "Describe how you approached tasks, solved problems, and delivered results on this project.",
  },
  {
    key: "ownership",
    label: "Ownership & Accountability",
    placeholder: "Describe how you took ownership of your deliverables, met commitments, and held yourself accountable.",
  },
  {
    key: "project_management",
    label: "Project Management and Risk Mitigation",
    placeholder: "Describe how you managed timelines, resources, dependencies, and identified/mitigated risks.",
  },
  {
    key: "client_deliverables",
    label: "Building Client-Ready Deliverables",
    placeholder: "Describe the quality of your deliverables, attention to detail, and client-readiness of your outputs.",
  },
  {
    key: "communication",
    label: "Communication & Client/Stakeholder Management",
    placeholder: "Describe how you communicated with clients, stakeholders, and team members throughout the project.",
  },
  {
    key: "mentoring",
    label: "Mentoring and Team Development",
    placeholder: "Describe how you helped team members grow, shared knowledge, or mentored junior colleagues.",
  },
  {
    key: "firm_growth",
    label: "Firm Growth",
    placeholder: "Describe any contributions to business development, proposals, thought leadership, or organizational growth.",
  },
  {
    key: "competency_skills",
    label: "Competency and Skills",
    placeholder: "Describe new skills you developed, certifications earned, or areas of expertise you deepened during this project.",
  },
] as const;

type CompetencyKey = (typeof COMPETENCIES)[number]["key"];

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

// ── Helpers ─────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Component ───────────────────────────────────────────────────────

interface SelfReviewFormProps {
  readonly card: MyProjectReviewCard;
  readonly onBack: () => void;
}

export function SelfReviewForm({ card, onBack }: SelfReviewFormProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<Record<CompetencyKey, string>>({
    task_execution: "",
    ownership: "",
    project_management: "",
    client_deliverables: "",
    communication: "",
    mentoring: "",
    firm_growth: "",
    competency_skills: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const setField = (key: CompetencyKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const allFilled = COMPETENCIES.every((c) => form[c.key].trim().length > 0);

  const handleSubmit = async () => {
    const ok = await confirm({
      title: "Submit project self-review?",
      message: `Submit your self-review for ${card.project_name} (${card.project_code}). Once submitted you can't edit it, and your PM will receive it for primary evaluation.`,
      variant: "warning",
      confirmText: "Submit Self-Review",
    });
    if (!ok) return;
    setIsSaving(true);
    setError("");
    try {
      const payload: SelfReviewPayload = {
        project_id: card.project_id,
        self_desc_task_execution: form.task_execution,
        self_desc_ownership: form.ownership,
        self_desc_project_management: form.project_management,
        self_desc_client_deliverables: form.client_deliverables,
        self_desc_communication: form.communication,
        self_desc_mentoring: form.mentoring,
        self_desc_firm_growth: form.firm_growth,
        self_desc_competency_skills: form.competency_skills,
      };
      await projectReviewService.submitSelfReview(payload);
      toast.success("Self-review submitted.");
      onBack(); // Return to list — card will show "Submitted" status
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-brand transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to My Reviews
      </button>

      {/* Project context header */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light">
            <Briefcase className="h-5 w-5 text-brand" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold text-text-main">
              {card.project_name}
            </h1>
            <span className="text-xs text-text-muted font-mono">
              {card.project_code}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-text-muted">
          {card.assignment_role && (
            <span>
              Role: <span className="font-medium text-text-main">{card.assignment_role}</span>
            </span>
          )}
          <div className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            Project: {formatDate(card.project_start_date)}
            {card.project_end_date && ` — ${formatDate(card.project_end_date)}`}
          </div>
          {card.assigned_date && (
            <div className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              You joined: {formatDate(card.assigned_date)}
            </div>
          )}
          {card.cycle && (
            <span>
              Cycle: <span className="font-medium text-text-main">{card.cycle}</span>
            </span>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm space-y-6">
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">
            Self-Assessment
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Reflect on your contributions across 8 competency areas. Once
            submitted, your project manager will review it alongside their own
            evaluation.
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
            {error}
          </p>
        )}

        {/* 8 Competency Fields */}
        <div className="space-y-5">
          {COMPETENCIES.map((comp, idx) => (
            <div key={comp.key}>
              <label
                htmlFor={`comp-${comp.key}`}
                className="block text-xs font-semibold text-text-main mb-1"
              >
                {idx + 1}. {comp.label} *
              </label>
              <textarea
                id={`comp-${comp.key}`}
                rows={4}
                className={TEXTAREA_CLS}
                value={form[comp.key]}
                onChange={(e) => setField(comp.key, e.target.value)}
                placeholder={comp.placeholder}
              />
            </div>
          ))}
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between border-t border-border pt-5">
          <p className="text-xs text-text-muted">
            Once submitted, your self-review cannot be edited.
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !allFilled}
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSaving ? "Submitting…" : "Submit Self-Review"}
          </button>
        </div>
      </div>
    </div>
  );
}