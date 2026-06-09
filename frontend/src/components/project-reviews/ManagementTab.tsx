/**
 * ManagementTab.tsx — Admin Per-Cycle Project Review Overview.
 *
 * Filters:
 *   Cycle  — generated from SystemSettings (active + N past cycles)
 *   Status — All | Completed | Pending
 *
 * One collapsible card per project; each card expands to a member table
 * showing review status and performance score.
 */

import { useState, useEffect } from "react";
import {
  BarChart2, Briefcase, CheckCircle2, Clock,
  AlertCircle, ChevronDown, Users, User,
} from "lucide-react";
import {
  type AdminMemberReviewRow,
  type AdminProjectSummary,
} from "../../services/project-review.service";
import { useManagementView } from "../../queries/projectReviews";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { getErrorMessage } from "../../utils/errors";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { extractFyToken } from "../../utils/fy";

// ── Types ────────────────────────────────────────────────────────────

type StatusFilter = "all" | "reviewed" | "pending";

// ── FY Option Generator ──────────────────────────────────────────────

/**
 * Build the Year dropdown options: the active fiscal year plus the prior
 * `count - 1` years, newest first.
 *
 * Project reviews are FY-scoped (one review per project per fiscal year),
 * so the filter lists fiscal years — not H1/H2/Q* windows — regardless of
 * the org's review cadence. Input is the bare FY token derived from
 * `active_cycle_name` ("FY26-27"); legacy bare "FY26" is tolerated too.
 */
export function generateFyOptions(activeFyToken: string, count = 6): string[] {
  // Spanning form: "FY26-27" → start year 26.
  const span = /^FY(\d{2})-(\d{2})$/i.exec(activeFyToken);
  if (span) {
    const start = parseInt(span[1], 10);
    const opts: string[] = [];
    for (let i = 0; i < count; i++) {
      const a = (start - i + 100) % 100;
      const b = (a + 1) % 100;
      opts.push(`FY${a.toString().padStart(2, "0")}-${(b).toString().padStart(2, "0")}`);
    }
    return opts;
  }
  // Legacy bare form: "FY26".
  const bare = /^FY(\d{2,4})$/i.exec(activeFyToken);
  if (bare) {
    let year = parseInt(bare[1], 10);
    const opts: string[] = [];
    for (let i = 0; i < count; i++) { opts.push(`FY${year}`); year--; }
    return opts;
  }
  // Unparseable — just offer the active token alone.
  return [activeFyToken];
}

// ── Status Badge ─────────────────────────────────────────────────────

function StatusBadge({ status }: { readonly status: AdminMemberReviewRow["review_status"] }) {
  if (status === "reviewed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-950/40 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-green-300">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Reviewed
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <Clock className="h-3 w-3" aria-hidden="true" /> Pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-text-muted">
      <AlertCircle className="h-3 w-3" aria-hidden="true" /> Not Started
    </span>
  );
}

// ── Project Card ─────────────────────────────────────────────────────

