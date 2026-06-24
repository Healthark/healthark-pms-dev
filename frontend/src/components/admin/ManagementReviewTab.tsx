/**
 * ManagementReviewTab.tsx — Management Review grid for the AdminPanel.
 *
 * Only rendered when the current user is role === "Admin" AND
 * is_management === true. The backend also enforces both via
 * _require_management, so this gate is purely a UI affordance — the API
 * will 403 anyone else.
 *
 * Renders all annual reviews in the active cycle that have cleared the
 * mentor stage (pending_management + completed) as a single table, and
 * lets management set/override the management rating inline via a modal.
 */

import { useState } from "react";
import { Eye, Loader2, Pencil, ShieldCheck, X } from "lucide-react";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { StringCombobox } from "../common/StringCombobox";
import {
  type CalibrationRow,
  type CalibrationQuery,
} from "../../services/annual-review.service";
import {
  useCalibrationGrid,
  useCalibrationFilterOptions,
  useSetManagementRating,
} from "../../queries/annualReviews";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";
import { PerformanceRatingSelect } from "../reviews/PerformanceRatingSelect";
import { ReviewDetailLoader } from "../reviews/ReviewDetailLoader";
import { getErrorMessage } from "../../utils/errors";
import { extractFyToken, formatFyLabel } from "../../utils/fy";
import { useConfirm } from "../../hooks/useConfirm";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { TablePagination } from "../common/TablePagination";
import { SortableHeader } from "../SortableHeader";
import { type SortState } from "../../utils/sort";

type RatingValue = number | "";
type StatusFilter = "all" | "pending" | "rated";

interface EditTarget {
  readonly row: CalibrationRow;
  readonly draft: RatingValue;
}

type MgmtReviewSortKey =
  | "employee_name"
  | "employee_email"
  | "mentor_name"
  | "department"
  | "cycle_name"
  | "self_performance_rating"
  | "mentor_performance_rating"
  | "management_performance_rating";

// Mentor-filter sentinel — must match the backend's _NO_MENTOR_SENTINEL.
// Selecting it surfaces reviews whose employee has no mentor.
const NO_MENTOR_OPTION = "(No mentor)";

