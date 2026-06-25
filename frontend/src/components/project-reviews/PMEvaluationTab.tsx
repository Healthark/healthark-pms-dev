/**
 * PMEvaluationTab.tsx — Unified Evaluation Queue (Primary + Secondary).
 *
 * Merges PM primary evaluations and secondary impact statements into one
 * table/card view with a Type column and filter.
 */

import { lazy, Suspense, useState } from "react";
import {
  UserCircle, ClipboardList, Pencil,
  Search, CheckCircle2, Clock,
} from "lucide-react";
import { StringCombobox } from "../common/StringCombobox";
import { TablePagination } from "../common/TablePagination";
import {
  type PMEvaluationPayload,
  type PMEvaluationDraftPayload,
  type ProjectReviewResponse,
  type SecondaryEvalPayload,
  type SecondaryEvalDraftPayload,
  type RoleExpectation,
} from "../../services/project-review.service";
import {
  usePMQueue,
  useSecondaryQueue,
  useRoleExpectations,
  useSubmitPMEvaluation,
  useSavePMDraft,
  useUpdateReview,
  useSubmitSecondaryEval,
  useSaveSecondaryDraft,
  useUpdateSecondaryEval,
} from "../../queries/projectReviews";
import { getErrorMessage } from "../../utils/errors";
import { useAuth } from "../../hooks/useAuth";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { useToast } from "../../hooks/useToast";
import { SortableHeader } from "../SortableHeader";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";
import { buildProjectCodeIndex } from "../../utils/projectCodeIndex";
import { sortCyclesDesc } from "../../utils/fy";
// EvalModal + ImpactModal lazy-loaded (F3). EvalModal is the heaviest
// modal in the app at ~475 LOC; ImpactModal is paired (same parents)
// so we split them together. Each opens on row-click only.
const EvalModal = lazy(() =>
  import("./EvalModal").then((m) => ({ default: m.EvalModal })),
);
const ImpactModal = lazy(() =>
  import("./ImpactModal").then((m) => ({ default: m.ImpactModal })),
);

// ── Constants ───────────────────────────────────────────────────────

type EvalType = "primary" | "secondary";

// ── Sort column config ──────────────────────────────────────────────
// Employee / Project / Type / Dept are alpha; project_code is alphanumeric;
// rating (performance_group) is a 1–5 numeric-like string. Action is not sortable.
type EvalSortKey =
  | "employee_name"
  | "project_name"
  | "cycle"
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
  /** True iff a real draft has been saved (not just a pre-seeded
   *  placeholder pending row). Drives the Draft pill + filter. */
  has_draft_content: boolean;
  // Secondary-specific
  secondaryReview?: ProjectReviewResponse;
  existingImpact?: string;
}

const EVAL_SORT_CONFIG: Record<EvalSortKey, { kind: SortKind; get: (r: UnifiedEvalRow) => unknown }> = {
  employee_name:     { kind: "alpha",   get: (r) => r.employee_name },
  project_name:      { kind: "alpha",   get: (r) => r.project_name },
  cycle:             { kind: "cycle",   get: (r) => r.cycle },
  department_name:   { kind: "alpha",   get: (r) => r.department_name },
  review_status:     { kind: "alpha",   get: (r) => r.review_status },
  performance_group: { kind: "numeric", get: (r) => r.performance_group },
};

// ── Tab Component ───────────────────────────────────────────────────

