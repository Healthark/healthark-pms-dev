/**
 * ProjectReviews.tsx — Project Reviews Page (Revised PM-Centric Flow).
 *
 * Tabs (role-dependent):
 *   My Reviews     — the employee's own reviews as an expandable table
 *                    (rows expand into `TableExpandedRow` for the detail).
 *   Evaluate Team  — gated on having any pending PM/Secondary work;
 *                    delegates entirely to `PMEvaluationTab`.
 *   All Reviews    — Admin-only, read-only org-wide view (`AllReviewsTab`).
 *
 * The bulk of presentation logic lives in the extracted components in
 * `components/project-reviews/`. This file owns the page-level state,
 * data load, derived filters/sort, and the conditional render that
 * picks between Skeleton / Empty / Table.
 */

import { useState, useMemo, Fragment } from "react";
import {
  Briefcase,
  CheckCircle2,
  Clock,
  Search,
  ChevronDown,
} from "lucide-react";
import {
  type MyProjectCard,
  type RoleExpectation,
} from "../services/project-review.service";
import {
  useMyProjectReviews,
  useRoleExpectations,
  usePMQueue,
  useSecondaryQueue,
  useReportsToQueue,
} from "../queries/projectReviews";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { useAuth } from "../hooks/useAuth";
import { PMEvaluationTab } from "../components/project-reviews/PMEvaluationTab";
import { AllReviewsTab } from "../components/project-reviews/AllReviewsTab";
import { TableExpandedRow } from "../components/project-reviews/TableExpandedRow";
import { MyReviewsToolbar } from "../components/project-reviews/MyReviewsToolbar";
import { MyReviewRatingCell } from "../components/project-reviews/MyReviewRatingCell";
import { TableSkeleton } from "../components/project-reviews/MyReviewsSkeletons";
import { SortableHeader } from "../components/SortableHeader";
import { compareValues, type SortKind, type SortState } from "../utils/sort";
import { ExportExcelButton } from "../components/exports/ExportExcelButton";
import { exportService } from "../services/export.service";
import { extractFyToken } from "../utils/fy";
import { buildProjectCodeIndex } from "../utils/projectCodeIndex";

type ActiveTab = "my" | "evaluate" | "all-reviews";

// Sortable columns in the My Reviews table + their value extractors and type.
// Project/PM are plain alphabetical; project_code and cycle are alphanumeric
// (so "PRJ-9" sorts before "PRJ-10", "H1 FY25" before "H2 FY25"); rating is
// a numeric 1–5 string from the backend so gets numeric compare.
type MyReviewsSortKey =
  | "project_name"
  | "project_code"
  | "department_name"
  | "pm_name"
  | "cycle"
  | "review_status"
  | "performance_group";

const MY_REVIEWS_SORT_CONFIG: Record<
  MyReviewsSortKey,
  { kind: SortKind; get: (c: MyProjectCard) => unknown }
> = {
  project_name:      { kind: "alpha",   get: (c) => c.project_name },
  project_code:      { kind: "natural", get: (c) => c.project_code },
  department_name:   { kind: "alpha",   get: (c) => c.department_name },
  pm_name:           { kind: "alpha",   get: (c) => c.pm_name },
  cycle:             { kind: "cycle",   get: (c) => c.cycle },
  review_status:     { kind: "alpha",   get: (c) => c.review_status },
  performance_group: { kind: "numeric", get: (c) => c.performance_group },
};

const cardKey = (c: MyProjectCard) => `${c.project_id}-${c.cycle}`;

