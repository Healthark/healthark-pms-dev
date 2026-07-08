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
import { Search, Trash2 } from "lucide-react";
import type { ProjectReviewResponse } from "../../services/project-review.service";
import {
  useAllProjectReviews,
  useAllReviewYears,
  useDeleteProjectReview,
} from "../../queries/projectReviews";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { useConfirm } from "../../hooks/useConfirm";
import {
  groupProjectReviews,
  createEmptyGroupedReviewRow,
  type GroupedReviewRow,
} from "../../utils/groupProjectReviews";
import { formatFyYearSpan, fyTokenToStartYear } from "../../utils/fy";
import { buildProjectCodeIndex } from "../../utils/projectCodeIndex";
import { CycleReviewChip } from "../reviews/CycleReviewChip";
import {
  ProjectReviewDetailModal,
  type PendingReviewContext,
} from "./ProjectReviewDetailModal";
import { StringCombobox } from "../common/StringCombobox";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { TablePagination } from "../common/TablePagination";

type ProgressFilter = "all" | "complete" | "in_progress" | "not_started";

/** The detail modal shows EITHER a real review OR a read-only placeholder for a
 *  pending cycle with no DB row yet. A single target makes "both open at once"
 *  unrepresentable. */
type ReviewModalTarget =
  | { readonly kind: "review"; readonly review: ProjectReviewResponse }
  | { readonly kind: "pending"; readonly context: PendingReviewContext };