export function PMEvaluationTab() {
  const { user } = useAuth();
  const currentUserId = user?.user_id;
  const { settings } = useSystemSettings();
  const activeCycle = settings?.active_cycle_name ?? null;
  const toast = useToast();

  // ['project-reviews', 'pm-queue' | 'secondary-queue' | 'role-expectations']
  // — shared TanStack caches across PMEvaluationTab + ProjectReviews page.
  const { data: pmCards = [], isLoading: pmLoading } = usePMQueue();
  const { data: secReviews = [], isLoading: secLoading } = useSecondaryQueue();
  const { data: expectations = [], isLoading: expLoading } = useRoleExpectations();
  const isLoading = pmLoading || secLoading || expLoading;

  // Mutation hooks — each invalidates ['project-reviews'] ± dashboard
  const submitPMMutation = useSubmitPMEvaluation();
  const savePMDraftMutation = useSavePMDraft();
  const updateReviewMutation = useUpdateReview();
  const submitSecMutation = useSubmitSecondaryEval();
  const saveSecDraftMutation = useSaveSecondaryDraft();
  const updateSecMutation = useUpdateSecondaryEval();
  const isSaving =
    submitPMMutation.isPending ||
    updateReviewMutation.isPending ||
    submitSecMutation.isPending ||
    updateSecMutation.isPending;
  const isDraftSaving =
    savePMDraftMutation.isPending || saveSecDraftMutation.isPending;

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  // Cycle filter. "" = no explicit choice → fall back to `cycleDefault`
  // (computed below). We deliberately DON'T seed the active cycle into state
  // via an effect: if the queue has no active-cycle rows (e.g. a Secondary
  // evaluator whose reviewed items are all in a past cycle), that value
  // wouldn't be in the dropdown's options and the <select> would silently
  // display "All Cycles" while still filtering to the empty active cycle.
  // Deriving the effective value during render avoids that mismatch.
  const [cycleFilter, setCycleFilter] = useState<string>("");
  const [sort, setSort] = useState<SortState<EvalSortKey> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Default the Cycle filter to the active cycle — the current cycle is the
  // canonical landing view. The active cycle is always added to the dropdown
  // options below, so the <select> shows it selected even when it has no rows;
  // the table is then legitimately empty until the user picks another cycle.
  // `effectiveCycle` is what the table + <select> use ("" state → this default).
  const cycleDefault = activeCycle ?? "all";
  const effectiveCycle = cycleFilter === "" ? cycleDefault : cycleFilter;
  const hasActiveFilters =
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    deptFilter !== "all" ||
    projectFilter !== "all" ||
    employeeFilter !== "all" ||
    effectiveCycle !== cycleDefault;
  const clearFilters = () => {
    setStatusFilter("all");
    setTypeFilter("all");
    setDeptFilter("all");
    setProjectFilter("all");
    setEmployeeFilter("all");
    setCycleFilter("");
  };

  // Modal state
  const [evalTarget, setEvalTarget] = useState<UnifiedEvalRow | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [modalError, setModalError] = useState("");

  // Build unified rows
  const unifiedRows: UnifiedEvalRow[] = [];

  for (const c of pmCards) {
    unifiedRows.push({
      // Cycle is part of the key — same (project, user) can appear once
      // per cycle now that the queue spans all cycles.
      key: `pm-${c.project_id}-${c.user_id}-${c.cycle ?? "none"}`,
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
      has_draft_content: !!c.has_draft_content,
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
      has_draft_content: false, // draft-pill semantics are PM-specific for now
      secondaryReview: r,
      existingImpact: myEval?.impact_statement ?? "",
    });
  }

  // Dropdown options
  const availableDepts = Array.from(new Set(unifiedRows.map((r) => r.department_name).filter(Boolean) as string[]));
  const availableEmployees = Array.from(new Set(unifiedRows.map((r) => r.employee_name)));
  // Always include the active cycle so it's selectable/displayable even with
  // no queue rows — the default selection lands there and the table is simply
  // empty until the user switches to a cycle that has reviews. Ordered
  // newest-first (timeline descending) so the dropdown reads H1 FY26-27 →
  // H2 FY25-26 → H1 FY25-26.
  const availableCycles = sortCyclesDesc(
    Array.from(
      new Set([
        ...(activeCycle ? [activeCycle] : []),
        ...unifiedRows.map((r) => r.cycle).filter((c): c is string => !!c),
      ]),
    ),
  );
  const availableProjects = Array.from(new Set(unifiedRows.map((r) => r.project_name))).sort();
  // Project Code filter — a synced view onto the name-keyed projectFilter.
  const projectIndex = buildProjectCodeIndex(unifiedRows);
  const projectCodeFilter =
    projectFilter !== "all" ? projectIndex.nameToCode.get(projectFilter) ?? "" : "";

  // Filters
  const filteredRows = unifiedRows.filter((r) => {
    if (effectiveCycle !== "all" && r.cycle !== effectiveCycle) return false;
    if (typeFilter !== "all" && r.type !== typeFilter) return false;
    // Status:
    //   pending → row is pending AND no draft content has been typed yet
    //   draft   → row is pending AND has_draft_content == true
    //   done    → submitted / reviewed
    if (statusFilter === "pending"
        && (r.review_status !== "pending" || r.has_draft_content)) return false;
    if (statusFilter === "draft"
        && (r.review_status !== "pending" || !r.has_draft_content)) return false;
    if (statusFilter === "done" && r.review_status === "pending") return false;
    if (deptFilter !== "all" && r.department_name !== deptFilter) return false;
    if (projectFilter !== "all" && r.project_name !== projectFilter) return false;
    if (employeeFilter !== "all" && r.employee_name !== employeeFilter) return false;
    return true;
  });

  // Sorting layered on top of filtering. `slice()` first to avoid mutating state.
  const sortedRows = sort
    ? filteredRows.slice().sort((a, b) => {
        const { kind, get } = EVAL_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filteredRows;

  // Client-side pagination over the filtered+sorted rows — same pattern as the
  // All Reviews tab. Reset to page 1 when the filter set or page size changes
  // (tracked during render to avoid a reset-in-effect).
  const pageKey = [
    statusFilter,
    typeFilter,
    deptFilter,
    projectFilter,
    employeeFilter,
    effectiveCycle,
    pageSize,
  ].join("|");
  const [lastPageKey, setLastPageKey] = useState(pageKey);
  let currentPage = page;
  if (pageKey !== lastPageKey) {
    setLastPageKey(pageKey);
    setPage(1);
    currentPage = 1;
  }
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);

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
    setModalError("");
    try {
      if (isEditMode && evalTarget.review_id != null) {
        await updateReviewMutation.mutateAsync({
          reviewId: evalTarget.review_id,
          payload,
        });
        closeModal();
        toast.success("Evaluation updated.");
      } else {
        await submitPMMutation.mutateAsync({
          projectId: evalTarget.project_id,
          userId: evalTarget.user_id!,
          payload,
        });
        closeModal();
        toast.success("Evaluation submitted.");
      }
    } catch (err: unknown) {
      setModalError(getErrorMessage(err));
    }
  };

  const handleSecSubmit = async (reviewId: number, payload: SecondaryEvalPayload) => {
    setModalError("");
    try {
      if (evalTarget?.review_status === "submitted") {
        await updateSecMutation.mutateAsync({ reviewId, payload });
      } else {
        await submitSecMutation.mutateAsync({ reviewId, payload });
      }
      closeModal();
      toast.success("Impact statement saved.");
    } catch (err: unknown) {
      setModalError(getErrorMessage(err));
    }
  };

  const handlePMSaveDraft = async (payload: PMEvaluationDraftPayload) => {
    if (!evalTarget) return;
    setModalError("");
    try {
      await savePMDraftMutation.mutateAsync({
        projectId: evalTarget.project_id,
        userId: evalTarget.user_id!,
        payload,
      });
      // Invalidation refreshes the queue so the card picks up the
      // newly-created review_id; the modal can then preload draft fields
      // on next open AND the row button flips to "Continue Evaluation".
      toast.success("Draft saved.");
    } catch (err: unknown) {
      setModalError(getErrorMessage(err));
    }
  };

  const handleSecSaveDraft = async (
    reviewId: number,
    payload: SecondaryEvalDraftPayload,
  ) => {
    setModalError("");
    try {
      await saveSecDraftMutation.mutateAsync({ reviewId, payload });
      toast.success("Draft saved.");
    } catch (err: unknown) {
      setModalError(getErrorMessage(err));
    }
  };


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
    <div className="space-y-5">

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Cycle</label>
            <select value={effectiveCycle} onChange={(e) => setCycleFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
              <option value="all">All Cycles</option>
              {availableCycles.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="pm-employee-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Employee</label>
            <StringCombobox
              id="pm-employee-filter"
              options={availableEmployees}
              value={employeeFilter === "all" ? "" : employeeFilter}
              onChange={(v) => setEmployeeFilter(v || "all")}
              placeholder="All employees"
            />
          </div>
          {availableProjects.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="pm-project-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Project</label>
              <StringCombobox
                id="pm-project-filter"
                options={availableProjects}
                value={projectFilter === "all" ? "" : projectFilter}
                onChange={(v) => setProjectFilter(v || "all")}
                placeholder="All projects"
              />
            </div>
          )}
          {projectIndex.codes.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="pm-project-code-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Project Code</label>
              <StringCombobox
                id="pm-project-code-filter"
                options={projectIndex.codes}
                value={projectCodeFilter}
                onChange={(code) =>
                  setProjectFilter(code ? projectIndex.codeToName.get(code) ?? "all" : "all")
                }
                placeholder="All codes"
                minWidth="150px"
              />
            </div>
          )}
          {availableDepts.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Department</label>
              <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
                <option value="all">All Depts</option>
                {availableDepts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
              <option value="all">All</option>
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="draft">Draft</option>
              <option value="done">Completed</option>
            </select>
          </div>
          <ClearFiltersButton active={hasActiveFilters} onClear={clearFilters} className="ml-auto" />
        </div>
      </div>

      {/* Content */}
      {filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <Search className="h-8 w-8 text-text-muted mb-2" />
          <p className="font-display text-sm font-medium text-text-main">No matching evaluations</p>
          <p className="mt-1 text-xs text-text-muted">Try adjusting your filters.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-muted/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader label="Employee" columnKey="employee_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Project" columnKey="project_name" sort={sort} onSort={setSort} />
                </th>
                <th className="hidden sm:table-cell text-left px-4 py-2.5">
                  <SortableHeader label="Cycle" columnKey="cycle" sort={sort} onSort={setSort} />
                </th>
                <th className="hidden md:table-cell text-left px-4 py-2.5">
                  <SortableHeader label="Department" columnKey="department_name" sort={sort} onSort={setSort} />
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
              {pageRows.map((r) => {
                const isDone = r.review_status !== "pending";
                const rowHasDraft = r.type === "primary" && !isDone && r.has_draft_content;
                return (
                  <tr key={r.key} className="hover:bg-surface-muted/60 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <UserCircle className="h-4 w-4 text-text-muted shrink-0" />
                        <span className="font-medium text-text-main">{r.employee_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-text-main">
                        <span>{r.project_name}</span>
                        {r.type === "secondary" && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-surface-hover text-text-muted">
                            Secondary
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-text-muted">{r.project_code}</div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-text-muted">
                      {r.cycle ?? "—"}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-text-muted">{r.department_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {isDone ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-950/40 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700 dark:text-green-300">
                          <CheckCircle2 className="h-3 w-3" /> {r.review_status === "submitted" ? "Submitted" : "Reviewed"}
                        </span>
                      ) : rowHasDraft ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold uppercase text-brand">
                          <Pencil className="h-3 w-3" /> Draft
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700 dark:text-amber-300">
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
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 px-3 py-1.5 text-[12px] font-medium text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors">
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
          <TablePagination
            page={safePage}
            pageSize={pageSize}
            totalItems={sortedRows.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {/* Modals — lazy chunks (F3). Each Suspense boundary scopes its
          modal's loading state so they don't block each other. */}
      <Suspense fallback={null}>
        {evalTarget?.type === "primary" && (
          <EvalModal card={evalTarget} expectation={getExpectation(evalTarget)} isEditMode={isEditMode}
            onSubmit={handlePMSubmit}
            onSaveDraft={isEditMode ? undefined : handlePMSaveDraft}
            onClose={closeModal} isSaving={isSaving} isDraftSaving={isDraftSaving} error={modalError} />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {evalTarget?.type === "secondary" && (
          <ImpactModal row={evalTarget}
            onSubmit={handleSecSubmit}
            onSaveDraft={evalTarget.review_status === "submitted" ? undefined : handleSecSaveDraft}
            onClose={closeModal} isSaving={isSaving} isDraftSaving={isDraftSaving} error={modalError} />
        )}
      </Suspense>
    </div>
  );
}
