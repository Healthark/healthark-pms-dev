/**
 * MenteeProjectsTab — READ-ONLY view of a mentee's project reviews.
 *
 * A mentor is not necessarily the PM on their mentee's projects, and project
 * evaluation is a PM-role action — so this tab is deliberately view-only.
 * It shows the mentee's project-review status/ratings and lets the mentor
 * open a *submitted* review read-only. Actual evaluation (when the mentor is
 * the PM) happens on the Project Reviews page.
 */

import { useMemo, useState } from "react";
import { ClipboardList, Eye, ExternalLink, UserCircle } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProjectReviewResponse } from "../../services/project-review.service";
import { useMenteeProjects } from "../../queries/mentees";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";
import { ProjectReviewDetailModal } from "../project-reviews/ProjectReviewDetailModal";
import { SortableHeader } from "../SortableHeader";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { TablePagination } from "../common/TablePagination";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";

interface MenteeProjRow {
  key: string;
  project_name: string;
  project_code: string;
  assignment_role: string | null;
  pm_name: string | null;
  cycle: string | null;
  review_status: string | null; // "pending" | "reviewed" | null
  performance_group: string | null;
  review_detail: ProjectReviewResponse | null;
}

type StatusFilterValue = "all" | "pending" | "reviewed";
type SortKey =
  | "project_name"
  | "pm_name"
  | "cycle"
  | "review_status"
  | "performance_group";

const SORT_CONFIG: Record<SortKey, { kind: SortKind; get: (r: MenteeProjRow) => unknown }> = {
  project_name:      { kind: "alpha",   get: (r) => r.project_name },
  pm_name:           { kind: "alpha",   get: (r) => r.pm_name },
  cycle:             { kind: "cycle",   get: (r) => r.cycle },
  review_status:     { kind: "alpha",   get: (r) => r.review_status ?? "pending" },
  performance_group: { kind: "numeric", get: (r) => r.performance_group },
};

function StatusBadge({ status }: { readonly status: string | null }) {
  if (status === "reviewed") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-50 dark:bg-green-950/40 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700 dark:text-green-300">
        Reviewed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700 dark:text-amber-300">
      Pending
    </span>
  );
}

interface MenteeProjectsTabProps {
  readonly menteeId: number;
  readonly menteeName: string;
}