export function ManagementReviewTab() {
  const setManagementRatingMutation = useSetManagementRating();
  const isSaving = setManagementRatingMutation.isPending;

  // ── Filter / sort / paging state (drives the server query) ────────
  // Employee + mentor use the "" = all sentinel (searchable comboboxes);
  // dept/status keep the "all" sentinel (short plain <select>s).
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [designationFilter, setDesignationFilter] = useState<string>("all");
  const [mentorFilter, setMentorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Year filter. Default = the active cycle's FY (current year); "all" spans
  // every year so past management reviews are viewable. Stored as null until
  // the user picks, so we can fall back to the active year as it resolves.
  const { settings } = useSystemSettings();
  const activeYear = settings?.active_cycle_name
    ? extractFyToken(settings.active_cycle_name)
    : "";
  // Publishing a management rating is gated server-side by
  // _require_management_review_open (the active FY's management_review_enabled
  // flag — independent of the employee/mentor window). Mirror it here so the
  // Edit affordance only lights up when a publish would actually succeed —
  // past years and a closed management-review window are view-only.
  const managementReviewEnabled = settings?.management_review_enabled ?? false;
  const [yearFilter, setYearFilter] = useState<string | null>(null);
  const selectedYear = yearFilter ?? activeYear;
  const [sort, setSort] = useState<SortState<MgmtReviewSortKey> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Reset to page 1 whenever a filter / sort / page-size changes — computed
  // during render (not in a useEffect) so a filter change doesn't first fire a
  // wasted request for the old page under keepPreviousData. Mirrors MyMentees.
  const filterKey = [
    employeeFilter,
    deptFilter,
    designationFilter,
    mentorFilter,
    statusFilter,
    selectedYear,
    sort ? `${sort.key}:${sort.direction}` : "",
    pageSize,
  ].join("|");
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  let activePage = page;
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
    activePage = 1;
  }

  const query: CalibrationQuery = {
    page: activePage,
    per_page: pageSize,
    employee: employeeFilter || undefined,
    department: deptFilter !== "all" ? deptFilter : undefined,
    designation: designationFilter !== "all" ? designationFilter : undefined,
    mentor: mentorFilter || undefined,
    status: statusFilter,
    // selectedYear is an FY label ("FY25-26") or "all"; empty (settings still
    // loading) → omit so the backend defaults to the active cycle.
    year: selectedYear || undefined,
    sort_by: sort?.key,
    sort_dir: sort?.direction,
  };

  // ['annual-reviews', 'calibration', query] — param-keyed page cache.
  const { data, isLoading, isFetching, error } = useCalibrationGrid(query);
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const loadError = error ? getErrorMessage(error) : "";

  // Filter dropdown options — fetched once, cached 5 min, independent of
  // the current page so dropdowns always list every available value.
  const { data: filterOptions } = useCalibrationFilterOptions();
  const availableEmployees = filterOptions?.employees ?? [];
  const availableDepts = filterOptions?.departments ?? [];
  const availableDesignations = filterOptions?.designations ?? [];
  // Prepend the "(No mentor)" sentinel so HR can surface unmentored employees
  // (backend maps it to mentor_id IS NULL).
  const mentorOptions = [NO_MENTOR_OPTION, ...(filterOptions?.mentors ?? [])];
  // Year options (newest first) from the server; guarantee the active year is
  // present even before the options query resolves so the default selection
  // always has a matching <option>.
  const serverYears = filterOptions?.years ?? [];
  const availableYears =
    activeYear && !serverYears.includes(activeYear)
      ? [activeYear, ...serverYears]
      : serverYears;

  // A year selection that isn't the default (current year) counts as active —
  // including "all". Defends against activeYear being "" mid-load.
  const yearIsFiltered = !!selectedYear && selectedYear !== activeYear;

  const hasActiveFilters =
    !!employeeFilter ||
    deptFilter !== "all" ||
    designationFilter !== "all" ||
    !!mentorFilter ||
    statusFilter !== "all" ||
    yearIsFiltered;

  const clearFilters = () => {
    setEmployeeFilter("");
    setDeptFilter("all");
    setDesignationFilter("all");
    setMentorFilter("");
    setStatusFilter("all");
    setYearFilter(null); // back to the current year (default)
    setPage(1);
  };

  const [viewReviewId, setViewReviewId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [saveError, setSaveError] = useState("");
  const confirm = useConfirm();

  const handleSave = async () => {
    if (!editTarget) return;
    // Calibration rows always carry a review_id (only the All Reviews roster
    // produces id-less not_started rows), so this is a type guard in practice.
    const reviewId = editTarget.row.review_id;
    if (reviewId == null) return;
    if (editTarget.draft === "") {
      setSaveError("Please select a rating.");
      return;
    }
    const isOverwrite =
      editTarget.row.management_performance_rating != null;
    const ok = await confirm({
      title: isOverwrite
        ? `Overwrite management rating for ${editTarget.row.employee_name}?`
        : `Publish management rating for ${editTarget.row.employee_name}?`,
      message: isOverwrite
        ? `Replace the existing management rating with ${editTarget.draft}/5. ${editTarget.row.employee_name} will see the updated rating immediately.`
        : `Publish a management rating of ${editTarget.draft}/5 for ${editTarget.row.employee_name}. Once saved, ${editTarget.row.employee_name} will be able to see this rating in their own annual review.`,
      variant: isOverwrite ? "warning" : "default",
      confirmText: isOverwrite ? "Overwrite Rating" : "Publish Rating",
    });
    if (!ok) return;
    setSaveError("");
    try {
      await setManagementRatingMutation.mutateAsync({
        reviewId,
        payload: { management_performance_rating: editTarget.draft },
      });
      setEditTarget(null);
    } catch (err) {
      setSaveError(getErrorMessage(err));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading reviews…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-5">
        <p className="text-sm text-rose-600 dark:text-rose-300">{loadError}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="border-b border-border px-5 py-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label
            htmlFor="mgmt-review-employee-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Employee
          </label>
          <StringCombobox
            id="mgmt-review-employee-filter"
            options={availableEmployees}
            value={employeeFilter}
            onChange={setEmployeeFilter}
            placeholder="All employees"
          />
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="mgmt-review-year-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Year
          </label>
          <select
            id="mgmt-review-year-filter"
            value={selectedYear}
            onChange={(e) => setYearFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[130px] cursor-pointer"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {formatFyLabel(y)}
              </option>
            ))}
            <option value="all">All</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="mgmt-review-dept-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Dept
          </label>
          <select
            id="mgmt-review-dept-filter"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[140px] cursor-pointer"
          >
            <option value="all">All</option>
            {availableDepts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="mgmt-review-designation-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Designation
          </label>
          <select
            id="mgmt-review-designation-filter"
            value={designationFilter}
            onChange={(e) => setDesignationFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[150px] cursor-pointer"
          >
            <option value="all">All</option>
            {availableDesignations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="mgmt-review-mentor-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Mentor
          </label>
          <StringCombobox
            id="mgmt-review-mentor-filter"
            options={mentorOptions}
            value={mentorFilter}
            onChange={setMentorFilter}
            placeholder="All mentors"
          />
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="mgmt-review-status-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Status
          </label>
          <select
            id="mgmt-review-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="rated">Rated</option>
          </select>
        </div>

        <ClearFiltersButton
          className="ml-auto"
          active={hasActiveFilters}
          onClear={clearFilters}
        />
      </div>

      {!managementReviewEnabled && (
        <div className="border-b border-border bg-amber-50 dark:bg-amber-950/30 px-5 py-3 text-[13px] text-amber-800 dark:text-amber-200">
          The management review window is currently closed. You can view
          evaluations, but management ratings can't be published until an admin
          opens Management Review for this fiscal year in System Settings.
        </div>
      )}

      {/* Table / Empty state */}
      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldCheck
            className="h-10 w-10 text-text-muted mb-3"
            aria-hidden="true"
          />
          <p className="font-display text-base font-medium text-text-main">
            {hasActiveFilters
              ? "No reviews match your filters"
              : "No reviews yet"}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {hasActiveFilters
              ? "Try a different search term or adjust your filters."
              : "Reviews appear here once they clear the mentor evaluation stage."}
          </p>
        </div>
      ) : (
        <div
          className={`overflow-x-auto transition-opacity ${
            isFetching ? "opacity-60" : "opacity-100"
          }`}
          aria-busy={isFetching}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left">
                <th className="px-5 py-3">
                  <SortableHeader label="User" columnKey="employee_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Email" columnKey="employee_email" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Mentor" columnKey="mentor_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Department" columnKey="department" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Year" columnKey="cycle_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Self Review" columnKey="self_performance_rating" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Mentor Review" columnKey="mentor_performance_rating" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Management Rating" columnKey="management_performance_rating" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr
                  key={r.review_id}
                  className="transition-colors hover:bg-surface-muted"
                >
                  <td className="px-5 py-3.5 font-medium text-text-main">
                    {r.employee_name}
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {r.employee_email ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {r.mentor_name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {r.department ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-text-muted whitespace-nowrap">
                    {formatFyLabel(r.cycle_name)}
                  </td>
                  <td className="px-5 py-3.5">
                    <PerformanceRatingBadge value={r.self_performance_rating} />
                  </td>
                  <td className="px-5 py-3.5">
                    <PerformanceRatingBadge
                      value={r.mentor_performance_rating}
                    />
                  </td>
                  <td className="px-5 py-3.5">
                    <PerformanceRatingBadge
                      value={r.management_performance_rating}
                    />
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setViewReviewId(r.review_id)}
                        title={`View review for ${r.employee_name}`}
                        className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
                        aria-label={`View review for ${r.employee_name}`}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {(() => {
                        // Mirror the backend _require_reviews_open gate: only the
                        // active FY, and only while its window is open, can be
                        // published. Past years / closed window → read-only.
                        const editable =
                          r.cycle_name === activeYear && managementReviewEnabled;
                        if (editable) {
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                setSaveError("");
                                setEditTarget({
                                  row: r,
                                  draft: r.management_performance_rating ?? "",
                                });
                              }}
                              title={
                                r.management_performance_rating == null
                                  ? "Add management rating"
                                  : "Edit management rating"
                              }
                              className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
                              aria-label={`Edit management rating for ${r.employee_name}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </button>
                          );
                        }
                        const reason =
                          r.cycle_name !== activeYear
                            ? "Past reviews are read-only"
                            : "Management review is closed — open it in System Settings to publish ratings";
                        return (
                          <button
                            type="button"
                            disabled
                            title={reason}
                            aria-label={reason}
                            className="rounded-md p-1.5 text-text-muted/40 cursor-not-allowed"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <TablePagination
          page={activePage}
          pageSize={pageSize}
          totalItems={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}

      {viewReviewId != null && (
        <ReviewDetailLoader
          reviewId={viewReviewId}
          onClose={() => setViewReviewId(null)}
        />
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
            <div className="flex items-start justify-between border-b border-border px-5 py-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-text-main">
                  Management Rating
                </h3>
                <p className="mt-0.5 text-xs text-text-muted">
                  {editTarget.row.employee_name} ·{" "}
                  {editTarget.row.department ?? "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded-md p-1 text-text-muted hover:bg-surface-hover"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-text-muted">Self Rating</p>
                  <PerformanceRatingBadge
                    value={editTarget.row.self_performance_rating}
                  />
                </div>
                <div>
                  <p className="text-text-muted">Mentor Rating</p>
                  <PerformanceRatingBadge
                    value={editTarget.row.mentor_performance_rating}
                  />
                </div>
              </div>
              <PerformanceRatingSelect
                id="management-rating-input"
                label="Management Rating"
                value={editTarget.draft}
                onChange={(next) =>
                  setEditTarget({ ...editTarget, draft: next })
                }
                disabled={isSaving}
              />
              {saveError && (
                <p className="text-xs text-rose-600 dark:text-rose-300">{saveError}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={isSaving}
                className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-text-main hover:bg-surface-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
