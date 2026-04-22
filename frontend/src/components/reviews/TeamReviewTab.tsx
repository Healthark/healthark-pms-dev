import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Search, LayoutGrid, Table2, UserCircle, Users, X,
  Send, Loader2, ClipboardCheck, CheckCircle2,
} from "lucide-react";
import {
  annualReviewService,
  type MenteeAnnualReview,
  type MentorEvalPayload,
} from "../../services/annual-review.service";
import { getErrorMessage } from "../../utils/errors";
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

type CompetencyKey = (typeof COMPETENCIES)[number]["key"];

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

function extractFy(cycleName: string): string {
  return cycleName.split(" ").find((t) => t.startsWith("FY")) ?? cycleName;
}

// ── Evaluation modal (mentor fills out the evaluation) ─────────────

function EvalModal({
  review,
  onSubmit,
  onClose,
  isSaving,
  error,
}: {
  readonly review: MenteeAnnualReview;
  readonly onSubmit: (reviewId: number, payload: MentorEvalPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}) {
  const [comments, setComments] = useState<Record<CompetencyKey, string>>({
    ownership: "",
    productivity: "",
    communication: "",
    leadership: "",
    adaptability: "",
    time_management: "",
  });
  const [mentorStars, setMentorStars] = useState(0);

  const setField = (key: CompetencyKey, value: string) => {
    setComments((prev) => ({ ...prev, [key]: value }));
  };

  const allFilled =
    COMPETENCIES.every((c) => comments[c.key].trim().length > 0) &&
    mentorStars >= 1;

  const handleSubmit = async () => {
    await onSubmit(review.id, {
      mentor_comment_ownership: comments.ownership,
      mentor_comment_productivity: comments.productivity,
      mentor_comment_communication: comments.communication,
      mentor_comment_leadership: comments.leadership,
      mentor_comment_adaptability: comments.adaptability,
      mentor_comment_time_management: comments.time_management,
      mentor_stars: mentorStars,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 className="font-display text-base font-semibold text-text-main">
              Evaluate · {review.employee_name}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Review the self-appraisal and provide your feedback for each competency.
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

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
          )}

          {review.self_stars && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-muted">
                Employee Self-Rating:
              </span>
              <StarRating value={review.self_stars} readonly />
            </div>
          )}

          {COMPETENCIES.map((comp, idx) => {
            const selfKey = `self_desc_${comp.key}` as keyof MenteeAnnualReview;
            const selfValue = (review[selfKey] as string | null) || "—";

            return (
              <div key={comp.key} className="rounded-lg border border-border overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-border">
                  <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                    {idx + 1}. {comp.label}
                  </p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
                  <div className="p-4">
                    <p className="text-xs font-medium text-text-muted mb-1">
                      Employee's Self-Assessment
                    </p>
                    <p className="text-sm text-text-main whitespace-pre-wrap">{selfValue}</p>
                  </div>
                  <div className="p-4">
                    <label
                      htmlFor={`mentor-${comp.key}`}
                      className="block text-xs font-medium text-brand mb-1"
                    >
                      Your Feedback *
                    </label>
                    <textarea
                      id={`mentor-${comp.key}`}
                      rows={4}
                      className={TEXTAREA_CLS}
                      value={comments[comp.key]}
                      onChange={(e) => setField(comp.key, e.target.value)}
                      placeholder={`Your evaluation of this employee's ${comp.label.toLowerCase()}...`}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <div className="space-y-2">
            <p className="text-xs font-semibold text-text-main">Your Overall Rating *</p>
            <StarRating value={mentorStars} onChange={setMentorStars} />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !allFilled}
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSaving ? "Submitting…" : "Submit Evaluation"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Card ────────────────────────────────────────────────────────────

function TeamReviewCard({
  review,
  onEvaluate,
}: {
  readonly review: MenteeAnnualReview;
  readonly onEvaluate: (r: MenteeAnnualReview) => void;
}) {
  const canEvaluate = review.status === "pending_mentor";
  const evaluated = review.status === "pending_management" || review.status === "completed";

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <UserCircle className="h-5 w-5 text-text-muted shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-text-main truncate">{review.employee_name}</p>
            {review.designation && (
              <p className="text-[11px] text-text-muted truncate">{review.designation}</p>
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

      {review.self_stars && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Self:</span>
          <StarRating value={review.self_stars} readonly />
        </div>
      )}

      {review.mentor_stars && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Yours:</span>
          <StarRating value={review.mentor_stars} readonly />
        </div>
      )}

      {canEvaluate ? (
        <button
          type="button"
          onClick={() => onEvaluate(review)}
          className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          Evaluate
        </button>
      ) : evaluated ? (
        <div className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-green-50 border border-green-100 px-4 py-2 text-sm font-medium text-green-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Evaluation Submitted
        </div>
      ) : (
        <div className="mt-auto flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm italic text-text-muted">
          Awaiting self-appraisal
        </div>
      )}
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

export function TeamReviewTab() {
  const [reviews, setReviews] = useState<MenteeAnnualReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);
  const [evalTarget, setEvalTarget] = useState<MenteeAnnualReview | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

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

  const handleSubmitEval = async (reviewId: number, payload: MentorEvalPayload) => {
    setIsSaving(true);
    setModalError("");
    try {
      const updated = await annualReviewService.submitMentorEval(reviewId, payload);
      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? { ...r, ...updated, employee_name: r.employee_name, employee_email: r.employee_email, department: r.department, designation: r.designation }
            : r,
        ),
      );
      setEvalTarget(null);
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

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
        Loading team reviews…
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
              <label htmlFor="team-review-year-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Year</label>
              <select
                id="team-review-year-filter"
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
            <TeamReviewCard key={r.id} review={r} onEvaluate={setEvalTarget} />
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
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Your Rating</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sorted.map((r) => {
                const canEvaluate = r.status === "pending_mentor";
                const evaluated = r.status === "pending_management" || r.status === "completed";

                return (
                  <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3 font-medium text-text-main">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <UserCircle className="h-3.5 w-3.5 text-text-muted shrink-0" />
                        <span className="truncate">{r.employee_name}</span>
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
                    <td className="px-4 py-3">
                      {r.mentor_stars ? (
                        <StarRating value={r.mentor_stars} readonly />
                      ) : (
                        <span className="text-[12px] text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canEvaluate ? (
                        <button
                          type="button"
                          onClick={() => setEvalTarget(r)}
                          className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand hover:text-white transition-colors"
                        >
                          <ClipboardCheck className="h-3 w-3" /> Evaluate
                        </button>
                      ) : evaluated ? (
                        <span className="flex items-center gap-1 text-[11px] text-green-700">
                          <CheckCircle2 className="h-3 w-3" /> Submitted
                        </span>
                      ) : (
                        <span className="text-[11px] italic text-text-muted">
                          Awaiting self-appraisal
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {evalTarget && (
        <EvalModal
          review={evalTarget}
          onSubmit={handleSubmitEval}
          onClose={() => {
            setEvalTarget(null);
            setModalError("");
          }}
          isSaving={isSaving}
          error={modalError}
        />
      )}
    </div>
  );
}