export function AllReviewsTab() {
  const { settings } = useSystemSettings();

  const [employeeFilter, setEmployeeFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [reviewerFilter, setReviewerFilter] = useState("");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  // "" = use the default (current FY); "all" = every year; else String(fy_year).
  const [yearFilter, setYearFilter] = useState<string>("");
  // Real review, or a placeholder for a pending cycle with no DB row yet.
  const [modalTarget, setModalTarget] = useState<ReviewModalTarget | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<GroupedReviewRow | null>(
    null,
  );
  const [placeholderGroups, setPlaceholderGroups] = useState<Record<string, GroupedReviewRow>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const deleteReview = useDeleteProjectReview();
  const confirm = useConfirm();

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

  const groupedWithPlaceholders = useMemo(() => {
    const map = new Map<string, GroupedReviewRow>();
    for (const g of grouped) {
      if (g.reviewedCount === 0 && g.totalSlots > 0 && settings?.cycle_type) {
        map.set(
          g.key,
          createEmptyGroupedReviewRow(g, settings.cycle_type, settings.active_cycle_name ?? null),
        );
      } else {
        map.set(g.key, g);
      }
    }
    // Merge any client-side placeholders for groups that vanished after deletion
    for (const k of Object.keys(placeholderGroups)) {
      if (!map.has(k)) map.set(k, placeholderGroups[k]);
    }
    return Array.from(map.values());
  }, [grouped, placeholderGroups, settings?.cycle_type, settings?.active_cycle_name]);

  // Employee / Project / Reviewer options derive from the loaded (year-scoped)
  // rows — correct, since you filter within the year you're viewing.
  const employees = useMemo(
    () => Array.from(new Set(groupedWithPlaceholders.map((g) => g.employee_name))).sort(),
    [groupedWithPlaceholders],
  );
  const projects = useMemo(
    () => Array.from(new Set(groupedWithPlaceholders.map((g) => g.project_name))).sort(),
    [groupedWithPlaceholders],
  );
  // Project Code filter — a synced view onto the name-keyed projectFilter.
  const projectIndex = useMemo(
    () => buildProjectCodeIndex(groupedWithPlaceholders),
    [groupedWithPlaceholders],
  );
  const projectCodeFilter = projectFilter
    ? projectIndex.nameToCode.get(projectFilter) ?? ""
    : "";
  const reviewers = useMemo(
    () =>
      Array.from(
        new Set(
          groupedWithPlaceholders.map((g) => g.reviewer_name).filter((n): n is string => !!n),
        ),
      ).sort(),
    [groupedWithPlaceholders],
  );
  // Year dropdown lists every year that has reviews (from the endpoint) plus
  // the active FY, newest-first — independent of the currently-loaded year.
  const availableYears = useMemo(() => {
    const ys = new Set<number>(yearOptions);
    if (activeFyYear !== null) ys.add(activeFyYear);
    return Array.from(ys).sort((a, b) => b - a);
  }, [yearOptions, activeFyYear]);

  const visible = useMemo(() => {
    return groupedWithPlaceholders.filter((g) => {
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
  }, [groupedWithPlaceholders, employeeFilter, projectFilter, reviewerFilter, progressFilter]);

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

  const handleDeleteReview = async (reviewId: number, cycleName: string) => {
    const ok = await confirm({
      title: `Delete ${cycleName} review`,
      message: `This will permanently delete the ${cycleName} project review for ${deleteTarget?.employee_name} on ${deleteTarget?.project_name}.`,
      variant: "danger",
      confirmText: "Delete",
      cancelText: "Cancel",
    });
    if (!ok) return;

    // Optimistically preserve the group's row as an empty placeholder so the
    // admin still sees the (employee, project, FY) line while the server
    // processes the deletion and queries refetch.
    let placeholderKey: string | null = null;
    if (deleteTarget) {
      placeholderKey = deleteTarget.key;
      setPlaceholderGroups((p) => ({
        ...p,
        [deleteTarget!.key]: createEmptyGroupedReviewRow(
          deleteTarget!,
          settings?.cycle_type ?? null,
          settings?.active_cycle_name ?? null,
        ),
      }));
    }

    try {
      await deleteReview.mutateAsync(reviewId);
    } catch (e) {
      // Rollback the optimistic placeholder on error
      if (placeholderKey) {
        setPlaceholderGroups((p) => {
          const next = { ...p };
          delete next[placeholderKey!];
          return next;
        });
      }
      throw e;
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleDeleteAllReviews = async () => {
    if (!deleteTarget) return;

    const reviewIds = deleteTarget.slots
      .map((slot) => slot.review?.id)
      .filter((id): id is number => id !== undefined);
    if (reviewIds.length === 0) return;

    const ok = await confirm({
      title: "Delete all reviews",
      message: `This will permanently delete all reviews for ${deleteTarget.employee_name} on ${deleteTarget.project_name}.`,
      variant: "danger",
      confirmText: "Delete all",
      cancelText: "Cancel",
    });
    if (!ok) return;
    // Optimistically preserve the group's row before deleting so it doesn't
    // vanish while the batch deletes and refetch occur.
    const placeholder = createEmptyGroupedReviewRow(
      deleteTarget,
      settings?.cycle_type ?? null,
      settings?.active_cycle_name ?? null,
    );
    setPlaceholderGroups((p) => ({ ...p, [deleteTarget.key]: placeholder }));

    try {
      for (const reviewId of reviewIds) {
        await deleteReview.mutateAsync(reviewId);
      }
    } catch (e) {
      // Rollback optimistic placeholder on error
      setPlaceholderGroups((p) => {
        const next = { ...p };
        delete next[deleteTarget.key];
        return next;
      });
      throw e;
    } finally {
      setDeleteTarget(null);
    }
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
            Fiscal Year
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
        {projectIndex.codes.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ar-project-code" className={filterLabelCls}>
              Project Code
            </label>
            <StringCombobox
              id="ar-project-code"
              options={projectIndex.codes}
              value={projectCodeFilter}
              onChange={(code) =>
                setProjectFilter(
                  code ? projectIndex.codeToName.get(code) ?? "" : "",
                )
              }
              placeholder="All codes"
              minWidth="150px"
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
            Status
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
                <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-text-muted">#</th>
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
                  Fiscal Year
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Cycle Reviews
                </th>
                <th className="text-right px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center">
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
                pageRows.map((g, i) => (
                  <tr
                    key={g.key}
                    className="hover:bg-surface-muted/60 transition-colors"
                  >
                    <td className="px-3 py-3 text-center text-text-muted tabular-nums text-xs">
                      {((safePage - 1) * pageSize + i + 1).toLocaleString()}
                    </td>
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
                              if (s.review) {
                                setModalTarget({
                                  kind: "review",
                                  review: s.review,
                                });
                              } else if (s.state === "pending") {
                                // Arrived cycle, no DB row yet — open the
                                // read-only "not yet evaluated" placeholder
                                // built from this group's context. The reviewer
                                // is per-cycle and unknown for a not-started
                                // cycle (the group's reviewer belongs to a
                                // cycle that WAS reviewed, not this one), so
                                // it's left blank rather than shown wrongly.
                                setModalTarget({
                                  kind: "pending",
                                  context: {
                                    project_name: g.project_name,
                                    project_code: g.project_code,
                                    employee_name: g.employee_name,
                                    cycle: s.cycleName,
                                    reviewer_name: null,
                                  },
                                });
                              }
                            }}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(g)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-muted transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                        aria-label={`Delete reviews for ${g.employee_name} on ${g.project_name}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
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

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-review-modal-title"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2
                  id="delete-review-modal-title"
                  className="font-display text-base font-semibold text-text-main"
                >
                  Delete project review
                </h2>
                <p className="mt-2 text-sm text-text-muted">
                  Choose which cycle review to remove for {deleteTarget.employee_name} on {deleteTarget.project_name}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md p-1.5 text-text-muted hover:bg-surface-muted transition-colors"
                aria-label="Close delete dialog"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <div className="space-y-3 px-5 py-5">
              {deleteTarget.slots.map((slot) => {
                const hasReview = Boolean(slot.review);
                return (
                  <button
                    type="button"
                    key={slot.cycleName}
                    disabled={!hasReview || deleteReview.isPending}
                    onClick={() =>
                      slot.review && handleDeleteReview(slot.review.id, slot.cycleName)
                    }
                    className={`w-full rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors ${
                      hasReview
                        ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                        : "border-border bg-surface text-text-muted cursor-not-allowed opacity-50"
                    }`}
                  >
                    {hasReview
                      ? `Delete ${slot.cycleName} review`
                      : `${slot.cycleName} review not present`}
                  </button>
                );
              })}

              {deleteTarget.slots.filter((slot) => slot.review).length > 1 && (
                <button
                  type="button"
                  disabled={deleteReview.isPending}
                  onClick={handleDeleteAllReviews}
                  className="w-full rounded-lg bg-red-600 px-4 py-3 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                >
                  Delete all reviews
                </button>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {modalTarget && (
        <ProjectReviewDetailModal
          review={modalTarget.kind === "review" ? modalTarget.review : null}
          pendingContext={
            modalTarget.kind === "pending" ? modalTarget.context : undefined
          }
          onClose={() => setModalTarget(null)}
          projectRatingsVisible={true}
        />
      )}
    </div>
  );
}
