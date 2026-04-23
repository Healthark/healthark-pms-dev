/**
 * EvaluationsTab.tsx — Primary + Secondary Evaluator's Pending Reviews.
 *
 * Two sections:
 *   1. Primary evaluations — full side-by-side 8-competency form
 *   2. Secondary evaluations — simple impact statement form
 *
 * Cards are color-coded so the user can instantly tell which type they are.
 *
 * Placement: src/components/project-reviews/EvaluationsTab.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  UserCircle, Briefcase, Send, Loader2, X, ClipboardList,
} from "lucide-react";
import {
  projectReviewService,
  type ProjectReviewResponse,
  type PrimaryEvalPayload,
  type SecondaryPeerPayload,
  type PerformanceGroup,
} from "../../services/project-review.service";
import { getErrorMessage } from "../../utils/errors";
import { useToast } from "../../hooks/useToast";

// ── Constants ───────────────────────────────────────────────────────

const COMPETENCIES = [
  { key: "task_execution", label: "Task Execution & Problem Solving" },
  { key: "ownership", label: "Ownership & Accountability" },
  { key: "project_management", label: "Project Management and Risk Mitigation" },
  { key: "client_deliverables", label: "Building Client-Ready Deliverables" },
  { key: "communication", label: "Communication & Client/Stakeholder Management" },
  { key: "mentoring", label: "Mentoring and Team Development" },
  { key: "firm_growth", label: "Firm Growth" },
  { key: "competency_skills", label: "Competency and Skills" },
] as const;

type CompKey = (typeof COMPETENCIES)[number]["key"];

const PERFORMANCE_GROUPS: PerformanceGroup[] = [
  "Needs Improvement",
  "Meeting Expectations",
  "Exceeding Expectations",
  "Meeting High Expectations",
  "Exceeding High Expectations",
];

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";
const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand";

// ── Primary Evaluation Modal ────────────────────────────────────────

interface PrimaryModalProps {
  readonly review: ProjectReviewResponse;
  readonly onSubmit: (reviewId: number, payload: PrimaryEvalPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

function PrimaryEvalModal({ review, onSubmit, onClose, isSaving, error }: PrimaryModalProps) {
  const [comments, setComments] = useState<Record<CompKey, string>>({
    task_execution: "",
    ownership: "",
    project_management: "",
    client_deliverables: "",
    communication: "",
    mentoring: "",
    firm_growth: "",
    competency_skills: "",
  });
  const [performanceGroup, setPerformanceGroup] = useState<PerformanceGroup | "">("");
  const [impactStatement, setImpactStatement] = useState("");

  const setComment = (key: CompKey, value: string) => {
    setComments((prev) => ({ ...prev, [key]: value }));
  };

  const allFilled =
    COMPETENCIES.every((c) => comments[c.key].trim().length > 0) &&
    performanceGroup !== "" &&
    impactStatement.trim().length > 0;

  const handleSubmit = async () => {
    await onSubmit(review.id, {
      performance_group: performanceGroup as PerformanceGroup,
      impact_statement: impactStatement,
      comment_task_execution: comments.task_execution,
      comment_ownership: comments.ownership,
      comment_project_management: comments.project_management,
      comment_client_deliverables: comments.client_deliverables,
      comment_communication: comments.communication,
      comment_mentoring: comments.mentoring,
      comment_firm_growth: comments.firm_growth,
      comment_competency_skills: comments.competency_skills,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="primary-eval-title"
    >
      <div className="w-full max-w-3xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 id="primary-eval-title" className="font-display text-base font-semibold text-text-main">
              Primary Evaluation
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {review.employee_name} — {review.project_name}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
          )}

          <div>
            <label htmlFor="perf-group" className="block text-xs font-semibold text-text-main mb-1">
              Performance Group *
            </label>
            <select
              id="perf-group"
              className={INPUT_CLS}
              value={performanceGroup}
              onChange={(e) => setPerformanceGroup(e.target.value as PerformanceGroup)}
            >
              <option value="">Select…</option>
              {PERFORMANCE_GROUPS.map((pg) => (
                <option key={pg} value={pg}>{pg}</option>
              ))}
            </select>
          </div>

          {COMPETENCIES.map((comp, idx) => {
            const selfKey = `self_desc_${comp.key}` as keyof ProjectReviewResponse;
            const selfValue = (review[selfKey] as string | null) ?? "—";

            return (
              <div key={comp.key} className="rounded-lg border border-border overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-border">
                  <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                    {idx + 1}. {comp.label}
                  </p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
                  <div className="p-4">
                    <p className="text-xs font-medium text-text-muted mb-1">Employee's Self-Assessment</p>
                    <p className="text-sm text-text-main whitespace-pre-wrap">{selfValue}</p>
                  </div>
                  <div className="p-4">
                    <label
                      htmlFor={`eval-${comp.key}`}
                      className="block text-xs font-medium text-brand mb-1"
                    >
                      Your Evaluation *
                    </label>
                    <textarea
                      id={`eval-${comp.key}`}
                      rows={4}
                      className={TEXTAREA_CLS}
                      value={comments[comp.key]}
                      onChange={(e) => setComment(comp.key, e.target.value)}
                      placeholder={`Your evaluation of ${comp.label.toLowerCase()}…`}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <div>
            <label htmlFor="impact" className="block text-xs font-semibold text-text-main mb-1">
              Overall Impact Statement *
            </label>
            <p className="text-xs text-text-muted mb-2">
              Summarize this employee's overall impact and contribution on the project.
            </p>
            <textarea
              id="impact"
              rows={4}
              className={TEXTAREA_CLS}
              value={impactStatement}
              onChange={(e) => setImpactStatement(e.target.value)}
              placeholder="Describe the employee's overall impact, key achievements, and areas for growth…"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !allFilled}
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {isSaving ? "Submitting…" : "Submit Evaluation"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Secondary Impact Modal ──────────────────────────────────────────

interface SecondaryModalProps {
  readonly review: ProjectReviewResponse;
  readonly onSubmit: (reviewId: number, payload: SecondaryPeerPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

function SecondaryEvalModal({ review, onSubmit, onClose, isSaving, error }: SecondaryModalProps) {
  const [impactStatement, setImpactStatement] = useState("");

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="secondary-eval-title"
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h2 id="secondary-eval-title" className="font-display text-base font-semibold text-text-main">
            Secondary Evaluation
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {review.employee_name} — {review.project_name}
          </p>
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
              Share your perspective on this team member's contribution to the project.
            </p>
            <textarea
              id="sec-impact"
              rows={5}
              className={TEXTAREA_CLS}
              value={impactStatement}
              onChange={(e) => setImpactStatement(e.target.value)}
              placeholder="Describe your observations about this employee's impact, collaboration, and contributions…"
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

function EvalCard({
  review,
  evalType,
  onEvaluate,
}: {
  readonly review: ProjectReviewResponse;
  readonly evalType: "Primary" | "Secondary";
  readonly onEvaluate: (review: ProjectReviewResponse, type: "Primary" | "Secondary") => void;
}) {
  const isPrimary = evalType === "Primary";

  return (
    <div className={`rounded-lg border bg-surface p-4 shadow-sm flex flex-col gap-3 ${
      isPrimary ? "border-brand/30" : "border-border"
    }`}>
      <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isPrimary
          ? "bg-brand-light text-brand"
          : "bg-slate-100 text-slate-600"
      }`}>
        {evalType} Evaluator
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
          Submitted
        </span>
        <span className="text-xs text-text-muted">Cycle: {review.cycle}</span>
      </div>

      <button
        type="button"
        onClick={() => onEvaluate(review, evalType)}
        className={`mt-auto rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity ${
          isPrimary ? "bg-brand" : "bg-slate-600"
        }`}
      >
        {isPrimary ? "Evaluate (Full Review)" : "Write Impact Statement"}
      </button>
    </div>
  );
}

// ── Tab Component ───────────────────────────────────────────────────

export function EvaluationsTab() {
  const toast = useToast();
  const [primaryReviews, setPrimaryReviews] = useState<ProjectReviewResponse[]>([]);
  const [secondaryReviews, setSecondaryReviews] = useState<ProjectReviewResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [evalTarget, setEvalTarget] = useState<ProjectReviewResponse | null>(null);
  const [evalMode, setEvalMode] = useState<"primary" | "secondary" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadReviews = useCallback(async () => {
    setIsLoading(true);
    try {
      const [primaryData, secondaryData] = await Promise.all([
        projectReviewService.getPendingEvaluations(),
        projectReviewService.getPendingSecondaryEvaluations(),
      ]);
      setPrimaryReviews(primaryData);
      setSecondaryReviews(secondaryData);
    } catch {
      // stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const openEval = (review: ProjectReviewResponse, type: "Primary" | "Secondary") => {
    setEvalTarget(review);
    setEvalMode(type === "Primary" ? "primary" : "secondary");
    setModalError("");
  };

  const closeModal = () => {
    setEvalTarget(null);
    setEvalMode(null);
    setModalError("");
  };

  const handlePrimarySubmit = async (reviewId: number, payload: PrimaryEvalPayload) => {
    setIsSaving(true);
    setModalError("");
    try {
      await projectReviewService.submitPrimaryEval(reviewId, payload);
      setPrimaryReviews((prev) => prev.filter((r) => r.id !== reviewId));
      closeModal();
      toast.success("Primary evaluation submitted.");
    } catch (err: unknown) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSecondarySubmit = async (reviewId: number, payload: SecondaryPeerPayload) => {
    setIsSaving(true);
    setModalError("");
    try {
      await projectReviewService.submitSecondaryPeerEval(reviewId, payload);
      setSecondaryReviews((prev) => prev.filter((r) => r.id !== reviewId));
      closeModal();
      toast.success("Impact statement submitted.");
    } catch (err: unknown) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">
        Loading pending evaluations…
      </div>
    );
  }

  const totalPending = primaryReviews.length + secondaryReviews.length;

  if (totalPending === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
        <ClipboardList className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">
          No pending evaluations
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Team members haven't submitted their self-reviews yet, or you've already evaluated them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-muted">
        {totalPending} evaluation(s) awaiting your input.
      </p>

      {primaryReviews.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
            Primary Evaluations ({primaryReviews.length})
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {primaryReviews.map((r) => (
              <EvalCard
                key={`primary-${r.id}`}
                review={r}
                evalType="Primary"
                onEvaluate={openEval}
              />
            ))}
          </div>
        </div>
      )}

      {secondaryReviews.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
            Secondary Evaluations ({secondaryReviews.length})
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {secondaryReviews.map((r) => (
              <EvalCard
                key={`secondary-${r.id}`}
                review={r}
                evalType="Secondary"
                onEvaluate={openEval}
              />
            ))}
          </div>
        </div>
      )}

      {evalTarget && evalMode === "primary" && (
        <PrimaryEvalModal
          review={evalTarget}
          onSubmit={handlePrimarySubmit}
          onClose={closeModal}
          isSaving={isSaving}
          error={modalError}
        />
      )}

      {evalTarget && evalMode === "secondary" && (
        <SecondaryEvalModal
          review={evalTarget}
          onSubmit={handleSecondarySubmit}
          onClose={closeModal}
          isSaving={isSaving}
          error={modalError}
        />
      )}
    </div>
  );
}