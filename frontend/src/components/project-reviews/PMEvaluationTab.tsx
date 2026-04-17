/**
 * PMEvaluationTab.tsx — PM's Team Evaluation Queue + Form.
 *
 * Pending cards  → "Evaluate" button  → creates a new review (POST)
 * Completed cards → "Edit Evaluation" → pre-fills form from GET, saves via PUT
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  UserCircle, Briefcase, Send, Loader2, X, ClipboardList,
  ChevronDown, ChevronUp, BookOpen, CalendarDays, Info, Pencil,
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
  { key: "task_execution",     label: "Task Execution & Problem Solving",           expKey: "exp_task_execution" },
  { key: "ownership",          label: "Ownership & Accountability",                  expKey: "exp_ownership" },
  { key: "project_management", label: "Project Management and Risk Mitigation",      expKey: "exp_project_management" },
  { key: "client_deliverables",label: "Building Client-Ready Deliverables",          expKey: "exp_client_deliverables" },
  { key: "communication",      label: "Communication & Client/Stakeholder Management",expKey: "exp_communication" },
  { key: "mentoring",          label: "Mentoring and Team Development",              expKey: "exp_mentoring" },
  { key: "competency_skills",  label: "Competency and Skills",                       expKey: "exp_competency_skills" },
] as const;

type CompKey = (typeof COMPETENCIES)[number]["key"];

const EMPTY_COMMENTS: Record<CompKey, string> = {
  task_execution: "",
  ownership: "",
  project_management: "",
  client_deliverables: "",
  communication: "",
  mentoring: "",
  competency_skills: "",
};

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

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
          <p className="text-xs text-blue-800 whitespace-pre-wrap leading-relaxed">
            {text.replace(/ \| /g, "\n• ")}
          </p>
          <p className="mt-1 text-[10px] text-blue-500">
            {expectation.department_name} / {expectation.designation_name}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Modal Skeleton ──────────────────────────────────────────────────

function ModalFormSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 animate-pulse">
      {/* Rating row */}
      <div className="space-y-1.5">
        <div className="h-3 w-40 rounded bg-slate-100" />
        <div className="h-9 w-24 rounded-lg bg-slate-100" />
      </div>
      {/* 7 competency fields */}
      {COMPETENCIES.map((c) => (
        <div key={c.key} className="space-y-1.5">
          <div className="h-3 w-48 rounded bg-slate-100" />
          <div className="h-24 rounded-lg bg-slate-100" />
        </div>
      ))}
      {/* Impact statement */}
      <div className="space-y-1.5">
        <div className="h-3 w-44 rounded bg-slate-100" />
        <div className="h-24 rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

// ── Evaluation Modal ────────────────────────────────────────────────

