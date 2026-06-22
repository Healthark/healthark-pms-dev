/**
 * AllReviewsTab — read-only, org-wide project-review overview for Admins.
 *
 * The Year filter drives the SERVER fetch: the tab requests just the selected
 * fiscal year's reviews (`/all?fy_year=`), so the browser never loads every
 * year at once. Those reviews are collapsed by `groupProjectReviews` into one
 * row per (employee, project, FY) with H1/H2 chips; Employee / Project /
 * Reviewer / Progress filtering + pagination then run client-side on that
 * (bounded) year's data. Clicking a chip with a backing review opens the
 * read-only `ProjectReviewDetailModal`.
 *
 * Year options come from a dedicated endpoint so the dropdown lists every year
 * regardless of what's currently loaded. Admins bypass the org-wide
 * `project_ratings_visible` gate (an Employee-facing control), so ratings are
 * always shown here.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ProjectReviewResponse } from "../../services/project-review.service";
import {
  useAllProjectReviews,
  useAllReviewYears,
} from "../../queries/projectReviews";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { groupProjectReviews } from "../../utils/groupProjectReviews";
import { formatFyYearSpan, fyTokenToStartYear } from "../../utils/fy";
import { CycleReviewChip } from "../reviews/CycleReviewChip";
import { ProjectReviewDetailModal } from "./ProjectReviewDetailModal";
import { StringCombobox } from "../common/StringCombobox";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { TablePagination } from "../common/TablePagination";

type ProgressFilter = "all" | "complete" | "in_progress" | "not_started";

export function AllReviewsTab() {
  const { settings } = useSystemSettings();

  const [employeeFilter, setEmployeeFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [reviewerFilter, setReviewerFilter] = useState("");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  // "" = use the default (current FY); "all" = every year; else String(fy_year).
  const [yearFilter, setYearFilter] = useState<string>("");
  const [viewTarget, setViewTarget] = useState<ProjectReviewResponse | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Year default = the active FY. "" state falls back to it. `effectiveYear`
  // is what the Year <select> shows and what drives the server fetch.
  const activeFyYear = settings?.active_cycle_name
    ? fyTokenToStartYear(settings.active_cycle_name)
    : null;
  const yearDefault = activeFyYear !== null ? String(activeFyYear) : "all";
  const effectiveYear = yearFilter !== "" ? yearFilter : yearDefault;

  // Year drives the SERVER fetch — only the selected year's reviews load.
  const { data: reviews = [], isPending, error } = useAllProjectReviews(
    effectiveYear === "all" ? null : Number(effectiveYear),
  );
  const { data: yearOptions = [] } = useAllReviewYears();

  const grouped = useMemo(
    () =>
      groupProjectReviews(
        reviews,
        settings?.cycle_type ?? null,
        settings?.active_cycle_name ?? null,
      ),
    [reviews, settings?.cycle_type, settings?.active_cycle_name],
  );

  // Employee / Project / Reviewer options derive from the loaded (year-scoped)
  // rows — correct, since you filter within the year you're viewing.
  const employees = useMemo(
    () => Array.from(new Set(grouped.map((g) => g.employee_name))).sort(),
    [grouped],
  );
  const projects = useMemo(
    () => Array.from(new Set(grouped.map((g) => g.project_name))).sort(),
    [grouped],
  );
  const reviewers = useMemo(
    () =>
      Array.from(
        new Set(
          grouped.map((g) => g.reviewer_name).filter((n): n is string => !!n),
        ),
      ).sort(),
    [grouped],
  );
  // Year dropdown lists every year that has reviews (from the endpoint) plus
  // the active FY, newest-first — independent of the currently-loaded year.
  const availableYears = useMemo(() => {
    const ys = new Set<number>(yearOptions);
    if (activeFyYear !== null) ys.add(activeFyYear);
    return Array.from(ys).sort((a, b) => b - a);
  }, [yearOptions, activeFyYear]);

  const visible = useMemo(() => {
    return grouped.filter((g) => {
      if (employeeFilter && g.employee_name !== employeeFilter) return false;
      if (projectFilter && g.project_name !== projectFilter) return false;
      if (reviewerFilter && g.reviewer_name !== reviewerFilter) return false;
      if (progressFilter !== "all") {
        if (g.totalSlots === 0) return false;
        if (progressFilter === "complete" && g.reviewedCount !== g.totalSlots)
          return false;
        if (progressFilter === "not_started" && g.reviewedCount !== 0)
          return false;
        if (
          progressFilter === "in_progress" &&
          !(g.reviewedCount > 0 && g.reviewedCount < g.totalSlots)
        )
          return false;
      }
      return true;
    });
  }, [grouped, employeeFilter, projectFilter, reviewerFilter, progressFilter]);

  // Client-side pagination over the filtered rows. Reset to page 1 when the
  // filter set, the selected year (server-fetched), or page size changes —
  // tracked during render (React's alternative to a reset-in-effect).
  const filterKey = [
    employeeFilter,
    projectFilter,
    reviewerFilter,
    progressFilter,
    effectiveYear,
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
    !!projectFilter ||
    !!reviewerFilter ||
    progressFilter !== "all" ||
    effectiveYear !== yearDefault;
  const clearFilters = () => {
    setEmployeeFilter("");
    setProjectFilter("");
    setReviewerFilter("");
    setProgressFilter("all");
    setYearFilter("");
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

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor="ar-year" className={filterLabelCls}>
            Year
          </label>
          <select
            id="ar-year"
            value={effectiveYear}
            onChange={(e) => setYearFilter(e.target.value)}
            className={`${filterSelectCls} min-w-[130px]`}
          >
            <option value="all">All Years</option>
            {availableYears.map((y) => (
              <option key={y} value={String(y)}>
                {formatFyYearSpan(y)}
              </option>
            ))}
          </select>
        </div>
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
        {projects.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ar-project" className={filterLabelCls}>
              Project
            </label>
            <StringCombobox
              id="ar-project"
              options={projects}
              value={projectFilter}
              onChange={setProjectFilter}
              placeholder="All projects"
            />
          </div>
        )}
        {reviewers.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ar-reviewer" className={filterLabelCls}>
              Reviewer
            </label>
            <StringCombobox
              id="ar-reviewer"
              options={reviewers}
              value={reviewerFilter}
              onChange={setReviewerFilter}
              placeholder="All reviewers"
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="ar-progress" className={filterLabelCls}>
            Progress
          </label>
          <select
            id="ar-progress"
            value={progressFilter}
            onChange={(e) => setProgressFilter(e.target.value as ProgressFilter)}
            className={`${filterSelectCls} min-w-[150px]`}
          >
            <option value="all">All</option>
            <option value="complete">Fully Reviewed</option>
            <option value="in_progress">Partially Reviewed</option>
            <option value="not_started">Not Reviewed</option>
          </select>
        </div>
        <span className="text-xs text-text-muted">
          {visible.length} {visible.length === 1 ? "row" : "rows"}
        </span>
        <ClearFiltersButton
          active={hasActiveFilters}
          onClear={clearFilters}
          className="ml-auto"
        />
      </div>

      {/* Grouped table + pagination (client-side, like the other admin tables) */}
      <div className="rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-[13px]">
            <thead>
              <tr className="bg-surface-muted/80 border-b border-border">
                <th className="text-left px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Employee
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Project
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Code
                </th>
                <th className="hidden sm:table-cell text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Reviewer
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Year
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Cycle Reviews
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center">
                    <Search
                      className="h-6 w-6 text-text-muted mx-auto mb-1"
                      aria-hidden="true"
                    />
                    <p className="text-[13px] text-text-main font-medium">
                      No reviews to show
                    </p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      Try a different year or adjusting your filters.
                    </p>
                  </td>
                </tr>
              ) : (
                pageRows.map((g) => (
                  <tr
                    key={g.key}
                    className="hover:bg-surface-muted/60 transition-colors"
                  >
                    <td className="px-5 py-3 font-medium text-text-main">
                      {g.employee_name}
                    </td>
                    <td className="px-4 py-3 font-medium text-text-main">
                      {g.project_name}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text-muted">
                      {g.project_code}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-text-muted">
                      {g.reviewer_name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] font-semibold text-text-muted bg-surface-hover px-1.5 py-0.5 rounded">
                        {formatFyYearSpan(g.fy_year)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[11px] text-text-muted mb-1.5">
                        <span className="font-semibold text-text-main tabular-nums">
                          {g.reviewedCount}
                        </span>{" "}
                        of{" "}
                        <span className="tabular-nums">{g.totalSlots}</span>{" "}
                        reviewed
                      </p>
                      <div className="flex flex-wrap items-center gap-1">
                        {g.slots.map((slot) => (
                          <CycleReviewChip
                            key={slot.cycleName}
                            slot={slot}
                            onClick={(s) => {
                              if (s.review) setViewTarget(s.review);
                            }}
                          />
                        ))}
                      </div>
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

      {viewTarget && (
        <ProjectReviewDetailModal
          review={viewTarget}
          onClose={() => setViewTarget(null)}
          projectRatingsVisible={true}
        />
      )}
    </div>
  );
}
