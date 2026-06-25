/**
 * AllReviewsTab — read-only, org-wide annual-review overview for Admins.
 *
 * The annual-reviews analog of the goals "All Goals" tab. The calibration
 * grid only shows reviews that have cleared the mentor stage
 * (pending_management + completed); this tab shows EVERY submitted review
 * across every employee and fiscal year, so an admin can see the whole
 * pipeline — including pending-mentor reviews still being evaluated.
 *
 * `GET /annual-reviews/all` returns the full set (drafts + deactivated
 * employees excluded), so filtering (Employee / Department / Designation /
 * Mentor / Year / Status) and pagination all run client-side. "View" opens
 * the same read-only AnnualReviewDetailModal used elsewhere.
 */

import { useMemo, useState } from "react";
import { ClipboardList, Eye, UserCircle } from "lucide-react";
import type { CalibrationRow, ReviewStatus } from "../../services/annual-review.service";
import { useAllReviews } from "../../queries/annualReviews";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { extractFyToken, formatFyLabel, sortCyclesDesc } from "../../utils/fy";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { PerformanceRatingBadge } from "./PerformanceRatingBadge";
import { ReviewDetailLoader } from "./ReviewDetailLoader";
import { StringCombobox } from "../common/StringCombobox";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { TablePagination } from "../common/TablePagination";

const STATUS_LABELS: Record<ReviewStatus, string> = {
  not_started: "Not Started",
  draft: "Draft",
  pending_mentor: "Pending Mentor",
  pending_management: "Pending Management",
  completed: "Completed",
};