function ProjectCard({
  summary,
  statusFilter,
}: {
  readonly summary: AdminProjectSummary;
  readonly statusFilter: StatusFilter;
}) {
  const [expanded, setExpanded] = useState(false);

  const filteredMembers = summary.members.filter((m) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "reviewed") return m.review_status === "reviewed";
    return m.review_status !== "reviewed"; // pending + not_started
  });

  const pct =
    summary.total_members === 0
      ? 0
      : Math.round((summary.reviewed_count / summary.total_members) * 100);
  const allDone = summary.reviewed_count === summary.total_members && summary.total_members > 0;

  // When status filter hides all members, collapse the card silently
  if (filteredMembers.length === 0 && statusFilter !== "all") return null;

  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden transition-shadow hover:shadow-md">
      {/* ── Card Header (toggle) ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-surface-muted/50 transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Briefcase className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-text-main truncate">
                {summary.project_name}
              </span>
              <span className="shrink-0 text-[11px] font-mono bg-surface-hover px-1.5 py-0.5 rounded border border-border text-text-muted">
                {summary.project_code}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[11px] text-text-muted flex-wrap">
              {summary.pm_name && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" aria-hidden="true" />
                  PM: {summary.pm_name}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" aria-hidden="true" />
                {summary.total_members} member{summary.total_members !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {/* Progress bar */}
          <div className="hidden sm:flex flex-col items-end gap-1.5">
            <span
              className={`text-[12px] font-bold ${allDone ? "text-green-600 dark:text-green-300" : "text-text-muted"}`}
            >
              {summary.reviewed_count}/{summary.total_members} reviewed
            </span>
            <div className="w-28 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  allDone ? "bg-green-500" : "bg-brand"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <ChevronDown
            className={`h-4 w-4 text-text-muted transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </div>
      </button>

      {/* ── Member Table ── */}
      {expanded && (
        <div className="border-t border-border animate-in slide-in-from-top-1 fade-in duration-200">
          {filteredMembers.length === 0 ? (
            <p className="px-5 py-5 text-sm text-text-muted text-center">
              No members match the current filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-surface-muted/80 border-b border-border">
                    <th className="text-left px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                      Employee
                    </th>
                    <th className="hidden sm:table-cell text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                      Role / Dept
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                      Status
                    </th>
                    <th className="hidden md:table-cell text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                      Rating
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredMembers.map((m) => (
                    <tr
                      key={m.user_id}
                      className="hover:bg-surface-muted/40 transition-colors"
                    >
                      <td className="px-5 py-3 font-medium text-text-main">
                        {m.employee_name}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-text-muted">
                        {m.assignment_role ?? "—"}
                        {m.department_name && (
                          <span className="ml-1 text-[11px] text-text-muted/70">
                            ({m.department_name})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={m.review_status} />
                      </td>
                      <td className="hidden md:table-cell px-4 py-3 text-text-muted">
                        {m.performance_group ? (
                          <span className="font-semibold text-text-main">
                            {m.performance_group}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Skeleton Loader ──────────────────────────────────────────────────

function ManagementSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-surface-hover shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="h-4 w-1/3 rounded bg-surface-hover" />
              <div className="h-3 w-1/4 rounded bg-surface-hover" />
            </div>
            <div className="hidden sm:flex flex-col gap-1.5 items-end">
              <div className="h-3 w-24 rounded bg-surface-hover" />
              <div className="h-1.5 w-28 rounded-full bg-surface-hover" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Tab Component ───────────────────────────────────────────────

export function ManagementTab() {
  const { settings } = useSystemSettings();

  // FY token the filter operates on — reviews are FY-scoped, so we strip
  // the cadence prefix ("H1 FY26-27" → "FY26-27") here and everywhere a
  // default/clear value is derived below.
  const activeFy = settings?.active_cycle_name
    ? extractFyToken(settings.active_cycle_name)
    : "";
  const cycleOptions = activeFy ? generateFyOptions(activeFy) : [];

  const [selectedCycle, setSelectedCycle] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Initialise the selected FY from settings once available
  useEffect(() => {
    if (activeFy && !selectedCycle) {
      setSelectedCycle(activeFy);
    }
  }, [activeFy, selectedCycle]);

  // ['project-reviews', 'management', <cycle>] — shared TanStack cache.
  // Returns empty array while selectedCycle is "" so the initial render
  // before settings load is harmless.
  const {
    data = [],
    isLoading,
    error: queryError,
  } = useManagementView(selectedCycle || undefined);
  const error = queryError
    ? `Failed to load management data. Please try again. (${getErrorMessage(queryError)})`
    : "";

  // ── Summary stats (computed) ──
  const totalProjects = data.length;
  const totalMembers = data.reduce((s, p) => s + p.total_members, 0);
  const totalReviewed = data.reduce((s, p) => s + p.reviewed_count, 0);
  const overallPct =
    totalMembers === 0 ? 0 : Math.round((totalReviewed / totalMembers) * 100);

  const SELECT_CLS =
    "rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[130px] cursor-pointer";

  // The "cleared" cycle value is the active-FY default the useEffect
  // seeds (or "" before settings load) — NOT "all".
  const cycleDefault = activeFy;
  const hasActiveFilters =
    statusFilter !== "all" || selectedCycle !== cycleDefault;
  const clearFilters = () => {
    setStatusFilter("all");
    setSelectedCycle(cycleDefault);
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">

      {/* ── Filters Row + Summary stats ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Year
            </label>
            <select
              value={selectedCycle}
              onChange={(e) => setSelectedCycle(e.target.value)}
              className={SELECT_CLS}
              disabled={cycleOptions.length === 0}
            >
              {cycleOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className={SELECT_CLS}
            >
              <option value="all">All Statuses</option>
              <option value="reviewed">Completed</option>
              <option value="pending">Pending / Not Started</option>
            </select>
          </div>

          <ClearFiltersButton active={hasActiveFilters} onClear={clearFilters} />
        </div>

        {/* Right-aligned summary chips — only when data is loaded. */}
        {!isLoading && !error && data.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            {[
              { label: "Projects", value: totalProjects, color: "text-text-main" },
              { label: "Total Members", value: totalMembers, color: "text-text-main" },
              { label: "Reviewed", value: totalReviewed, color: "text-green-600 dark:text-green-300" },
              {
                label: "Completion",
                value: `${overallPct}%`,
                color: overallPct === 100 ? "text-green-600 dark:text-green-300" : "text-brand",
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 flex items-center gap-1.5 shadow-sm"
              >
                <span className="text-[11px] text-text-muted">{label}</span>
                <span className={`font-semibold text-[12px] ${color}`}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <ManagementSkeleton />
      ) : error ? (
        <div className="rounded-xl border-2 border-dashed border-red-200 dark:border-red-800 py-12 text-center text-sm text-red-600 dark:text-red-300 bg-red-50/30 dark:bg-red-950/30">
          {error}
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
          <BarChart2 className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
          <p className="font-display text-base font-medium text-text-main">
            No project reviews found
          </p>
          <p className="mt-1 text-sm text-text-muted">
            No projects with assigned members for {selectedCycle || "this cycle"}.
          </p>
        </div>
      ) : (
        <>
          {/* Project cards */}
          <div className="flex flex-col gap-4">
            {data.map((summary) => (
              <ProjectCard
                key={summary.project_id}
                summary={summary}
                statusFilter={statusFilter}
              />
            ))}
          </div>

          {/* Empty state when filter eliminates all members */}
          {data.every(
            (s) =>
              s.members.filter((m) => {
                if (statusFilter === "all") return true;
                if (statusFilter === "reviewed") return m.review_status === "reviewed";
                return m.review_status !== "reviewed";
              }).length === 0,
          ) && statusFilter !== "all" && (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
              <CheckCircle2 className="h-8 w-8 text-green-500 dark:text-green-400 mb-2" aria-hidden="true" />
              <p className="font-display text-sm font-medium text-text-main">
                {statusFilter === "reviewed"
                  ? "No completed reviews yet for this cycle."
                  : "All reviews are completed for this cycle!"}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
