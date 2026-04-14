/**
 * PMEvaluationTab.tsx — PM's Team Evaluation Queue + Form.
 *
 * Shows cards for each team member the PM needs to evaluate.
 * Clicking "Evaluate" opens a full-page form with:
 *   - Employee context (name, role, department, designation)
 *   - Role expectations reference panel (collapsible per competency)
 *   - 7 competency text areas
 *   - Performance group dropdown
 *   - Impact statement
 *
 * Placement: src/components/project-reviews/PMEvaluationTab.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  UserCircle, Briefcase, Send, Loader2, X, ClipboardList,
  ChevronDown, ChevronUp, BookOpen, CalendarDays,
} from "lucide-react";
import {
  projectReviewService,
  type PMPendingReviewCard,
  type PMEvaluationPayload,
  type RoleExpectation,
  type PerformanceGroup,
} from "../../services/project-review.service";
import { getErrorMessage } from "../../utils/errors";

// ── Constants ───────────────────────────────────────────────────────

const COMPETENCIES = [
  { key: "task_execution", label: "Task Execution & Problem Solving", expKey: "exp_task_execution" },
  { key: "ownership", label: "Ownership & Accountability", expKey: "exp_ownership" },
  { key: "project_management", label: "Project Management and Risk Mitigation", expKey: "exp_project_management" },
  { key: "client_deliverables", label: "Building Client-Ready Deliverables", expKey: "exp_client_deliverables" },
  { key: "communication", label: "Communication & Client/Stakeholder Management", expKey: "exp_communication" },
  { key: "mentoring", label: "Mentoring and Team Development", expKey: "exp_mentoring" },
  { key: "competency_skills", label: "Competency and Skills", expKey: "exp_competency_skills" },
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

// ── Role Expectation Panel ──────────────────────────────────────────

function ExpectationPanel({
  expectation,
  expKey,
}: {
  readonly expectation: RoleExpectation | null;
  readonly expKey: string;
}) {
  const [open, setOpen] = useState(false);

  if (!expectation) return null;

  const text = (expectation as Record<string, unknown>)[expKey] as string | null;
  if (!text) return null;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors"
      >
        <BookOpen className="h-3 w-3" aria-hidden="true" />
        {open ? "Hide" : "View"} Role Expectations
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
          <p className="text-xs text-blue-800 whitespace-pre-wrap leading-relaxed">{text}</p>
          <p className="mt-1 text-[10px] text-blue-500">
            {expectation.department_name} / {expectation.designation_name}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Evaluation Modal ────────────────────────────────────────────────

interface EvalModalProps {
  readonly card: PMPendingReviewCard;
  readonly expectation: RoleExpectation | null;
  readonly onSubmit: (
    projectId: number,
    userId: number,
    payload: PMEvaluationPayload,
  ) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

function EvalModal({ card, expectation, onSubmit, onClose, isSaving, error }: EvalModalProps) {
  const [comments, setComments] = useState<Record<CompKey, string>>({
    task_execution: "",
    ownership: "",
    project_management: "",
    client_deliverables: "",
    communication: "",
    mentoring: "",
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
    await onSubmit(card.project_id, card.user_id, {
      performance_group: performanceGroup as PerformanceGroup,
      impact_statement: impactStatement,
      comment_task_execution: comments.task_execution,
      comment_ownership: comments.ownership,
      comment_project_management: comments.project_management,
      comment_client_deliverables: comments.client_deliverables,
      comment_communication: comments.communication,
      comment_mentoring: comments.mentoring,
      comment_competency_skills: comments.competency_skills,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pm-eval-title"
    >
      <div className="w-full max-w-3xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 id="pm-eval-title" className="font-display text-base font-semibold text-text-main">
              Evaluate: {card.employee_name}
            </h2>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
              <span>{card.project_name} ({card.project_code})</span>
              {card.assignment_role && <span>Role: {card.assignment_role}</span>}
              {card.department_name && <span>Dept: {card.department_name}</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
          )}

          {/* Performance Group */}
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

          {/* 7 Competency Evaluations */}
          {COMPETENCIES.map((comp, idx) => (
            <div key={comp.key}>
              <label
                htmlFor={`eval-${comp.key}`}
                className="block text-xs font-semibold text-text-main mb-1"
              >
                {idx + 1}. {comp.label} *
              </label>

              {/* Role expectations reference */}
              <ExpectationPanel expectation={expectation} expKey={comp.expKey} />

              <textarea
                id={`eval-${comp.key}`}
                rows={4}
                className={TEXTAREA_CLS}
                value={comments[comp.key]}
                onChange={(e) => setComment(comp.key, e.target.value)}
                placeholder={`Evaluate ${card.employee_name}'s ${comp.label.toLowerCase()}…`}
              />
            </div>
          ))}

          {/* Impact Statement */}
          <div>
            <label htmlFor="impact" className="block text-xs font-semibold text-text-main mb-1">
              Overall Impact Statement *
            </label>
            <p className="text-xs text-text-muted mb-2">
              Summarize {card.employee_name}'s overall impact and contribution on this project.
            </p>
            <textarea
              id="impact"
              rows={4}
              className={TEXTAREA_CLS}
              value={impactStatement}
              onChange={(e) => setImpactStatement(e.target.value)}
              placeholder="Describe overall impact, key achievements, and areas for growth…"
            />
          </div>
        </div>

        {/* Footer */}
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

