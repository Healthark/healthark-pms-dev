/**
 * TeamReviewTab.tsx — Mentor's unified workspace for team annual reviews.
 *
 * The mentor sees every mentee's review across cycles in one table,
 * evaluates the ones in pending_mentor, and views the rest read-only via
 * the same detail modal the mentee's own "My Review" uses.
 *
 * Action column by status:
 *   pending_mentor     → Evaluate  (opens the mentee summary eval form)
 *   pending_management → View      (read-only detail modal)
 *   completed          → View      (read-only detail modal)
 *   draft              → "Awaiting self-review" (mentee hasn't submitted)
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Eye, UserCircle, Users } from "lucide-react";
import {
  type MenteeAnnualReview,
  type ReviewStatus,
} from "../../services/annual-review.service";
import { useMenteeAnnualReviews } from "../../queries/annualReviews";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { RatingCell } from "./RatingCell";
import { AnnualReviewDetailModal } from "./AnnualReviewDetailModal";
import { SortableHeader } from "../SortableHeader";
import { TablePagination } from "../common/TablePagination";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { StringCombobox } from "../common/StringCombobox";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";
import { extractFyToken, formatFyLabel } from "../../utils/fy";
import { getErrorMessage } from "../../utils/errors";

type SortKey = "employee_name" | "cycle_name" | "status";
type StatusFilter = "all" | ReviewStatus;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "pending_mentor", label: "Pending Mentor" },
  { value: "pending_management", label: "Pending Management" },
  { value: "completed", label: "Completed" },
];

const SORT_CONFIG: Record<
  SortKey,
  { kind: SortKind; get: (r: MenteeAnnualReview) => unknown }
> = {
  employee_name: { kind: "alpha", get: (r) => r.employee_name },
  cycle_name:    { kind: "alpha", get: (r) => r.cycle_name },
  status:        { kind: "alpha", get: (r) => r.status },
};

// ── Empty state ─────────────────────────────────────────────────────

function EmptyState({ hasFilter }: { readonly hasFilter: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
      <Users className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
      <p className="font-display text-base font-medium text-text-main">
        {hasFilter ? "No reviews match this filter" : "No mentee reviews yet"}
      </p>
      <p className="mt-1 text-sm text-text-muted">
        {hasFilter
          ? "Try selecting a different filter above."
          : "Your mentees haven't submitted their self-reviews yet."}
      </p>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────

export function TeamReviewTab() {
  const navigate = useNavigate();
  // ['annual-reviews', 'mentees'] — shared TanStack cache
  const { data: reviews = [], isLoading, error } = useMenteeAnnualReviews();
  const [yearFilter, setYearFilter] = useState("all");
  // "" = all (searchable combobox); Year/Status keep the "all" sentinel.
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);
  const [viewTarget, setViewTarget] = useState<MenteeAnnualReview | null>(null);
  // Client-side pagination (frontend-only until the backend paginates).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const availableYears = Array.from(
    new Set(reviews.map((r) => extractFyToken(r.cycle_name))),
  ).sort((a, b) => b.localeCompare(a));

  const availableEmployees = Array.from(
    new Set(reviews.map((r) => r.employee_name)),
  ).sort((a, b) => a.localeCompare(b));

  const filtered = reviews
    .filter(
      (r) => yearFilter === "all" || extractFyToken(r.cycle_name) === yearFilter,
    )
    .filter((r) => !employeeFilter || r.employee_name === employeeFilter)
    .filter((r) => statusFilter === "all" || r.status === statusFilter);

  const sorted = sort
    ? filtered.slice().sort((a, b) => {
        const { kind, get } = SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filtered;

  // Client-side pagination. Reset to page 1 when filters / sort / page size
  // change — tracked during render (React's reset-in-effect alternative).
  const filterKey = [
    yearFilter,
    employeeFilter,
    statusFilter,
    pageSize,
    sort ? `${sort.key}:${sort.direction}` : "",
  ].join("|");
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  let currentPage = page;
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
    currentPage = 1;
  }
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const hasActiveFilters =
    yearFilter !== "all" || !!employeeFilter || statusFilter !== "all";

  const clearFilters = () => {
    setYearFilter("all");
    setEmployeeFilter("");
    setStatusFilter("all");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">
        Loading team reviews…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
        {getErrorMessage(error)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {reviews.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label
              htmlFor="team-review-year-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Fiscal Year
            </label>
            <select
              id="team-review-year-filter"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
            >
              <option value="all">All</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {formatFyLabel(y)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="team-review-employee-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Mentee
            </label>
            <StringCombobox
              id="team-review-employee-filter"
              options={availableEmployees}
              value={employeeFilter}
              onChange={setEmployeeFilter}
              placeholder="All mentees"
            />
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="team-review-status-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Status
            </label>
            <select
              id="team-review-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[160px] cursor-pointer"
            >
              {STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <ClearFiltersButton
            active={hasActiveFilters}
            onClear={clearFilters}
            className="ml-auto"
          />
        </div>
      )}

      {/* Content */}
      {reviews.length === 0 ? (
        <EmptyState hasFilter={false} />
      ) : sorted.length === 0 ? (
        <EmptyState hasFilter={true} />
      ) : (
        <div className="rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-surface-muted/80 border-b border-border">
                  <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-text-muted">#</th>
                  <th className="text-left px-5 py-2.5">
                    <SortableHeader
                      label="Mentee"
                      columnKey="employee_name"
                      sort={sort}
                      onSort={setSort}
                    />
                  </th>
                  <th className="text-left px-4 py-2.5">
                    <SortableHeader
                      label="Fiscal Year"
                      columnKey="cycle_name"
                      sort={sort}
                      onSort={setSort}
                    />
                  </th>
                  <th className="text-left px-4 py-2.5">
                    <SortableHeader
                      label="Status"
                      columnKey="status"
                      sort={sort}
                      onSort={setSort}
                    />
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    Self Rating
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    Mentor Rating
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    Management Rating
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {paged.map((r, i) => {
                  const canEvaluate = r.status === "pending_mentor";
                  const canView =
                    r.status === "pending_management" ||
                    r.status === "completed";

                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-surface-muted/60 transition-colors"
                    >
                      <td className="px-3 py-3 text-center text-text-muted tabular-nums text-xs">
                        {((safePage - 1) * pageSize + i + 1).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 font-medium text-text-main">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <UserCircle className="h-3.5 w-3.5 text-text-muted shrink-0" />
                          <span className="truncate">{r.employee_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[12px] font-semibold text-text-muted bg-surface-hover px-1.5 py-0.5 rounded">
                          {formatFyLabel(r.cycle_name)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ReviewStatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3">
                        <RatingCell value={r.self_performance_rating} />
                      </td>
                      <td className="px-4 py-3">
                        <RatingCell value={r.mentor_performance_rating} />
                      </td>
                      <td className="px-4 py-3">
                        <RatingCell value={r.management_performance_rating} />
                      </td>
                      <td className="px-4 py-3">
                        {canEvaluate ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/my-mentees/${r.user_id}?tab=summary`)}
                            className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand hover:text-white transition-colors"
                          >
                            <ClipboardCheck className="h-3 w-3" /> Evaluate
                          </button>
                        ) : canView ? (
                          <button
                            type="button"
                            onClick={() => setViewTarget(r)}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
                          >
                            <Eye className="h-3 w-3" /> View
                          </button>
                        ) : (
                          <span className="text-[11px] italic text-text-muted">
                            Awaiting self-review
                          </span>
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
            totalItems={sorted.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {viewTarget && (
        <AnnualReviewDetailModal
          review={viewTarget}
          ratingLabel="Management Rating"
          title={`${viewTarget.employee_name} · Annual Review`}
          subtitle={`Year: ${formatFyLabel(viewTarget.cycle_name)}${
            viewTarget.department ? ` · ${viewTarget.department}` : ""
          }`}
          onClose={() => setViewTarget(null)}
        />
      )}
    </div>
  );
}
