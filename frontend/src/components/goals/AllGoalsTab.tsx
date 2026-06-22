/**
 * AllGoalsTab — read-only, org-wide annual-goals overview for Admins.
 *
 * Modeled on Miltenyi's HR all-goals view: one row per (employee, fiscal
 * year) across ALL years; clicking a row expands a per-goal sub-table
 * (Goal · Description · Status · View). "View" opens the read-only
 * `GoalReviewDetailsModal` so an admin can audit the actual self/mentor
 * review text, not just the status. Drafts are never included (the backend
 * excludes them — owner-private work-in-progress).
 *
 * `GET /goals/all` returns every employee's non-draft goals (all years), so
 * grouping, filtering (Employee / Department / Designation / Mentor / Year /
 * Status), and pagination all run client-side on that set.
 */

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, Eye, Target, UserCircle } from "lucide-react";
import type { TeamGoal } from "../../services/goal.service";
import { useAllGoals } from "../../queries/goals";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { formatFyYearSpan, fyTokenToStartYear } from "../../utils/fy";
import { ApprovalStatusBadge } from "./ApprovalStatusBadge";
import { GoalReviewDetailsModal } from "./GoalReviewDetailsModal";
import { StringCombobox } from "../common/StringCombobox";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { TablePagination } from "../common/TablePagination";

interface EmployeeGroup {
  key: string; // `${user_id}_${fy_year}`
  owner_name: string;
  department: string | null;
  designation: string | null;
  mentor_name: string | null;
  fy_year: number | null;
  goals: TeamGoal[];
}