interface EvalModalProps {
  readonly card: PMPendingReviewCard;
  readonly expectation: RoleExpectation | null;
  readonly isEditMode: boolean;
  /** Unified submit — parent decides POST vs PUT based on isEditMode */
  readonly onSubmit: (payload: PMEvaluationPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

function EvalModal({
  card,
  expectation,
  isEditMode,
  onSubmit,
  onClose,
  isSaving,
  error,
}: EvalModalProps) {
  const [isLoadingReview, setIsLoadingReview] = useState(isEditMode);
  const [fetchError, setFetchError] = useState("");

  const [comments, setComments] = useState<Record<CompKey, string>>(EMPTY_COMMENTS);
  const [performanceGroup, setPerformanceGroup] = useState<PerformanceGroup | "">("");
  const [impactStatement, setImpactStatement] = useState("");

  // Pre-fill form when opening in edit mode
  useEffect(() => {
    if (!isEditMode || !card.review_id) return;

    setIsLoadingReview(true);
    setFetchError("");

    projectReviewService
      .getReview(card.review_id)
      .then((review) => {
        setComments({
          task_execution:      review.comment_task_execution      ?? "",
          ownership:           review.comment_ownership           ?? "",
          project_management:  review.comment_project_management  ?? "",
          client_deliverables: review.comment_client_deliverables ?? "",
          communication:       review.comment_communication       ?? "",
          mentoring:           review.comment_mentoring           ?? "",
          competency_skills:   review.comment_competency_skills   ?? "",
        });
        setPerformanceGroup((review.performance_group ?? "") as PerformanceGroup | "");
        setImpactStatement(review.impact_statement ?? "");
      })
      .catch(() =>
        setFetchError("Failed to load evaluation data. Please close and try again."),
      )
      .finally(() => setIsLoadingReview(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  const setComment = (key: CompKey, value: string) =>
    setComments((prev) => ({ ...prev, [key]: value }));

  const allFilled =
    COMPETENCIES.every((c) => comments[c.key].trim().length > 0) &&
    performanceGroup !== "" &&
    impactStatement.trim().length > 0;

  const handleSubmit = async () => {
    await onSubmit({
      performance_group:           performanceGroup as PerformanceGroup,
      impact_statement:            impactStatement,
      comment_task_execution:      comments.task_execution,
      comment_ownership:           comments.ownership,
      comment_project_management:  comments.project_management,
      comment_client_deliverables: comments.client_deliverables,
      comment_communication:       comments.communication,
      comment_mentoring:           comments.mentoring,
      comment_competency_skills:   comments.competency_skills,
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

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              {isEditMode && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Editing
                </span>
              )}
              <h2
                id="pm-eval-title"
                className="font-display text-base font-semibold text-text-main"
              >
                {isEditMode ? "Edit Evaluation" : "Evaluate"}: {card.employee_name}
              </h2>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
              <span>{card.project_name} ({card.project_code})</span>
              {card.assignment_role && <span>Role: {card.assignment_role}</span>}
              {card.department_name && <span>Dept: {card.department_name}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* ── Body ── */}
        {isLoadingReview ? (
          <ModalFormSkeleton />
        ) : fetchError ? (
          <div className="flex-1 flex items-center justify-center px-6 py-10">
            <p className="rounded-lg bg-red-50 px-5 py-4 text-sm text-red-600 text-center max-w-sm">
              {fetchError}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
                {error}
              </p>
            )}

            {/* Performance Group */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <label htmlFor="perf-group" className="text-[13px] font-bold text-text-main">
                  Overall Performance Rating
                </label>
                <div className="group relative inline-flex items-center">
                  <Info className="h-3.5 w-3.5 text-text-muted cursor-default" aria-hidden="true" />
                  <div className="invisible group-hover:visible pointer-events-none absolute top-full left-0 z-50 mt-2 w-72 rounded-lg border border-border bg-white px-3 py-2.5 text-xs text-text-main shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <div className="absolute left-3 bottom-full border-4 border-transparent border-b-border" />
                    <p className="font-semibold mb-1.5 text-text-main">Rating Guide</p>
                    <ul className="space-y-1.5 text-text-muted">
                      <li><span className="font-semibold text-text-main">Rating 1 —</span> Performed beyond expectations; significantly exceeded project goals.</li>
                      <li><span className="font-semibold text-text-main">Rating 2 —</span> Performed at the expected level but exceeded goals.</li>
                      <li><span className="font-semibold text-text-main">Rating 3 —</span> Performed at the expected level and achieved goals.</li>
                      <li><span className="font-semibold text-text-main">Rating 4 —</span> Did not perform at the expected level; partially achieved goals.</li>
                      <li><span className="font-semibold text-text-main">Rating 5 —</span> Did not perform at the expected level; did not achieve goals.</li>
                    </ul>
                  </div>
                </div>
              </div>
              <select
                id="perf-group"
                value={performanceGroup}
                onChange={(e) => setPerformanceGroup(e.target.value as PerformanceGroup)}
                className="w-24 rounded-lg border border-border bg-white px-3 py-2 text-[13px] outline-none focus:border-brand"
              >
                <option value="" disabled>Select</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
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
        )}

        {/* ── Footer ── */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !allFilled || isLoadingReview || !!fetchError}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity ${
              isEditMode ? "bg-amber-500" : "bg-brand"
            }`}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : isEditMode ? (
              <Pencil className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSaving
              ? isEditMode ? "Saving…" : "Submitting…"
              : isEditMode ? "Save Changes" : "Submit Evaluation"}
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
  onEdit,
}: {
  readonly card: PMPendingReviewCard;
  readonly onEvaluate: (card: PMPendingReviewCard) => void;
  readonly onEdit: (card: PMPendingReviewCard) => void;
}) {
  const isReviewed = card.review_status === "reviewed";

  return (
    <div
      className={`rounded-lg border bg-surface p-4 shadow-sm flex flex-col gap-3 ${
        isReviewed ? "border-green-200 bg-green-50/30" : "border-border"
      }`}
    >
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
          <span>
            Role:{" "}
            <span className="font-medium text-text-main">{card.assignment_role}</span>
          </span>
        )}
        {card.department_name && (
          <span>
            Dept:{" "}
            <span className="font-medium text-text-main">{card.department_name}</span>
          </span>
        )}
        {card.designation_name && (
          <span>
            Desig:{" "}
            <span className="font-medium text-text-main">{card.designation_name}</span>
          </span>
        )}
      </div>

      {card.assigned_date && (
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Joined:{" "}
          {new Date(card.assigned_date).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </div>
      )}

      <div className="mt-auto pt-2 border-t border-border">
        {isReviewed ? (
          <button
            type="button"
            onClick={() => onEdit(card)}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit Evaluation
          </button>
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
  const [isEditMode, setIsEditMode] = useState(false);
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

  const getExpectation = (card: PMPendingReviewCard): RoleExpectation | null => {
    if (!card.department_name || !card.designation_name) return null;
    return (
      expectations.find(
        (e) =>
          e.department_name === card.department_name &&
          e.designation_name === card.designation_name,
      ) ?? null
    );
  };

  const openCreate = (card: PMPendingReviewCard) => {
    setIsEditMode(false);
    setModalError("");
    setEvalTarget(card);
  };

  const openEdit = (card: PMPendingReviewCard) => {
    setIsEditMode(true);
    setModalError("");
    setEvalTarget(card);
  };

  const closeModal = () => {
    setEvalTarget(null);
    setIsEditMode(false);
    setModalError("");
  };

  const handleSubmit = async (payload: PMEvaluationPayload) => {
    if (!evalTarget) return;
    setIsSaving(true);
    setModalError("");
    try {
      if (isEditMode && evalTarget.review_id != null) {
        await projectReviewService.updateReview(evalTarget.review_id, payload);
        // Status stays "reviewed" — no card update needed
      } else {
        await projectReviewService.submitPMEvaluation(
          evalTarget.project_id,
          evalTarget.user_id,
          payload,
        );
        // Promote card to "reviewed" in-place
        setCards((prev) =>
          prev.map((c) =>
            c.project_id === evalTarget.project_id && c.user_id === evalTarget.user_id
              ? { ...c, review_status: "reviewed" }
              : c,
          ),
        );
      }
      closeModal();
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

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <ClipboardList className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">
          No team members to evaluate
        </p>
        <p className="mt-1 text-sm text-text-muted">
          You're not a Primary evaluator on any active projects, or all evaluations are
          complete.
        </p>
      </div>
    );
  }

  const pending  = cards.filter((c) => c.review_status !== "reviewed");
  const reviewed = cards.filter((c) => c.review_status === "reviewed");

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* Pending Evaluations */}
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
                onEvaluate={openCreate}
                onEdit={openEdit}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed Evaluations */}
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
                onEvaluate={openCreate}
                onEdit={openEdit}
              />
            ))}
          </div>
        </div>
      )}

      {/* Evaluation / Edit Modal */}
      {evalTarget && (
        <EvalModal
          card={evalTarget}
          expectation={getExpectation(evalTarget)}
          isEditMode={isEditMode}
          onSubmit={handleSubmit}
          onClose={closeModal}
          isSaving={isSaving}
          error={modalError}
        />
      )}
    </div>
  );
}
