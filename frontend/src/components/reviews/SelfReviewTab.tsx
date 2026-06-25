/**
 * SelfReviewTab.tsx — "My Review" list for the logged-in user.
 *
 * Presentational: receives the review history (+ load/error state) from the
 * parent page and renders a single table over it with Year / Status filters,
 * column sorting, and client-side pagination. The "Start Self-Review" action
 * lives in the AnnualReviews page header so it stays reachable regardless of
 * list state; this tab shows the read-only empty state when the user has no
 * reviews at all.
 */

import { useState } from "react";
import { Eye, Loader2, Lock, UserCircle, ClipboardCheck, Pencil } from "lucide-react";
import type {
  AnnualReview,
  ReviewStatus,
} from "../../services/annual-review.service";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { PerformanceRatingBadge } from "./PerformanceRatingBadge";
import { AnnualReviewDetailModal } from "./AnnualReviewDetailModal";
import { SortableHeader } from "../SortableHeader";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { TablePagination } from "../common/TablePagination";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";
import { extractFyToken, formatFyLabel } from "../../utils/fy";
import { getErrorMessage } from "../../utils/errors";
import { useSystemSettings } from "../../hooks/useSystemSettings";

function FinalRatingHiddenBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-muted/60">
      <Lock className="h-3 w-3" aria-hidden="true" /> Hidden
    </span>
  );
}

type SortKey = "cycle_name" | "status" | "self_performance_rating";
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
  { kind: SortKind; get: (r: AnnualReview) => unknown }
> = {
  cycle_name:              { kind: "alpha",   get: (r) => r.cycle_name },
  status:                  { kind: "alpha",   get: (r) => r.status },
  self_performance_rating: { kind: "numeric", get: (r) => r.self_performance_rating },
};

// ── Empty / load / error states ─────────────────────────────────────

function NoReviewsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center">
      <ClipboardCheck
        className="h-10 w-10 text-text-muted mb-3"
        aria-hidden="true"
      />
      <p className="font-display text-base font-medium text-text-main">
        No self-reviews yet
      </p>
      <p className="mt-1 text-sm text-text-muted max-w-sm">
        Reflect on your performance and submit when ready.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse gap-2">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading your reviews…
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────

interface SelfReviewTabProps {
  readonly reviews: readonly AnnualReview[];
  readonly isLoading: boolean;
  /** Load error from the parent query, if any — shown as an inline banner. */
  readonly error?: unknown;
  /** Active cycle label — the only review a draft can be edited for. */
  readonly activeCycle: string;
  /** Open the self-review form to edit the active-cycle draft. */
  readonly onEditDraft: (review: AnnualReview) => void;
}

/** A row is editable (Edit, not View) when it's the active cycle's draft. */
function isEditableDraft(r: AnnualReview, activeCycle: string): boolean {
  return r.status === "draft" && r.cycle_name === activeCycle;
}

export function SelfReviewTab({
  reviews,
  isLoading,
  error,
  activeCycle,
  onEditDraft,
}: SelfReviewTabProps) {
  const { settings } = useSystemSettings();
  const finalRatingVisible =
    settings?.annual_review_final_rating_visible ?? false;

  const [yearFilter, setYearFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [viewTarget, setViewTarget] = useState<AnnualReview | null>(null);

  const availableYears = Array.from(
    new Set(reviews.map((r) => extractFyToken(r.cycle_name))),
  ).sort((a, b) => b.localeCompare(a));

  const filtered = reviews
    .filter(
      (r) => yearFilter === "all" || extractFyToken(r.cycle_name) === yearFilter,
    )
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
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const hasActiveFilters = yearFilter !== "all" || statusFilter !== "all";

  const clearFilters = () => {
    setYearFilter("all");
    setStatusFilter("all");
  };

  if (isLoading) return <LoadingState />;

  if (error) {
    return (
      <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
        {getErrorMessage(error)}
      </div>
    );
  }

  if (reviews.length === 0) return <NoReviewsEmptyState />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label
            htmlFor="self-review-year-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Fiscal Year
          </label>
          <select
            id="self-review-year-filter"
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
            htmlFor="self-review-status-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Status
          </label>
          <select
            id="self-review-status-filter"
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

      {/* Content */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
          <UserCircle
            className="h-10 w-10 text-text-muted mb-3"
            aria-hidden="true"
          />
          <p className="font-display text-base font-medium text-text-main">
            No reviews match this filter
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Try selecting a different year.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-surface-muted/80 border-b border-border">
                  <th className="text-left px-5 py-2.5">
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
                  <th className="text-left px-4 py-2.5">
                    <SortableHeader
                      label="Self Rating"
                      columnKey="self_performance_rating"
                      sort={sort}
                      onSort={setSort}
                    />
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    Final Rating
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {pageRows.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-surface-muted/60 transition-colors"
                  >
                    <td className="px-5 py-3 font-medium text-text-main">
                      <span className="text-[12.5px] font-semibold text-text-muted bg-surface-hover px-1.5 py-0.5 rounded">
                        {formatFyLabel(r.cycle_name)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ReviewStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      <PerformanceRatingBadge value={r.self_performance_rating} />
                    </td>
                    <td className="px-4 py-3">
                      {finalRatingVisible ? (
                        <PerformanceRatingBadge
                          value={r.final_performance_rating}
                        />
                      ) : (
                        <FinalRatingHiddenBadge />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditableDraft(r, activeCycle) ? (
                        <button
                          type="button"
                          onClick={() => onEditDraft(r)}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setViewTarget(r)}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
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

      {/* Read-only detail modal */}
      {viewTarget && (
        <AnnualReviewDetailModal
          review={viewTarget}
          title="Self Annual Review"
          subtitle={`Year: ${formatFyLabel(viewTarget.cycle_name)}`}
          onClose={() => setViewTarget(null)}
        />
      )}
    </div>
  );
}