/** "h1_self_reviewed" → "H1 Self Reviewed", "pending_approval" → "Pending Approval". */
function humanizeStatus(s: string): string {
  return s
    .split("_")
    .map((w) =>
      /^[hq]\d$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

/** A goal has reviewable content once any self/mentor review is submitted. */
function hasSubmittedReview(g: TeamGoal): boolean {
  return (
    g.self_reviews.some((r) => !r.is_draft) ||
    g.mentor_reviews.some((r) => !r.is_draft)
  );
}

export function AllGoalsTab() {
  // Toolbar order mirrors the app convention: Identity → Category → Relation
  // → Time → State (Employee · Department · Designation · Mentor · Year · Status).
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [mentorFilter, setMentorFilter] = useState("");
  // "" = use the default (current/active FY); "all" = every year; else a year.
  const [yearFilter, setYearFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [viewGoal, setViewGoal] = useState<TeamGoal | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data: goals = [], isPending, error } = useAllGoals();
  const { settings } = useSystemSettings();

  // Year defaults to the active FY (current year). "" state falls back to it;
  // `effectiveYear` is what the Year <select> shows and what the table filters by.
  const activeFyYear = settings?.active_cycle_name
    ? fyTokenToStartYear(settings.active_cycle_name)
    : null;
  const yearDefault = activeFyYear !== null ? String(activeFyYear) : "all";
  const effectiveYear = yearFilter !== "" ? yearFilter : yearDefault;

  // Filter-dropdown options derive from the full loaded set so they never
  // shrink as other filters narrow the table. The active FY is always included
  // so it stays selectable even before any goals exist for it.
  const years = useMemo(() => {
    const ys = new Set<number>(
      goals.map((g) => g.fy_year).filter((y): y is number => y != null),
    );
    if (activeFyYear !== null) ys.add(activeFyYear);
    return Array.from(ys).sort((a, b) => b - a);
  }, [goals, activeFyYear]);
  const employees = useMemo(
    () => Array.from(new Set(goals.map((g) => g.owner_name))).sort(),
    [goals],
  );
  const departments = useMemo(
    () =>
      Array.from(
        new Set(
          goals.map((g) => g.owner_department_name).filter((n): n is string => !!n),
        ),
      ).sort(),
    [goals],
  );
  const designations = useMemo(
    () =>
      Array.from(
        new Set(
          goals.map((g) => g.owner_designation_name).filter((n): n is string => !!n),
        ),
      ).sort(),
    [goals],
  );
  const mentors = useMemo(
    () =>
      Array.from(
        new Set(goals.map((g) => g.manager_name).filter((n): n is string => !!n)),
      ).sort(),
    [goals],
  );
  const statuses = useMemo(
    () => Array.from(new Set(goals.map((g) => g.approval_status))).sort(),
    [goals],
  );

  // Status is a goal-level filter; apply it first, then group what remains by
  // (employee, fiscal year) — so each row's Year is accurate and an employee
  // with goals across years gets one row per year.
  const groups = useMemo<EmployeeGroup[]>(() => {
    const matching =
      statusFilter === "all"
        ? goals
        : goals.filter((g) => g.approval_status === statusFilter);
    const map = new Map<string, EmployeeGroup>();
    for (const g of matching) {
      const key = `${g.user_id}_${g.fy_year ?? "null"}`;
      const ex = map.get(key);
      if (ex) {
        ex.goals.push(g);
      } else {
        map.set(key, {
          key,
          owner_name: g.owner_name,
          department: g.owner_department_name,
          designation: g.owner_designation_name,
          mentor_name: g.manager_name,
          fy_year: g.fy_year,
          goals: [g],
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        a.owner_name.localeCompare(b.owner_name) ||
        (b.fy_year ?? 0) - (a.fy_year ?? 0),
    );
  }, [goals, statusFilter]);

  const visible = useMemo(
    () =>
      groups.filter((grp) => {
        if (effectiveYear !== "all" && String(grp.fy_year) !== effectiveYear)
          return false;
        if (employeeFilter && grp.owner_name !== employeeFilter) return false;
        if (departmentFilter && grp.department !== departmentFilter) return false;
        if (designationFilter && grp.designation !== designationFilter) return false;
        if (mentorFilter && grp.mentor_name !== mentorFilter) return false;
        return true;
      }),
    [groups, effectiveYear, employeeFilter, departmentFilter, designationFilter, mentorFilter],
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
        Loading goals…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
        Could not load goals. Please try again.
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
        {employees.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ag-employee" className={filterLabelCls}>
              Employee
            </label>
            <StringCombobox
              id="ag-employee"
              options={employees}
              value={employeeFilter}
              onChange={setEmployeeFilter}
              placeholder="All employees"
            />
          </div>
        )}
        {departments.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ag-dept" className={filterLabelCls}>
              Department
            </label>
            <StringCombobox
              id="ag-dept"
              options={departments}
              value={departmentFilter}
              onChange={setDepartmentFilter}
              placeholder="All departments"
            />
          </div>
        )}
        {designations.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ag-desig" className={filterLabelCls}>
              Designation
            </label>
            <StringCombobox
              id="ag-desig"
              options={designations}
              value={designationFilter}
              onChange={setDesignationFilter}
              placeholder="All designations"
            />
          </div>
        )}
        {mentors.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ag-mentor" className={filterLabelCls}>
              Mentor
            </label>
            <StringCombobox
              id="ag-mentor"
              options={mentors}
              value={mentorFilter}
              onChange={setMentorFilter}
              placeholder="All mentors"
            />
          </div>
        )}
        {years.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ag-year" className={filterLabelCls}>
              Year
            </label>
            <select
              id="ag-year"
              value={effectiveYear}
              onChange={(e) => setYearFilter(e.target.value)}
              className={`${filterSelectCls} min-w-[130px]`}
            >
              <option value="all">All Years</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {formatFyYearSpan(y)}
                </option>
              ))}
            </select>
          </div>
        )}
        {statuses.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ag-status" className={filterLabelCls}>
              Status
            </label>
            <select
              id="ag-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`${filterSelectCls} min-w-[150px]`}
            >
              <option value="all">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {humanizeStatus(s)}
                </option>
              ))}
            </select>
          </div>
        )}
        <span className="text-xs text-text-muted">
          {visible.length} {visible.length === 1 ? "row" : "rows"}
        </span>
        <ClearFiltersButton
          active={hasActiveFilters}
          onClear={clearFilters}
          className="ml-auto"
        />
      </div>

      {/* Employee × FY table + client-side pagination */}
      <div className="rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-[13px]">
            <thead>
              <tr className="bg-surface-muted/80 border-b border-border">
                <th className="text-left px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Employee
                </th>
                <th className={`hidden sm:table-cell ${thCls}`}>Department</th>
                <th className={`hidden md:table-cell ${thCls}`}>Designation</th>
                <th className={thCls}>Year</th>
                <th className={thCls}>Mentor</th>
                <th className={thCls}>Goals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center">
                    <Target
                      className="h-6 w-6 text-text-muted mx-auto mb-1"
                      aria-hidden="true"
                    />
                    <p className="text-[13px] text-text-main font-medium">
                      No goals to show
                    </p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      Try clearing one or more filters above.
                    </p>
                  </td>
                </tr>
              ) : (
                pageRows.map((grp) => {
                  const isExpanded = expandedKey === grp.key;
                  return (
                    <Fragment key={grp.key}>
                      <tr
                        className={`cursor-pointer transition-colors ${
                          isExpanded ? "bg-brand/5" : "hover:bg-surface-muted/60"
                        }`}
                        onClick={() =>
                          setExpandedKey(isExpanded ? null : grp.key)
                        }
                      >
                        <td className="px-5 py-3 font-medium text-text-main">
                          <div className="flex items-center gap-2">
                            <ChevronDown
                              className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                            {grp.owner_name}
                          </div>
                        </td>
                        <td className="hidden sm:table-cell px-4 py-3 text-text-muted">
                          {grp.department ?? "—"}
                        </td>
                        <td className="hidden md:table-cell px-4 py-3 text-text-muted">
                          {grp.designation ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          {grp.fy_year ? (
                            <span className="text-[12px] font-semibold text-text-muted bg-surface-hover px-1.5 py-0.5 rounded">
                              {formatFyYearSpan(grp.fy_year)}
                            </span>
                          ) : (
                            <span className="text-[12px] text-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          <span className="flex items-center gap-1.5">
                            <UserCircle className="h-3.5 w-3.5 shrink-0" />
                            {grp.mentor_name ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[12px] font-semibold text-text-muted bg-surface-hover px-1.5 py-0.5 rounded tabular-nums">
                            {grp.goals.length}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-brand/5">
                          <td colSpan={6} className="px-5 sm:px-10 py-3">
                            <table className="w-full text-[13px]">
                              <thead>
                                <tr className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                                  <th className="text-left px-3 py-1.5">Goal</th>
                                  <th className="text-left px-3 py-1.5">
                                    Description
                                  </th>
                                  <th className="text-left px-3 py-1.5">Status</th>
                                  <th className="text-right px-3 py-1.5">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/40">
                                {grp.goals.map((g, gi) => (
                                  <tr key={g.id} className="align-top">
                                    <td className="px-3 py-2 font-medium text-text-main">
                                      <span className="mr-1.5 font-mono text-[12px] text-text-muted tabular-nums">
                                        {gi + 1}.
                                      </span>
                                      {g.title}
                                    </td>
                                    <td className="px-3 py-2 text-[12.5px] text-text-muted max-w-md">
                                      {g.description ? (
                                        <span className="whitespace-normal break-words">
                                          {g.description}
                                        </span>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      <ApprovalStatusBadge
                                        status={g.approval_status}
                                      />
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {hasSubmittedReview(g) ? (
                                        <button
                                          type="button"
                                          onClick={() => setViewGoal(g)}
                                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-text-muted hover:bg-surface-muted hover:text-text-main transition-colors"
                                        >
                                          <Eye className="h-3 w-3" /> View
                                        </button>
                                      ) : (
                                        <span className="text-[11px] italic text-text-muted">
                                          —
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
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

      {viewGoal && (
        <GoalReviewDetailsModal
          goal={viewGoal}
          onClose={() => setViewGoal(null)}
        />
      )}
    </div>
  );
}
