/**
 * PMEvaluationTab.tsx — Unified Evaluation Queue (Primary + Secondary).
 *
 * Merges PM primary evaluations and secondary impact statements into one
 * table/card view with a Type column and filter.
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  UserCircle, Briefcase, Send, Loader2, X, ClipboardList,
  ChevronDown, ChevronUp, BookOpen, Info, Pencil,
  LayoutGrid, Table2, Search, CheckCircle2, Clock,
} from "lucide-react";
import {
  projectReviewService,
  type PMPendingReviewCard,
  type PMEvaluationPayload,
  type ProjectReviewResponse,
  type SecondaryEvalPayload,
  type RoleExpectation,
  type PerformanceGroup,
} from "../../services/project-review.service";
import { getErrorMessage } from "../../utils/errors";
import { useAuth } from "../../hooks/useAuth";
import { SortableHeader } from "../SortableHeader";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";

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
type ViewMode = "grid" | "table";
type EvalType = "primary" | "secondary";

const EMPTY_COMMENTS: Record<CompKey, string> = {
  task_execution: "", ownership: "", project_management: "",
  client_deliverables: "", communication: "", mentoring: "", competency_skills: "",
};

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

// ── Sort column config ──────────────────────────────────────────────
// Employee / Project / Type / Dept are alpha; project_code is alphanumeric;
// rating (performance_group) is a 1–5 numeric-like string. Action is not sortable.
type EvalSortKey =
  | "employee_name"
  | "project_name"
  | "type"
  | "department_name"
  | "review_status"
  | "performance_group";

// Declared below the UnifiedEvalRow definition via an inline `Record` in the
// component — kept as SortKind values rather than a separate constant so the
// getters close over the right type.

// ── Unified Row Type ────────────────────────────────────────────────

interface UnifiedEvalRow {
  key: string;
  type: EvalType;
  employee_name: string;
  project_id: number;
  project_name: string;
  project_code: string;
  department_name: string | null;
  designation_name: string | null;
  assignment_role: string | null;
  review_status: string; // "pending" | "reviewed" | "submitted"
  review_id: number | null;
  user_id: number | null;
  cycle: string | null;
  performance_group: string | null;
  // Secondary-specific
  secondaryReview?: ProjectReviewResponse;
  existingImpact?: string;
}

const EVAL_SORT_CONFIG: Record<EvalSortKey, { kind: SortKind; get: (r: UnifiedEvalRow) => unknown }> = {
  employee_name:     { kind: "alpha",   get: (r) => r.employee_name },
  project_name:      { kind: "alpha",   get: (r) => r.project_name },
  type:              { kind: "alpha",   get: (r) => r.type },
  department_name:   { kind: "alpha",   get: (r) => r.department_name },
  review_status:     { kind: "alpha",   get: (r) => r.review_status },
  performance_group: { kind: "numeric", get: (r) => r.performance_group },
};

// ── Role Expectation Panel ──────────────────────────────────────────

function ExpectationPanel({
  expectation, expKey,
}: { readonly expectation: RoleExpectation | null; readonly expKey: string }) {
  const [open, setOpen] = useState(false);
  if (!expectation) return null;
  const text = (expectation as Record<string, unknown>)[expKey] as string | null;
  if (!text) return null;

  return (
    <div className="mb-2">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors">
        <BookOpen className="h-3 w-3" />
        {open ? "Hide" : "View"} Role Expectations
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
          <p className="text-xs text-blue-800 whitespace-pre-wrap leading-relaxed">{text.replace(/ \| /g, "\n• ")}</p>
          <p className="mt-1 text-[10px] text-blue-500">{expectation.department_name} / {expectation.designation_name}</p>
        </div>
      )}
    </div>
  );
}

// ── PM Evaluation Modal ─────────────────────────────────────────────

function EvalModal({
  card, expectation, isEditMode, onSubmit, onClose, isSaving, error,
}: {
  readonly card: UnifiedEvalRow;
  readonly expectation: RoleExpectation | null;
  readonly isEditMode: boolean;
  readonly onSubmit: (payload: PMEvaluationPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}) {
  const [isLoadingReview, setIsLoadingReview] = useState(isEditMode);
  const [fetchError, setFetchError] = useState("");
  const [comments, setComments] = useState<Record<CompKey, string>>(EMPTY_COMMENTS);
  const [performanceGroup, setPerformanceGroup] = useState<PerformanceGroup | "">("");
  const [impactStatement, setImpactStatement] = useState("");

  useEffect(() => {
    if (!isEditMode || !card.review_id) return;
    setIsLoadingReview(true);
    projectReviewService.getReview(card.review_id)
      .then((review) => {
        setComments({
          task_execution: review.comment_task_execution ?? "", ownership: review.comment_ownership ?? "",
          project_management: review.comment_project_management ?? "", client_deliverables: review.comment_client_deliverables ?? "",
          communication: review.comment_communication ?? "", mentoring: review.comment_mentoring ?? "",
          competency_skills: review.comment_competency_skills ?? "",
        });
        setPerformanceGroup((review.performance_group ?? "") as PerformanceGroup | "");
        setImpactStatement(review.impact_statement ?? "");
      })
      .catch(() => setFetchError("Failed to load evaluation data."))
      .finally(() => setIsLoadingReview(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setComment = (key: CompKey, value: string) => setComments((prev) => ({ ...prev, [key]: value }));
  const allFilled = COMPETENCIES.every((c) => comments[c.key].trim().length > 0) && performanceGroup !== "" && impactStatement.trim().length > 0;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              {isEditMode && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">Editing</span>}
              <h2 className="font-display text-base font-semibold text-text-main">{isEditMode ? "Edit Evaluation" : "Evaluate"}: {card.employee_name}</h2>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
              <span>{card.project_name} ({card.project_code})</span>
              {card.department_name && <span>Dept: {card.department_name}</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {isLoadingReview ? (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 animate-pulse">
            {COMPETENCIES.map((c) => <div key={c.key} className="space-y-1.5"><div className="h-3 w-48 rounded bg-slate-100" /><div className="h-24 rounded-lg bg-slate-100" /></div>)}
          </div>
        ) : fetchError ? (
          <div className="flex-1 flex items-center justify-center px-6 py-10"><p className="rounded-lg bg-red-50 px-5 py-4 text-sm text-red-600 text-center max-w-sm">{fetchError}</p></div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <label htmlFor="perf-group" className="text-[13px] font-bold text-text-main">Overall Performance Rating</label>
                <div className="group relative inline-flex items-center">
                  <Info className="h-3.5 w-3.5 text-text-muted cursor-default" />
                  <div className="invisible group-hover:visible pointer-events-none absolute top-full left-0 z-50 mt-2 w-72 rounded-lg border border-border bg-white px-3 py-2.5 text-xs text-text-main shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <div className="absolute left-3 bottom-full border-4 border-transparent border-b-border" />
                    <p className="font-semibold mb-1.5">Rating Guide</p>
                    <ul className="space-y-1.5 text-text-muted">
                      <li><span className="font-semibold text-text-main">1 —</span> Performed beyond expectations</li>
                      <li><span className="font-semibold text-text-main">2 —</span> Exceeded goals at expected level</li>
                      <li><span className="font-semibold text-text-main">3 —</span> Achieved goals at expected level</li>
                      <li><span className="font-semibold text-text-main">4 —</span> Partially achieved goals</li>
                      <li><span className="font-semibold text-text-main">5 —</span> Did not achieve goals</li>
                    </ul>
                  </div>
                </div>
              </div>
              <select id="perf-group" value={performanceGroup} onChange={(e) => setPerformanceGroup(e.target.value as PerformanceGroup)}
                className="w-24 rounded-lg border border-border bg-white px-3 py-2 text-[13px] outline-none focus:border-brand">
                <option value="" disabled>Select</option>
                <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>
              </select>
            </div>
            {COMPETENCIES.map((comp, idx) => (
              <div key={comp.key}>
                <label htmlFor={`eval-${comp.key}`} className="block text-xs font-semibold text-text-main mb-1">{idx + 1}. {comp.label} *</label>
                <ExpectationPanel expectation={expectation} expKey={comp.expKey} />
                <textarea id={`eval-${comp.key}`} rows={4} className={TEXTAREA_CLS} value={comments[comp.key]}
                  onChange={(e) => setComment(comp.key, e.target.value)} placeholder={`Evaluate ${card.employee_name}'s ${comp.label.toLowerCase()}…`} />
              </div>
            ))}
            <div>
              <label htmlFor="impact" className="block text-xs font-semibold text-text-main mb-1">Overall Impact Statement *</label>
              <textarea id="impact" rows={4} className={TEXTAREA_CLS} value={impactStatement}
                onChange={(e) => setImpactStatement(e.target.value)} placeholder="Describe overall impact, key achievements, and areas for growth…" />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors">Cancel</button>
          <button type="button" onClick={() => onSubmit({
            performance_group: performanceGroup as PerformanceGroup, impact_statement: impactStatement,
            comment_task_execution: comments.task_execution, comment_ownership: comments.ownership,
            comment_project_management: comments.project_management, comment_client_deliverables: comments.client_deliverables,
            comment_communication: comments.communication, comment_mentoring: comments.mentoring, comment_competency_skills: comments.competency_skills,
          })} disabled={isSaving || !allFilled || isLoadingReview || !!fetchError}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity ${isEditMode ? "bg-amber-500" : "bg-brand"}`}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditMode ? <Pencil className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {isSaving ? (isEditMode ? "Saving…" : "Submitting…") : (isEditMode ? "Save Changes" : "Submit Evaluation")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Secondary Impact Modal ──────────────────────────────────────────

function ImpactModal({
  row, onSubmit, onClose, isSaving, error,
}: {
  readonly row: UnifiedEvalRow;
  readonly onSubmit: (reviewId: number, payload: SecondaryEvalPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}) {
  const isEdit = row.review_status === "submitted";
  const [impactStatement, setImpactStatement] = useState(row.existingImpact ?? "");

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              {isEdit && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">Editing</span>}
              <h2 className="font-display text-base font-semibold text-text-main">{isEdit ? "Edit" : "Secondary"} Feedback</h2>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">{row.employee_name} — {row.project_name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
          <div>
            <label htmlFor="sec-impact" className="block text-xs font-semibold text-text-main mb-1">Impact Statement *</label>
            <p className="text-xs text-text-muted mb-2">Share your perspective on {row.employee_name}'s contribution.</p>
            <textarea id="sec-impact" rows={5} className={TEXTAREA_CLS} value={impactStatement}
              onChange={(e) => setImpactStatement(e.target.value)} placeholder="Describe observations about impact, collaboration, and contributions…" />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors">Cancel</button>
          <button type="button" onClick={() => onSubmit(row.secondaryReview!.id, { impact_statement: impactStatement })}
            disabled={isSaving || !impactStatement.trim()}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isSaving ? (isEdit ? "Saving…" : "Submitting…") : (isEdit ? "Save Changes" : "Submit")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Card View ───────────────────────────────────────────────────────

function EvalCard({
  row, onAction,
}: { readonly row: UnifiedEvalRow; readonly onAction: (row: UnifiedEvalRow) => void }) {
  const isPrimary = row.type === "primary";
  const isDone = row.review_status === "reviewed" || row.review_status === "submitted";

  return (
    <div className={`rounded-xl border bg-surface p-4 shadow-sm flex flex-col gap-3 ${isDone ? "border-green-200 bg-green-50/30" : "border-border"}`}>
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${isPrimary ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-600"}`}>
          {isPrimary ? "Primary" : "Secondary"}
        </span>
        {isDone ? (
          <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">
            <CheckCircle2 className="h-3 w-3" /> {row.review_status === "submitted" ? "Submitted" : "Reviewed"}
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
            <Clock className="h-3 w-3" /> Pending
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <UserCircle className="h-5 w-5 text-text-muted shrink-0" />
        <p className="text-[14px] font-semibold text-text-main">{row.employee_name}</p>
      </div>

      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <Briefcase className="h-3 w-3 shrink-0" />
        <span className="truncate">{row.project_name}</span>
        <span className="font-mono text-[11px]">({row.project_code})</span>
      </div>

      {isPrimary && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
          {row.department_name && <span>Dept: <span className="font-medium text-text-main">{row.department_name}</span></span>}
          {row.designation_name && <span>Desig: <span className="font-medium text-text-main">{row.designation_name}</span></span>}
        </div>
      )}

      <div className="mt-auto pt-2 border-t border-border/60">
        {isDone ? (
          <button type="button" onClick={() => onAction(row)}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        ) : (
          <button type="button" onClick={() => onAction(row)}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity">
            {isPrimary ? "Evaluate" : "Write Impact"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tab Component ───────────────────────────────────────────────────

export function PMEvaluationTab() {
  const { user } = useAuth();
  const currentUserId = user?.user_id;

  const [pmCards, setPmCards] = useState<PMPendingReviewCard[]>([]);
  const [secReviews, setSecReviews] = useState<ProjectReviewResponse[]>([]);
  const [expectations, setExpectations] = useState<RoleExpectation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortState<EvalSortKey> | null>(null);

  // Modal state
  const [evalTarget, setEvalTarget] = useState<UnifiedEvalRow | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [queueData, secData, expData] = await Promise.all([
        projectReviewService.getPMQueue(),
        projectReviewService.getSecondaryQueue().catch(() => []),
        projectReviewService.getRoleExpectations(),
      ]);
      setPmCards(queueData);
      setSecReviews(secData);
      setExpectations(expData);
    } catch { /* stays empty */ } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Build unified rows
  const unifiedRows: UnifiedEvalRow[] = [];

  for (const c of pmCards) {
    unifiedRows.push({
      key: `pm-${c.project_id}-${c.user_id}`,
      type: "primary",
      employee_name: c.employee_name,
      project_id: c.project_id,
      project_name: c.project_name,
      project_code: c.project_code,
      department_name: c.department_name,
      designation_name: c.designation_name,
      assignment_role: c.assignment_role,
      review_status: c.review_status === "reviewed" ? "reviewed" : "pending",
      review_id: c.review_id,
      user_id: c.user_id,
      cycle: c.cycle,
      performance_group: c.performance_group ?? null,
    });
  }

  for (const r of secReviews) {
    const myEval = r.secondary_evaluations?.find((ev) => ev.evaluator_id === currentUserId);
    unifiedRows.push({
      key: `sec-${r.id}`,
      type: "secondary",
      employee_name: r.employee_name,
      project_id: r.project_id,
      project_name: r.project_name,
      project_code: r.project_code,
      department_name: null,
      designation_name: null,
      assignment_role: null,
      review_status: myEval ? "submitted" : "pending",
      review_id: r.id,
      user_id: r.user_id,
      cycle: r.cycle,
      performance_group: null,
      secondaryReview: r,
      existingImpact: myEval?.impact_statement ?? "",
    });
  }

  // Dropdown options
  const availableDepts = Array.from(new Set(unifiedRows.map((r) => r.department_name).filter(Boolean) as string[]));
  const availableEmployees = Array.from(new Set(unifiedRows.map((r) => r.employee_name)));

  // Filters
  const filteredRows = unifiedRows.filter((r) => {
    if (typeFilter !== "all" && r.type !== typeFilter) return false;
    if (statusFilter === "pending" && r.review_status !== "pending") return false;
    if (statusFilter === "done" && r.review_status === "pending") return false;
    if (deptFilter !== "all" && r.department_name !== deptFilter) return false;
    if (employeeFilter !== "all" && r.employee_name !== employeeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!r.employee_name.toLowerCase().includes(q) && !r.project_name.toLowerCase().includes(q) && !r.project_code.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sorting layered on top of filtering. `slice()` first to avoid mutating state.
  const sortedRows = sort
    ? filteredRows.slice().sort((a, b) => {
        const { kind, get } = EVAL_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filteredRows;

  const getExpectation = (row: UnifiedEvalRow): RoleExpectation | null => {
    if (!row.department_name || !row.designation_name) return null;
    return expectations.find((e) => e.department_name === row.department_name && e.designation_name === row.designation_name) ?? null;
  };

  // Actions
  const handleAction = (row: UnifiedEvalRow) => {
    setModalError("");
    if (row.type === "primary") {
      setIsEditMode(row.review_status === "reviewed");
      setEvalTarget(row);
    } else {
      setEvalTarget(row);
    }
  };

  const closeModal = () => { setEvalTarget(null); setIsEditMode(false); setModalError(""); };

  const handlePMSubmit = async (payload: PMEvaluationPayload) => {
    if (!evalTarget) return;
    setIsSaving(true); setModalError("");
    try {
      if (isEditMode && evalTarget.review_id != null) {
        await projectReviewService.updateReview(evalTarget.review_id, payload);
      } else {
        await projectReviewService.submitPMEvaluation(evalTarget.project_id, evalTarget.user_id!, payload);
        setPmCards((prev) => prev.map((c) =>
          c.project_id === evalTarget.project_id && c.user_id === evalTarget.user_id ? { ...c, review_status: "reviewed" } : c
        ));
      }
      closeModal();
    } catch (err: unknown) { setModalError(getErrorMessage(err)); } finally { setIsSaving(false); }
  };

  const handleSecSubmit = async (reviewId: number, payload: SecondaryEvalPayload) => {
    setIsSaving(true); setModalError("");
    try {
      if (evalTarget?.review_status === "submitted") {
        await projectReviewService.updateSecondaryEval(reviewId, payload);
      } else {
        await projectReviewService.submitSecondaryEval(reviewId, payload);
      }
      await loadData();
      closeModal();
    } catch (err: unknown) { setModalError(getErrorMessage(err)); } finally { setIsSaving(false); }
  };

  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${viewMode === mode ? "bg-brand/10 text-brand" : "text-text-muted hover:bg-slate-100"}`;

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">Loading evaluation queue…</div>;
  }

  if (unifiedRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <ClipboardList className="h-10 w-10 text-text-muted mb-3" />
        <p className="font-display text-base font-medium text-text-main">No evaluations to complete</p>
        <p className="mt-1 text-sm text-text-muted">You're not assigned as an evaluator on any active projects.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-500">

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
            <input type="text" placeholder="Search employee or project..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand" />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-0.5">
            <button type="button" className={viewBtnCls("grid")} onClick={() => setViewMode("grid")}><LayoutGrid className="h-3.5 w-3.5" /> Cards</button>
            <button type="button" className={viewBtnCls("table")} onClick={() => setViewMode("table")}><Table2 className="h-3.5 w-3.5" /> Table</button>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
              <option value="all">All</option>
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="done">Completed</option>
            </select>
          </div>
          {availableDepts.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Dept</label>
              <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
                <option value="all">All Depts</option>
                {availableDepts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Employee</label>
            <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[130px] cursor-pointer">
              <option value="all">All</option>
              {availableEmployees.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <Search className="h-8 w-8 text-text-muted mb-2" />
          <p className="font-display text-sm font-medium text-text-main">No matching evaluations</p>
          <p className="mt-1 text-xs text-text-muted">Try adjusting your filters or search query.</p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sortedRows.map((r) => <EvalCard key={r.key} row={r} onAction={handleAction} />)}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader label="Employee" columnKey="employee_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Project" columnKey="project_name" sort={sort} onSort={setSort} />
                </th>
                <th className="hidden sm:table-cell text-left px-4 py-2.5">
                  <SortableHeader label="Type" columnKey="type" sort={sort} onSort={setSort} />
                </th>
                <th className="hidden md:table-cell text-left px-4 py-2.5">
                  <SortableHeader label="Dept" columnKey="department_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Status" columnKey="review_status" sort={sort} onSort={setSort} />
                </th>
                <th className="hidden md:table-cell text-left px-4 py-2.5">
                  <SortableHeader label="Rating" columnKey="performance_group" sort={sort} onSort={setSort} />
                </th>
                <th className="text-right px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sortedRows.map((r) => {
                const isDone = r.review_status !== "pending";
                return (
                  <tr key={r.key} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <UserCircle className="h-4 w-4 text-text-muted shrink-0" />
                        <span className="font-medium text-text-main">{r.employee_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-text-main">{r.project_name}</div>
                      <div className="text-[11px] font-mono text-text-muted">{r.project_code}</div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${r.type === "primary" ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-600"}`}>
                        {r.type === "primary" ? "Primary" : "Secondary"}
                      </span>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-text-muted">{r.department_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {isDone ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                          <CheckCircle2 className="h-3 w-3" /> {r.review_status === "submitted" ? "Submitted" : "Reviewed"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                          <Clock className="h-3 w-3" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3">
                      {r.performance_group ? (
                        <span className="font-semibold text-text-main">{r.performance_group}</span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isDone ? (
                        <button type="button" onClick={() => handleAction(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-[12px] font-medium text-green-700 hover:bg-green-100 transition-colors">
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      ) : (
                        <button type="button" onClick={() => handleAction(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 transition-opacity">
                          {r.type === "primary" ? "Evaluate" : "Write Impact"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {evalTarget?.type === "primary" && (
        <EvalModal card={evalTarget} expectation={getExpectation(evalTarget)} isEditMode={isEditMode}
          onSubmit={handlePMSubmit} onClose={closeModal} isSaving={isSaving} error={modalError} />
      )}
      {evalTarget?.type === "secondary" && (
        <ImpactModal row={evalTarget} onSubmit={handleSecSubmit} onClose={closeModal} isSaving={isSaving} error={modalError} />
      )}
    </div>
  );
}