export function AllReviewsTab() {
  // Toolbar order mirrors the app convention: Identity → Category → Relation
  // → Time → State (Employee · Department · Designation · Mentor · Year · Status).
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [mentorFilter, setMentorFilter] = useState("");
  // "" = use the default (current/active FY); "all" = every year; else an FY label.
  const [yearFilter, setYearFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewReviewId, setViewReviewId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data: reviews = [], isPending, error } = useAllReviews();
  const { settings } = useSystemSettings();

  // Year defaults to the active FY (current year); the "" state falls back to
  // it. Annual reviews store the bare FY label ("FY26-27") as cycle_name, so
  // the filter compares label strings directly.
  const activeYear = settings?.active_cycle_name
    ? extractFyToken(settings.active_cycle_name)
    : "";
  const yearDefault = activeYear || "all";
  const effectiveYear = yearFilter !== "" ? yearFilter : yearDefault;

  // Filter-dropdown options derive from the full loaded set so they never
  // shrink as other filters narrow the table.
  const years = useMemo(() => {
    const set = new Set(reviews.map((r) => r.cycle_name));
    if (activeYear) set.add(activeYear);
    return sortCyclesDesc(Array.from(set));
  }, [reviews, activeYear]);
  const employees = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.employee_name))).sort(),
    [reviews],
  );
  const departments = useMemo(
    () =>
      Array.from(
        new Set(reviews.map((r) => r.department).filter((n): n is string => !!n)),
      ).sort(),
    [reviews],
  );
  const designations = useMemo(
    () =>
      Array.from(
        new Set(reviews.map((r) => r.designation).filter((n): n is string => !!n)),
      ).sort(),
    [reviews],
  );
  const mentors = useMemo(
    () =>
      Array.from(
        new Set(reviews.map((r) => r.mentor_name).filter((n): n is string => !!n)),
      ).sort(),
    [reviews],
  );
  const statuses = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.status))),
    [reviews],
  );

  const visible = useMemo(
    () =>
      reviews.filter((r) => {
        if (effectiveYear !== "all" && r.cycle_name !== effectiveYear) return false;
        if (employeeFilter && r.employee_name !== employeeFilter) return false;
        if (departmentFilter && r.department !== departmentFilter) return false;
        if (designationFilter && r.designation !== designationFilter) return false;
        if (mentorFilter && r.mentor_name !== mentorFilter) return false;
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        return true;
      }),
    [
      reviews,
      effectiveYear,
      employeeFilter,
      departmentFilter,
      designationFilter,
      mentorFilter,
      statusFilter,
    ],
  );

  // Client-side pagination. Reset to page 1 when any filter / page size changes
  // — tracked during render (React's reset-in-effect alternative).
  const filterKey = [
    effectiveYear,
    employeeFilter,
    departmentFilter,
    designationFilter,
    mentorFilter,
    statusFilter,
    pageSize,
  ].join("|");
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  let currentPage = page;
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
    currentPage = 1;
  }
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = visible.slice((safePage - 1) * pageSize, safePage * pageSize);

  const hasActiveFilters =
    !!employeeFilter ||
    !!departmentFilter ||
    !!designationFilter ||
    !!mentorFilter ||
    effectiveYear !== yearDefault ||
    statusFilter !== "all";
  const clearFilters = () => {
    setEmployeeFilter("");
    setDepartmentFilter("");
    setDesignationFilter("");
    setMentorFilter("");
    setYearFilter("");
    setStatusFilter("all");
  };

  if (isPending) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center text-sm text-text-muted bg-background/50">
        Loading reviews…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
        Could not load reviews. Please try again.
      </div>
    );
  }

  const filterLabelCls =
    "text-[11px] font-bold uppercase tracking-wider text-text-muted";
  const filterSelectCls =
    "rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";
  const thCls =
    "text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted";

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {years.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ar-year" className={filterLabelCls}>
              Fiscal Year
            </label>
            <select
              id="ar-year"
              value={effectiveYear}
              onChange={(e) => setYearFilter(e.target.value)}
              className={`${filterSelectCls} min-w-[130px]`}
            >
              <option value="all">All Years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {formatFyLabel(y)}
                </option>
              ))}
            </select>
          </div>
        )}
        {employees.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ar-employee" className={filterLabelCls}>
              Employee
            </label>
            <StringCombobox
              id="ar-employee"
              options={employees}
              value={employeeFilter}
              onChange={setEmployeeFilter}
              placeholder="All employees"
            />
          </div>
        )}
        {departments.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ar-dept" className={filterLabelCls}>
              Department
            </label>
            <StringCombobox
              id="ar-dept"
              options={departments}
              value={departmentFilter}
              onChange={setDepartmentFilter}
              placeholder="All departments"
            />
          </div>
        )}
        {designations.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ar-desig" className={filterLabelCls}>
              Designation
            </label>
            <StringCombobox
              id="ar-desig"
              options={designations}
              value={designationFilter}
              onChange={setDesignationFilter}
              placeholder="All designations"
            />
          </div>
        )}
        {mentors.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ar-mentor" className={filterLabelCls}>
              Mentor
            </label>
            <StringCombobox
              id="ar-mentor"
              options={mentors}
              value={mentorFilter}
              onChange={setMentorFilter}
              placeholder="All mentors"
            />
          </div>
        )}
        {statuses.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ar-status" className={filterLabelCls}>
              Status
            </label>
            <select
              id="ar-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`${filterSelectCls} min-w-[160px]`}
            >
              <option value="all">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </div>
        )}
        <span className="text-xs text-text-muted">
          {visible.length} {visible.length === 1 ? "review" : "reviews"}
        </span>
        <ClearFiltersButton
          active={hasActiveFilters}
          onClear={clearFilters}
          className="ml-auto"
        />
      </div>

      {/* Org-wide review table + client-side pagination */}
      <div className="rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-[13px]">
            <thead>
              <tr className="bg-surface-muted/80 border-b border-border">
                <th className="text-left px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Employee
                </th>
                <th className={thCls}>Fiscal Year</th>
                <th className={`hidden sm:table-cell ${thCls}`}>Department</th>
                <th className={`hidden lg:table-cell ${thCls}`}>Designation</th>
                <th className={`hidden md:table-cell ${thCls}`}>Mentor</th>
                <th className={thCls}>Status</th>
                <th className={`${thCls} text-center`}>Self Rating</th>
                <th className={`${thCls} text-center`}>Mentor Rating</th>
                <th className={`${thCls} text-center`}>Management Rating</th>
                <th className={`${thCls} text-right`}>Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-10 text-center">
                    <ClipboardList
                      className="h-6 w-6 text-text-muted mx-auto mb-1"
                      aria-hidden="true"
                    />
                    <p className="text-[13px] text-text-main font-medium">
                      No reviews to show
                    </p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      Try clearing one or more filters above.
                    </p>
                  </td>
                </tr>
              ) : (
                pageRows.map((r: CalibrationRow) => (
                  <tr
                    key={`${r.user_id}_${r.cycle_name}`}
                    className="transition-colors hover:bg-surface-muted/60"
                  >
                    <td className="px-5 py-3 font-medium text-text-main">
                      {r.employee_name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] font-semibold text-text-muted bg-surface-hover px-1.5 py-0.5 rounded whitespace-nowrap">
                        {formatFyLabel(r.cycle_name)}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-text-muted">
                      {r.department ?? "—"}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-text-muted">
                      {r.designation ?? "—"}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-text-muted">
                      <span className="flex items-center gap-1.5">
                        <UserCircle className="h-3.5 w-3.5 shrink-0" />
                        {r.mentor_name ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ReviewStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <PerformanceRatingBadge value={r.self_performance_rating} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <PerformanceRatingBadge value={r.mentor_performance_rating} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <PerformanceRatingBadge
                        value={r.final_performance_rating ?? r.management_performance_rating}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.review_id != null ? (
                        <button
                          type="button"
                          onClick={() => setViewReviewId(r.review_id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-text-muted hover:bg-surface-muted hover:text-text-main transition-colors"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      ) : (
                        <span className="text-[11px] italic text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={safePage}
          pageSize={pageSize}
          totalItems={visible.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {viewReviewId != null && (
        <ReviewDetailLoader
          reviewId={viewReviewId}
          onClose={() => setViewReviewId(null)}
        />
      )}
    </div>
  );
}