export function MenteeProjectsTab({ menteeId, menteeName }: MenteeProjectsTabProps) {
  // Per-tab fetch — ['mentees', id, 'projects']. Project-review mutations
  // (from the Project Reviews page) invalidate ['mentees'] which refetches
  // this via prefix match, so the read-only view stays current.
  const {
    data: assignments = [],
    isPending,
    error: queryError,
  } = useMenteeProjects(menteeId);

  const [cycleFilter, setCycleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);
  const [viewReview, setViewReview] = useState<ProjectReviewResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Backend emits one assignment row per (project, cycle) → map 1:1.
  const rows: MenteeProjRow[] = useMemo(
    () =>
      assignments.map((a, i) => ({
        key: `${a.project_id}-${a.cycle ?? "none"}-${i}`,
        project_name: a.project_name,
        project_code: a.project_code,
        assignment_role: a.assignment_role,
        pm_name: a.pm_name,
        cycle: a.cycle,
        review_status: a.review_status,
        performance_group: a.performance_group,
        review_detail: a.review_detail,
      })),
    [assignments],
  );

  const availableCycles = useMemo(
    () => Array.from(new Set(rows.map((r) => r.cycle).filter((c): c is string => !!c))),
    [rows],
  );

  const filtered = rows.filter((r) => {
    if (cycleFilter !== "all" && r.cycle !== cycleFilter) return false;
    if (statusFilter === "pending" && r.review_status === "reviewed") return false;
    if (statusFilter === "reviewed" && r.review_status !== "reviewed") return false;
    return true;
  });

  const sorted = sort
    ? filtered.slice().sort((a, b) => {
        const { kind, get } = SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filtered;

  // Client-side pagination. Reset to page 1 when filters / page size change.
  const filterKey = [cycleFilter, statusFilter, pageSize].join("|");
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  let currentPage = page;
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
    currentPage = 1;
  }
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const hasActiveFilters = cycleFilter !== "all" || statusFilter !== "all";
  const clearFilters = () => {
    setCycleFilter("all");
    setStatusFilter("all");
  };

  if (isPending) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center text-sm text-text-muted bg-background/50">
        Loading projects…
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
        Could not load projects. Please try again.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <ClipboardList className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">
          {menteeName} has no project assignments
        </p>
        <p className="mt-1 text-sm text-text-muted">
          When HR adds them to a project, you'll see it here.
        </p>
      </div>
    );
  }

  const selectCls =
    "rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[130px] cursor-pointer";
  const labelCls =
    "text-[11px] font-bold uppercase tracking-wider text-text-muted";
  const thCls =
    "text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted";

  return (
    <div className="space-y-4">
      {/* Read-only notice → evaluation lives on the Project Reviews page */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted/50 px-3 py-2 text-[12px] text-text-muted">
        <ExternalLink className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          Read-only view of {menteeName}'s project reviews. To evaluate a
          project (when you're the PM), use the{" "}
          <Link
            to="/project-reviews"
            className="font-medium text-brand hover:underline"
          >
            Project Reviews
          </Link>{" "}
          page.
        </span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor="mentee-proj-cycle" className={labelCls}>
            Cycle
          </label>
          <select
            id="mentee-proj-cycle"
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value)}
            className={selectCls}
          >
            <option value="all">All Cycles</option>
            {availableCycles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="mentee-proj-status" className={labelCls}>
            Status
          </label>
          <select
            id="mentee-proj-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilterValue)}
            className={selectCls}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </div>
        <ClearFiltersButton
          active={hasActiveFilters}
          onClear={clearFilters}
          className="ml-auto"
        />
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <ClipboardList className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
          <p className="font-display text-sm font-medium text-text-main">
            No projects match
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Try adjusting the filters.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-surface-muted/80 border-b border-border">
                  <th className="text-left px-5 py-2.5">
                    <SortableHeader label="Project" columnKey="project_name" sort={sort} onSort={setSort} />
                  </th>
                  <th className={`hidden sm:table-cell ${thCls} px-4`}>
                    <SortableHeader label="PM" columnKey="pm_name" sort={sort} onSort={setSort} />
                  </th>
                  <th className={`hidden md:table-cell ${thCls} px-4`}>
                    <SortableHeader label="Cycle" columnKey="cycle" sort={sort} onSort={setSort} />
                  </th>
                  <th className="text-left px-4 py-2.5">
                    <SortableHeader label="Status" columnKey="review_status" sort={sort} onSort={setSort} />
                  </th>
                  <th className="hidden md:table-cell px-4 py-2.5">
                    <SortableHeader label="Rating" columnKey="performance_group" sort={sort} onSort={setSort} />
                  </th>
                  <th className={`${thCls} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {pageRows.map((r) => (
                  <tr key={r.key} className="hover:bg-surface-muted/60 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-medium text-text-main">{r.project_name}</div>
                      <div className="text-[11px] font-mono text-text-muted">
                        {r.project_code}
                        {r.assignment_role && (
                          <span className="ml-2 text-text-muted">· {r.assignment_role}</span>
                        )}
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3">
                      {r.pm_name ? (
                        <div className="flex items-center gap-1.5 text-text-main">
                          <UserCircle className="h-3.5 w-3.5 text-text-muted shrink-0" />
                          <span className="truncate">{r.pm_name}</span>
                        </div>
                      ) : (
                        <span className="text-text-muted italic text-[12px]">Unassigned</span>
                      )}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-text-muted">
                      {r.cycle ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.review_status} />
                    </td>
                    <td className="hidden md:table-cell px-4 py-3">
                      <PerformanceRatingBadge
                        value={r.performance_group ? Number(r.performance_group) : null}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.review_status === "reviewed" && r.review_detail ? (
                        <button
                          type="button"
                          onClick={() => setViewReview(r.review_detail)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-text-muted hover:bg-surface-muted hover:text-text-main transition-colors"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      ) : (
                        <span className="text-[11px] italic text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={safePage}
            pageSize={pageSize}
            totalItems={sorted.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {viewReview && (
        <ProjectReviewDetailModal
          review={viewReview}
          projectRatingsVisible
          onClose={() => setViewReview(null)}
        />
      )}
    </div>
  );
}
