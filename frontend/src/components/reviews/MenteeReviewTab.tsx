import { useState, useEffect, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  Search, LayoutGrid, Table2, UserCircle, Users, X,
  ChevronDown, Eye,
} from "lucide-react";
import {
  annualReviewService,
  type MenteeAnnualReview,
} from "../../services/annual-review.service";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { StarRating } from "./StarRating";
import { SortableHeader } from "../SortableHeader";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";

type ViewMode = "grid" | "table";
type SortKey = "employee_name" | "cycle_name" | "status";

const SORT_CONFIG: Record<
  SortKey,
  { kind: SortKind; get: (r: MenteeAnnualReview) => unknown }
> = {
  employee_name: { kind: "alpha", get: (r) => r.employee_name },
  cycle_name:    { kind: "alpha", get: (r) => r.cycle_name },
  status:        { kind: "alpha", get: (r) => r.status },
};

const COMPETENCIES = [
  { key: "ownership", label: "Ownership" },
  { key: "productivity", label: "Productivity" },
  { key: "communication", label: "Communication" },
  { key: "leadership", label: "Leadership" },
  { key: "adaptability", label: "Adaptability" },
  { key: "time_management", label: "Time Management" },
] as const;

function extractFy(cycleName: string): string {
  return cycleName.split(" ").find((t) => t.startsWith("FY")) ?? cycleName;
}

// ── Read-only detail modal ──────────────────────────────────────────

function ReadOnlyReviewModal({
  review,
  onClose,
}: {
  readonly review: MenteeAnnualReview;
  readonly onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 className="font-display text-base font-semibold text-text-main">
              {review.employee_name}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Self-Appraisal · Cycle {review.cycle_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="flex items-center gap-3 flex-wrap">
            <ReviewStatusBadge status={review.status} />
            {review.department && (
              <span className="text-xs text-text-muted">
                {review.department}
                {review.designation && ` · ${review.designation}`}
              </span>
            )}
          </div>

          {review.self_stars && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-muted">
                Self-Rating:
              </span>
              <StarRating value={review.self_stars} readonly />
            </div>
          )}

          {COMPETENCIES.map((comp, idx) => {
            const selfKey = `self_desc_${comp.key}` as keyof MenteeAnnualReview;
            const selfValue = (review[selfKey] as string | null) || "—";

            return (
              <div
                key={comp.key}
                className="rounded-lg border border-border p-4 space-y-1.5"
              >
                <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                  {idx + 1}. {comp.label}
                </p>
                <p className="text-sm text-text-main whitespace-pre-wrap">
                  {selfValue}
                </p>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Card ────────────────────────────────────────────────────────────

function MenteeSelfReviewCard({
  review,
  onView,
}: {
  readonly review: MenteeAnnualReview;
  readonly onView: (r: MenteeAnnualReview) => void;
}) {
  const hasSubmitted = review.status !== "draft";

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <UserCircle className="h-5 w-5 text-text-muted shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-text-main truncate">
              {review.employee_name}
            </p>
            {review.designation && (
              <p className="text-[11px] text-text-muted truncate">
                {review.designation}
              </p>
            )}
          </div>
        </div>
        <span className="text-[11px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
          {extractFy(review.cycle_name)}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <ReviewStatusBadge status={review.status} />
      </div>

      {hasSubmitted && review.self_stars ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Self-Rating:</span>
          <StarRating value={review.self_stars} readonly />
        </div>
      ) : (
        <p className="text-xs italic text-text-muted">
          Self-appraisal not submitted yet.
        </p>
      )}

      <button
        type="button"
        onClick={() => onView(review)}
        disabled={!hasSubmitted}
        className="mt-auto flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
        View Self-Appraisal
      </button>
    </div>
  );
}

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
          : "Your mentees haven't submitted their self-appraisals yet."}
      </p>
    </div>
  );
}

// ── Main tab ────────────────────────────────────────────────────────

export function MenteeReviewTab() {
  const [reviews, setReviews] = useState<MenteeAnnualReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);
  const [viewTarget, setViewTarget] = useState<MenteeAnnualReview | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setReviews(await annualReviewService.getMenteeReviews());
    } catch {
      /* stays empty */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const availableYears = Array.from(
    new Set(reviews.map((r) => extractFy(r.cycle_name))),
  ).sort((a, b) => b.localeCompare(a));

  const filtered = reviews
    .filter((r) => yearFilter === "all" || extractFy(r.cycle_name) === yearFilter)
    .filter((r) =>
      searchQuery.trim() === "" ||
      r.employee_name.toLowerCase().includes(searchQuery.toLowerCase()),
    );

  const sorted = sort
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">
        Loading mentee reviews…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {reviews.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search mentees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-0.5">
              <button type="button" className={viewBtnCls("grid")} onClick={() => setViewMode("grid")}>
                <LayoutGrid className="h-3.5 w-3.5" /> Cards
              </button>
              <button type="button" className={viewBtnCls("table")} onClick={() => setViewMode("table")}>
                <Table2 className="h-3.5 w-3.5" /> Table
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label htmlFor="mentee-review-year-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Year</label>
              <select
                id="mentee-review-year-filter"
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
              >
                <option value="all">All Years</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {reviews.length === 0 ? (
        <EmptyState hasFilter={false} />
      ) : filtered.length === 0 ? (
        <EmptyState hasFilter={true} />
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((r) => (
            <MenteeSelfReviewCard
              key={r.id}
              review={r}
              onView={setViewTarget}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader label="Mentee" columnKey="employee_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Cycle" columnKey="cycle_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Status" columnKey="status" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Self-Rating</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sorted.map((r) => {
                const isExpanded = expandedId === r.id;
                const hasSubmitted = r.status !== "draft";

                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`transition-colors cursor-pointer ${isExpanded ? "bg-brand/5" : "hover:bg-slate-50/60"}`}
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    >
                      <td className="px-5 py-3 font-medium text-text-main">
                        <div className="flex items-center gap-2">
                          <ChevronDown className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                          <div className="flex items-center gap-1.5 min-w-0">
                            <UserCircle className="h-3.5 w-3.5 text-text-muted shrink-0" />
                            <span className="truncate">{r.employee_name}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                          {r.cycle_name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ReviewStatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3">
                        {r.self_stars ? (
                          <StarRating value={r.self_stars} readonly />
                        ) : (
                          <span className="text-[12px] text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={!hasSubmitted}
                          onClick={() => setViewTarget(r)}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-brand/5">
                        <td colSpan={5} className="px-10 py-4">
                          <div className="space-y-2 max-w-2xl">
                            {r.department && (
                              <p className="text-xs text-text-muted">
                                {r.department}
                                {r.designation && ` · ${r.designation}`}
                              </p>
                            )}
                            {hasSubmitted ? (
                              <p className="text-sm text-text-main">
                                Click <span className="font-medium">View</span> to
                                see {r.employee_name.split(" ")[0]}'s full self-appraisal
                                across all 6 competencies.
                              </p>
                            ) : (
                              <p className="text-sm italic text-text-muted">
                                Self-appraisal not submitted yet.
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewTarget && (
        <ReadOnlyReviewModal
          review={viewTarget}
          onClose={() => setViewTarget(null)}
        />
      )}
    </div>
  );
}