export function ProjectReviews() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const projectRatingsVisible = settings?.project_ratings_visible ?? false;
  // Admins get a read-only, org-wide "All Reviews" tab (backed by
  // getAllReviews). Backend re-checks the role — this is a UI affordance.
  const isAdmin = user?.role === "Admin";

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");
  // My Reviews defaults to "All Cycles" — the employee usually wants to see
  // every cycle, and a stable literal (vs lazy-seeding from settings, which
  // may not be loaded at mount) avoids a false "active filter" state.
  const [selectedCycle, setSelectedCycle] = useState<string>("all");
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [pmFilter, setPmFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [sort, setSort] = useState<SortState<MyReviewsSortKey> | null>(null);

  // Shared TanStack caches (each fires 1× per cold load + dedups w/ PMEvaluationTab).
  const { data: cards = [], isLoading: cardsLoading } = useMyProjectReviews();
  const { data: expectations = [], isLoading: expectationsLoading } = useRoleExpectations();
  // PM + Secondary queues only used to gate the "Evaluate" tab visibility.
  // Tolerate errors silently — non-PM users 403 on /pm-queue.
  const { data: pmQueue = [] } = usePMQueue();
  const { data: secQueue = [] } = useSecondaryQueue();
  const { data: reportsToQueue = [] } = useReportsToQueue();
  const isLoading = cardsLoading || expectationsLoading;
  const showEvaluateTab =
    pmQueue.length > 0 || secQueue.length > 0 || reportsToQueue.length > 0;

  // ── Derived filter sources + filtered/sorted cards (memoised) ──────

  const availableCycles = useMemo(
    () =>
      Array.from(
        new Set(cards.map((c) => c.cycle).filter(Boolean) as string[]),
      ),
    [cards],
  );
  const availablePMs = useMemo(
    () =>
      Array.from(
        new Set(cards.map((c) => c.pm_name).filter(Boolean) as string[]),
      ),
    [cards],
  );
  const availableProjects = useMemo(
    () => Array.from(new Set(cards.map((c) => c.project_name))).sort(),
    [cards],
  );
  // Project Code filter — a synced view onto the name-keyed projectFilter.
  const projectIndex = useMemo(() => buildProjectCodeIndex(cards), [cards]);
  const projectCodeFilter =
    projectFilter !== "all"
      ? projectIndex.nameToCode.get(projectFilter) ?? ""
      : "";
  const onProjectCodeFilterChange = (code: string) =>
    setProjectFilter(code ? projectIndex.codeToName.get(code) ?? "all" : "all");

  const filteredCards = useMemo(() => {
    return cards.filter((c) => {
      if (selectedCycle && selectedCycle !== "all" && c.cycle !== selectedCycle)
        return false;
      if (pmFilter !== "all" && c.pm_name !== pmFilter) return false;
      if (statusFilter !== "all" && c.review_status !== statusFilter)
        return false;
      if (projectFilter !== "all" && c.project_name !== projectFilter)
        return false;
      return true;
    });
  }, [cards, selectedCycle, pmFilter, statusFilter, projectFilter]);

  const sortedCards = useMemo(() => {
    if (!sort) return filteredCards;
    return filteredCards.slice().sort((a, b) => {
      const { kind, get } = MY_REVIEWS_SORT_CONFIG[sort.key];
      return compareValues(get(a), get(b), kind, sort.direction);
    });
  }, [filteredCards, sort]);

  // "All Cycles" is the default, so Clear returns the filter to it and the
  // Clear button only lights up once the user picks a specific cycle.
  const cycleDefault = "all";
  const hasActiveFilters =
    pmFilter !== "all" ||
    statusFilter !== "all" ||
    projectFilter !== "all" ||
    selectedCycle !== cycleDefault;
  const clearFilters = () => {
    setPmFilter("all");
    setStatusFilter("all");
    setProjectFilter("all");
    setSelectedCycle(cycleDefault);
  };

  // The expanded row's validity is a function of the current filtered set —
  // derive instead of clearing via effect when filters change.
  const expandedRowVisible =
    expandedRowKey !== null &&
    sortedCards.some((c) => cardKey(c) === expandedRowKey);

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // Header text follows the active tab so the page title reflects what
  // the user is doing — their own reviews vs evaluating their team.
  const headerTitle =
    activeTab === "evaluate"
      ? "Evaluate Team"
      : activeTab === "all-reviews"
        ? "All Project Reviews"
        : "Project Reviews";
  const headerSubtitle =
    activeTab === "evaluate"
      ? "Provide project feedback for your team members."
      : activeTab === "all-reviews"
        ? "Org-wide, read-only view of every project review this cycle."
        : "Track your project-specific performance feedback across cycles.";

  return (
    <div className="flex flex-col gap-6 pb-10 animate-in fade-in duration-500">
      {/* ── Page Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            {headerTitle}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">{headerSubtitle}</p>
        </div>
        {/* Org-wide export — admins only, and only on the All Reviews tab. */}
        {isAdmin && activeTab === "all-reviews" && (
          <ExportExcelButton
            label="Export Project Reviews"
            onDownload={() =>
              exportService.downloadProjectReviews(
                {
                  fy: settings?.active_cycle_name
                    ? extractFyToken(settings.active_cycle_name)
                    : undefined,
                },
                "inline",
              )
            }
          />
        )}
      </div>

      {/* ── Main Content Container ── */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex border-b border-border px-2">
          <button
            type="button"
            className={tabCls("my")}
            onClick={() => setActiveTab("my")}
          >
            My Reviews
          </button>
          {showEvaluateTab && (
            <button
              type="button"
              className={tabCls("evaluate")}
              onClick={() => setActiveTab("evaluate")}
            >
              Evaluate Team
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              className={tabCls("all-reviews")}
              onClick={() => setActiveTab("all-reviews")}
            >
              All Reviews
            </button>
          )}
        </div>

        <div className="p-5">
          {activeTab === "my" && (
            <div className="flex flex-col gap-5">
              {!isLoading && cards.length > 0 && (
                <MyReviewsToolbar
                  selectedCycle={selectedCycle}
                  onSelectedCycleChange={setSelectedCycle}
                  availableCycles={availableCycles}
                  projectFilter={projectFilter}
                  onProjectFilterChange={setProjectFilter}
                  availableProjects={availableProjects}
                  projectCodeFilter={projectCodeFilter}
                  onProjectCodeFilterChange={onProjectCodeFilterChange}
                  availableProjectCodes={projectIndex.codes}
                  pmFilter={pmFilter}
                  onPmFilterChange={setPmFilter}
                  availablePMs={availablePMs}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  hasActiveFilters={hasActiveFilters}
                  onClearFilters={clearFilters}
                />
              )}

              {renderMyReviewsBody({
                isLoading,
                cardsCount: cards.length,
                filteredCount: filteredCards.length,
                sortedCards,
                expandedRowKey: expandedRowVisible ? expandedRowKey : null,
                onToggleExpandedRow: (key) =>
                  setExpandedRowKey(expandedRowKey === key ? null : key),
                expectations,
                projectRatingsVisible,
                sort,
                onSort: setSort,
              })}
            </div>
          )}

          {activeTab === "evaluate" && showEvaluateTab && <PMEvaluationTab />}

          {activeTab === "all-reviews" && isAdmin && <AllReviewsTab />}
        </div>
      </div>
    </div>
  );
}

// ── Render helpers ─────────────────────────────────────────────────

function renderMyReviewsBody(args: {
  isLoading: boolean;
  cardsCount: number;
  filteredCount: number;
  sortedCards: MyProjectCard[];
  expandedRowKey: string | null;
  onToggleExpandedRow: (key: string) => void;
  expectations: RoleExpectation[];
  projectRatingsVisible: boolean;
  sort: SortState<MyReviewsSortKey> | null;
  onSort: (s: SortState<MyReviewsSortKey> | null) => void;
}) {
  const {
    isLoading,
    cardsCount,
    filteredCount,
    sortedCards,
    expandedRowKey,
    onToggleExpandedRow,
    expectations,
    projectRatingsVisible,
    sort,
    onSort,
  } = args;

  if (isLoading) {
    return <TableSkeleton />;
  }
  if (cardsCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <Briefcase
          className="h-10 w-10 text-text-muted mb-3"
          aria-hidden="true"
        />
        <p className="font-display text-base font-medium text-text-main">
          No projects assigned
        </p>
        <p className="mt-1 text-sm text-text-muted">
          You'll see your project evaluations here once HR assigns them.
        </p>
      </div>
    );
  }
  if (filteredCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
        <Search className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
        <p className="font-display text-sm font-medium text-text-main">
          No matching reviews
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Try adjusting your filters.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-surface-muted/80 border-b border-border">
            <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-text-muted">#</th>
            <th className="text-left px-5 py-2.5">
              <SortableHeader
                label="Project"
                columnKey="project_name"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="text-left px-4 py-2.5">
              <SortableHeader
                label="Code"
                columnKey="project_code"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="text-left px-4 py-2.5">
              <SortableHeader
                label="Department"
                columnKey="department_name"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="hidden sm:table-cell text-left px-4 py-2.5">
              <SortableHeader
                label="PM"
                columnKey="pm_name"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="text-left px-4 py-2.5">
              <SortableHeader
                label="Cycle"
                columnKey="cycle"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="text-left px-4 py-2.5">
              <SortableHeader
                label="Status"
                columnKey="review_status"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="text-left px-4 py-2.5">
              <SortableHeader
                label="Rating"
                columnKey="performance_group"
                sort={sort}
                onSort={onSort}
              />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {sortedCards.map((card, i) => {
            const key = cardKey(card);
            const isExpanded = expandedRowKey === key;
            const isReviewed = card.review_status === "reviewed";

            return (
              <Fragment key={key}>
                <tr
                  className={`transition-colors cursor-pointer ${
                    isExpanded ? "bg-brand/5" : "hover:bg-surface-muted/60"
                  }`}
                  onClick={() => onToggleExpandedRow(key)}
                >
                  <td className="px-3 py-3 text-center text-text-muted tabular-nums text-xs">
                    {(i + 1).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 font-medium text-text-main">
                    <div className="flex items-center gap-2">
                      <ChevronDown
                        className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                      {card.project_name}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-text-muted text-[12px]">
                    {card.project_code}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {card.department_name ?? "—"}
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-text-muted">
                    {card.pm_name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[12px] font-semibold text-text-muted bg-surface-hover px-1.5 py-0.5 rounded">
                      {card.cycle ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isReviewed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-950/40 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700 dark:text-green-300">
                        <CheckCircle2 className="h-3 w-3" /> Reviewed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700 dark:text-amber-300">
                        <Clock className="h-3 w-3" /> Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <MyReviewRatingCell
                      card={card}
                      projectRatingsVisible={projectRatingsVisible}
                    />
                  </td>
                </tr>
                {isExpanded && (
                  <TableExpandedRow card={card} expectations={expectations} />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