// ── Team Member Card ────────────────────────────────────────────────

function TeamMemberCard({
  card,
  onEvaluate,
}: {
  readonly card: PMPendingReviewCard;
  readonly onEvaluate: (card: PMPendingReviewCard) => void;
}) {
  const isReviewed = card.review_status === "reviewed";

  return (
    <div className={`rounded-lg border bg-surface p-4 shadow-sm flex flex-col gap-3 ${
      isReviewed ? "border-green-200 bg-green-50/30" : "border-border"
    }`}>
      <div className="flex items-center gap-2">
        <UserCircle className="h-5 w-5 text-text-muted shrink-0" aria-hidden="true" />
        <p className="font-medium text-text-main">{card.employee_name}</p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-text-muted">
        <div className="flex items-center gap-1">
          <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {card.project_name}
          <span className="font-mono">({card.project_code})</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-text-muted">
        {card.assignment_role && (
          <span>Role: <span className="font-medium text-text-main">{card.assignment_role}</span></span>
        )}
        {card.department_name && (
          <span>Dept: <span className="font-medium text-text-main">{card.department_name}</span></span>
        )}
        {card.designation_name && (
          <span>Desig: <span className="font-medium text-text-main">{card.designation_name}</span></span>
        )}
      </div>

      {card.assigned_date && (
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Joined: {new Date(card.assigned_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </div>
      )}

      <div className="mt-auto pt-2 border-t border-border">
        {isReviewed ? (
          <span className="flex items-center justify-center gap-1.5 text-xs font-medium text-green-600 py-2">
            ✓ Evaluation Submitted
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onEvaluate(card)}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            Evaluate
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tab Component ───────────────────────────────────────────────────

export function PMEvaluationTab() {
  const [cards, setCards] = useState<PMPendingReviewCard[]>([]);
  const [expectations, setExpectations] = useState<RoleExpectation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [evalTarget, setEvalTarget] = useState<PMPendingReviewCard | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [queueData, expData] = await Promise.all([
        projectReviewService.getPMQueue(),
        projectReviewService.getRoleExpectations(),
      ]);
      setCards(queueData);
      setExpectations(expData);
    } catch {
      // stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /** Find the matching role expectation for the employee being evaluated */
  const getExpectation = (card: PMPendingReviewCard): RoleExpectation | null => {
    if (!card.department_name || !card.designation_name) return null;
    return expectations.find(
      (e) =>
        e.department_name === card.department_name &&
        e.designation_name === card.designation_name,
    ) ?? null;
  };

  const handleSubmit = async (
    projectId: number,
    userId: number,
    payload: PMEvaluationPayload,
  ) => {
    setIsSaving(true);
    setModalError("");
    try {
      await projectReviewService.submitPMEvaluation(projectId, userId, payload);
      // Update card status in place
      setCards((prev) =>
        prev.map((c) =>
          c.project_id === projectId && c.user_id === userId
            ? { ...c, review_status: "reviewed" }
            : c,
        ),
      );
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
        Loading evaluation queue…
      </div>
    );
  }

  const pending = cards.filter((c) => c.review_status !== "reviewed");
  const reviewed = cards.filter((c) => c.review_status === "reviewed");

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
        <ClipboardList className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">No team members to evaluate</p>
        <p className="mt-1 text-sm text-text-muted">You're not a Primary evaluator on any active projects, or all evaluations are complete.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
            Pending Evaluation ({pending.length})
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {pending.map((c) => (
              <TeamMemberCard
                key={`${c.project_id}-${c.user_id}`}
                card={c}
                onEvaluate={(card) => {
                  setModalError("");
                  setEvalTarget(card);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed */}
      {reviewed.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
            Completed ({reviewed.length})
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {reviewed.map((c) => (
              <TeamMemberCard
                key={`${c.project_id}-${c.user_id}`}
                card={c}
                onEvaluate={() => {}}
              />
            ))}
          </div>
        </div>
      )}

      {/* Evaluation Modal */}
      {evalTarget && (
        <EvalModal
          card={evalTarget}
          expectation={getExpectation(evalTarget)}
          onSubmit={handleSubmit}
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