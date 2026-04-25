/**
 * TeamReviewTab — mentor view for submitting/viewing half-year reviews on
 * approved mentee goals that have at least one self-review submitted.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Users,
  UserCircle,
  CheckCircle2,
  Circle,
  PenLine,
  LayoutGrid,
  Table2,
} from "lucide-react";
import {
  goalService,
  type TeamGoal,
  type SelfReviewCycleHalf,
  type GoalMentorReviewPayload,
} from "../../services/goal.service";
import { getErrorMessage } from "../../utils/errors";
import { GoalMentorReviewModal } from "./GoalMentorReviewModal";
import { SortableHeader } from "../SortableHeader";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";

// ── Types & sort config ───────────────────────────────────────────────

type ViewMode = "grid" | "table";
type TeamReviewSortKey = "title" | "owner_name" | "fy_year" | "h1_status" | "h2_status";

function halfSortValue(goal: TeamGoal, half: SelfReviewCycleHalf): number {
  const hasSelf = goal.self_reviews.some((sr) => sr.cycle_half === half);
  const hasMentor = goal.mentor_reviews.some((mr) => mr.cycle_half === half);
  if (!hasSelf) return 0;   // not submitted by mentee
  if (!hasMentor) return 1; // pending mentor review
  return 2;                 // reviewed
}

const SORT_CONFIG: Record<
  TeamReviewSortKey,
  { kind: SortKind; get: (g: TeamGoal) => unknown }
> = {
  title:      { kind: "alpha",   get: (g) => g.title },
  owner_name: { kind: "alpha",   get: (g) => g.owner_name },
  fy_year:    { kind: "numeric", get: (g) => g.fy_year },
  h1_status:  { kind: "numeric", get: (g) => halfSortValue(g, "H1") },
  h2_status:  { kind: "numeric", get: (g) => halfSortValue(g, "H2") },
};

// ── Half-status cell (shared between card and table) ─────────────────

function HalfStatusCell({
  goal,
  half,
  onReview,
}: {
  goal: TeamGoal;
  half: SelfReviewCycleHalf;
  onReview: (goal: TeamGoal, half: SelfReviewCycleHalf) => void;
}) {
  const selfReview = goal.self_reviews.find((sr) => sr.cycle_half === half);
  const mentorReview = goal.mentor_reviews.find((mr) => mr.cycle_half === half);

  if (!selfReview) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-text-muted">
        <Circle className="h-3 w-3 shrink-0" /> Not submitted
      </span>
    );
  }

  if (mentorReview) {
    return (
      <button
        type="button"
        onClick={() => onReview(goal, half)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 transition-colors"
      >
        <CheckCircle2 className="h-3 w-3 shrink-0" /> Reviewed
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onReview(goal, half)}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-brand bg-brand/10 hover:bg-brand hover:text-white transition-colors"
    >
      <PenLine className="h-3 w-3 shrink-0" /> Review
    </button>
  );
}

// ── Card ─────────────────────────────────────────────────────────────

const HALVES: SelfReviewCycleHalf[] = ["H1", "H2"];

function ReviewGoalCard({
  goal,
  onReview,
}: {
  goal: TeamGoal;
  onReview: (goal: TeamGoal, half: SelfReviewCycleHalf) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm flex flex-col gap-3">
      {/* Employee name + FY year */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
          <UserCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {goal.owner_name}
        </div>
        {goal.fy_year && (
          <span className="text-[11px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
            FY {goal.fy_year}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="font-medium text-text-main leading-snug line-clamp-2">
        {goal.title}
      </p>

      {/* H1 / H2 review status */}
      <div className="flex flex-col gap-2 pt-2 border-t border-border">
        {HALVES.map((h) => (
          <div key={h} className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              {h} Review
            </span>
            <HalfStatusCell goal={goal} half={h} onReview={onReview} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────

function Skeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 animate-pulse">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="h-44 rounded-lg border border-border bg-surface p-4"
          >
            <div className="h-3 w-1/3 rounded bg-slate-100 mb-3" />
            <div className="h-3 w-3/4 rounded bg-slate-100 mb-3" />
            <div className="h-2.5 w-full rounded bg-slate-100" />
            <div className="h-2.5 w-2/3 rounded bg-slate-100 mt-1.5" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3].map((n) => (
        <div key={n} className="h-12 rounded-lg border border-border bg-surface" />
      ))}
    </div>
  );
}

// ── Tab Component ─────────────────────────────────────────────────────

export function TeamReviewTab() {
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [sort, setSort] = useState<SortState<TeamReviewSortKey> | null>(null);

  // Mentor review modal state
  const [reviewGoal, setReviewGoal] = useState<TeamGoal | null>(null);
  const [reviewCycle, setReviewCycle] = useState<SelfReviewCycleHalf | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const openReview = (goal: TeamGoal, half: SelfReviewCycleHalf) => {
    setReviewError("");
    setReviewGoal(goal);
    setReviewCycle(half);
  };
  const closeReview = () => {
    setReviewGoal(null);
    setReviewCycle(null);
    setReviewError("");
  };

  const handleSubmitReview = async (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ) => {
    if (!reviewGoal) return;
    setIsSaving(true);
    setReviewError("");
    try {
      const updated = await goalService.submitMentorReview(
        reviewGoal.id,
        cycleHalf,
        payload,
      );
      setGoals((prev) =>
        prev.map((g) => (g.id === updated.id ? { ...g, ...updated } : g)),
      );
      closeReview();
    } catch (err) {
      setReviewError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const loadGoals = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await goalService.getTeamGoals("annual");
      setGoals(
        data.filter(
          (g) =>
            g.approval_status === "approved" && g.self_reviews.length > 0,
        ),
      );
    } catch {
      // Stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  const availableYears = Array.from(
    new Set(goals.map((g) => g.fy_year).filter((y): y is number => y !== null)),
  ).sort((a, b) => b - a);

  const filtered = goals
    .filter((g) => yearFilter === "all" || g.fy_year === Number(yearFilter))
    .filter((g) => {
      const q = searchQuery.trim().toLowerCase();
      if (q === "") return true;
      return (
        g.title.toLowerCase().includes(q) ||
        g.owner_name.toLowerCase().includes(q)
      );
    });

  const sortedGoals = sort
    ? filtered.slice().sort((a, b) => {
        const { kind, get } = SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filtered;

  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      viewMode === mode
        ? "bg-brand/10 text-brand"
        : "text-text-muted hover:bg-slate-100"
    }`;

  if (isLoading) return <Skeleton viewMode={viewMode} />;

  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
        <Users className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">
          No self-reviews to review
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Your mentees haven't submitted any self-reviews yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        {/* Row 1: Search + View Toggle */}
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search by goal or mentee..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-0.5">
            <button
              type="button"
              className={viewBtnCls("grid")}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Cards
            </button>
            <button
              type="button"
              className={viewBtnCls("table")}
              onClick={() => setViewMode("table")}
            >
              <Table2 className="h-3.5 w-3.5" /> Table
            </button>
          </div>
        </div>

        {/* Row 2: Filters */}
        {availableYears.length > 0 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="review-year-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Year
            </label>
            <select
              id="review-year-filter"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
            >
              <option value="all">All Years</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  FY {y}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <Search className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
          <p className="font-display text-sm font-medium text-text-main">
            No results match this filter
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Try adjusting your search or filter options.
          </p>
        </div>
      ) : viewMode === "grid" ? (
        /* ── Card / Grid View ── */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sortedGoals.map((goal) => (
            <ReviewGoalCard key={goal.id} goal={goal} onReview={openReview} />
          ))}
        </div>
      ) : (
        /* ── Table View ── */
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader label="Goal" columnKey="title" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Mentee" columnKey="owner_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Year" columnKey="fy_year" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="H1 Review" columnKey="h1_status" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="H2 Review" columnKey="h2_status" sort={sort} onSort={setSort} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sortedGoals.map((goal) => (
                <tr key={goal.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3 font-medium text-text-main max-w-xs">
                    <span className="line-clamp-1">{goal.title}</span>
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    <div className="flex items-center gap-1.5">
                      <UserCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{goal.owner_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {goal.fy_year ? (
                      <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                        FY {goal.fy_year}
                      </span>
                    ) : (
                      <span className="text-[12px] text-text-muted">—</span>
                    )}
                  </td>
                  {HALVES.map((h) => (
                    <td key={h} className="px-4 py-3">
                      <HalfStatusCell goal={goal} half={h} onReview={openReview} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GoalMentorReviewModal
        isOpen={reviewGoal !== null && reviewCycle !== null}
        goal={reviewGoal}
        cycleHalf={reviewCycle}
        onClose={closeReview}
        onSubmit={handleSubmitReview}
        isSaving={isSaving}
        error={reviewError}
      />
    </div>
  );
}
