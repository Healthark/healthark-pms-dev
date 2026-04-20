/**
 * ProjectReviews.tsx — Project Reviews Page (Revised PM-Centric Flow).
 *
 * My Reviews: Toggle between Card Grid view and Table view.
 * Evaluate Team: PM evaluation queue + Secondary evaluation queue.
 */

import { useState, useEffect, useCallback, Fragment } from "react";
import {
  Briefcase, Clock, CheckCircle2,
  User, Target, MessageSquare,
  CalendarClock, FileText, Star, Loader2, UserCircle, X,
  LayoutGrid, Table2, ChevronDown, ChevronUp, BookOpen, Lock, Search,
} from "lucide-react";
import {
  projectReviewService,
  type MyProjectCard,
  type ProjectReviewResponse,
} from "../services/project-review.service";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { PMEvaluationTab } from "../components/project-reviews/PMEvaluationTab";
import { useAuth } from "../hooks/useAuth";
import { SortableHeader } from "../components/SortableHeader";
import { compareValues, type SortKind, type SortState } from "../utils/sort";

export interface RoleExpectationResponse {
  id: number;
  department_name: string;
  designation_name: string;
  exp_task_execution: string;
  exp_ownership: string;
  exp_project_management: string;
  exp_client_deliverables: string;
  exp_communication: string;
  exp_mentoring: string;
  exp_competency_skills: string;
}

type ActiveTab = "my" | "evaluate";
type ViewMode = "grid" | "table";

// Sortable columns in the My Reviews table + their value extractors and type.
// Project/PM are plain alphabetical; project_code and cycle are alphanumeric
// (so "PRJ-9" sorts before "PRJ-10", "H1 FY25" before "H2 FY25"); rating is
// a numeric 1–5 string from the backend so gets numeric compare.
type MyReviewsSortKey =
  | "project_name"
  | "project_code"
  | "pm_name"
  | "cycle"
  | "review_status"
  | "performance_group";

const MY_REVIEWS_SORT_CONFIG: Record<MyReviewsSortKey, { kind: SortKind; get: (c: MyProjectCard) => unknown }> = {
  project_name:      { kind: "alpha",   get: (c) => c.project_name },
  project_code:      { kind: "natural", get: (c) => c.project_code },
  pm_name:           { kind: "alpha",   get: (c) => c.pm_name },
  cycle:             { kind: "natural", get: (c) => c.cycle },
  review_status:     { kind: "alpha",   get: (c) => c.review_status },
  performance_group: { kind: "numeric", get: (c) => c.performance_group },
};

const COMPETENCIES = [
  { key: "task_execution", label: "Task Execution & Problem Solving", expKey: "exp_task_execution" },
  { key: "ownership", label: "Ownership & Accountability", expKey: "exp_ownership" },
  { key: "project_management", label: "Project Management and Risk Mitigation", expKey: "exp_project_management" },
  { key: "client_deliverables", label: "Building Client-Ready Deliverables", expKey: "exp_client_deliverables" },
  { key: "communication", label: "Communication & Client/Stakeholder Management", expKey: "exp_communication" },
  { key: "mentoring", label: "Mentoring and Team Development", expKey: "exp_mentoring" },
  { key: "competency_skills", label: "Competency and Skills", expKey: "exp_competency_skills" },
] as const;

function formatPerformanceScore(score: string | null | undefined): string {
  if (!score) return "—";
  if (/^[1-5]$/.test(score)) return score;
  return score;
}

// ── Reusable: Role Expectation Toggle ──────────────────────────────

function ExpectationToggle({
  text,
}: {
  readonly text: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!text) return null;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors"
      >
        <BookOpen className="h-3 w-3" aria-hidden="true" />
        {open ? "Hide" : "View"} Role Expectations
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
          <p className="text-xs text-blue-800 whitespace-pre-wrap leading-relaxed">
            {text.replace(/ \| /g, "\n• ")}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Summary Card (compact, grid item) ──────────────────────────────

function ProjectSummaryCard({
  card,
  isSelected,
  onClick,
}: {
  readonly card: MyProjectCard;
  readonly isSelected: boolean;
  readonly onClick: () => void;
}) {
  const isReviewed = card.review_status === "reviewed";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-4 transition-all duration-200 ${
        isSelected
          ? "border-brand bg-brand/5 ring-1 ring-brand/30 shadow-md"
          : "border-border bg-surface hover:border-brand/30 hover:shadow-sm"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono text-text-muted bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
          {card.project_code}
        </span>
        {isReviewed ? (
          <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">
            <CheckCircle2 className="h-3 w-3" /> Reviewed
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
            <Clock className="h-3 w-3" /> Pending
          </span>
        )}
      </div>

      <h3 className="text-[14px] font-semibold text-text-main leading-snug mb-1.5 line-clamp-2">
        {card.project_name}
      </h3>

      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <User className="h-3 w-3 shrink-0" />
        <span className="truncate">{card.pm_name ?? "Unassigned"}</span>
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/60">
        {isReviewed ? (
          <span className="text-[11px] text-text-muted">Click to view evaluation</span>
        ) : (
          <span className="text-[11px] text-text-muted italic">Awaiting PM evaluation</span>
        )}
        {card.cycle && (
          <span className="text-[10px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
            {card.cycle}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Competency Block (shared between grid detail & table expanded) ──

function CompetencyBlock({
  review,
  roleExp,
  compact,
}: {
  readonly review: ProjectReviewResponse;
  readonly roleExp: RoleExpectationResponse | undefined;
  readonly compact?: boolean;
}) {
  return (
    <div className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
      {COMPETENCIES.map((comp, idx) => {
        const commentKey = `comment_${comp.key}` as keyof ProjectReviewResponse;
        const commentValue = review[commentKey] as string | null;
        if (!commentValue) return null;

        const expText = roleExp
          ? (roleExp as Record<string, unknown>)[comp.expKey] as string | null
          : null;

        return (
          <div key={comp.key} className={`flex flex-col gap-2 ${compact ? "rounded-lg bg-slate-50 p-3 border border-slate-100" : "rounded-xl bg-slate-50 p-5 border border-slate-100"}`}>
            <h3 className={`font-bold uppercase tracking-widest text-brand ${compact ? "text-[12px]" : "text-[13.5px]"}`}>
              {idx + 1}. {comp.label}
            </h3>

            <ExpectationToggle text={expText} />

            <div className={compact ? "px-0.5" : "px-1 mt-1"}>
              <div className="flex items-center gap-1.5 mb-1">
                <MessageSquare className="h-3.5 w-3.5 text-brand" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand">Manager Review</span>
              </div>
              <p className={`leading-relaxed text-text-main whitespace-pre-wrap ${compact ? "text-[13px]" : "text-[13.5px]"}`}>
                {commentValue}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Impact + Secondary Block (shared) ───────────────────────────────

function ImpactBlock({
  review,
  compact,
}: {
  readonly review: ProjectReviewResponse;
  readonly compact?: boolean;
}) {
  return (
    <>
      {review.impact_statement && (
        <div className={`${compact ? "rounded-lg p-3" : "rounded-xl p-5"} border border-blue-200 bg-blue-50/50`}>
          <h3 className="text-[12px] font-bold uppercase tracking-widest text-blue-700 mb-2 flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5" /> Overall Impact Statement
          </h3>
          <p className={`leading-relaxed text-blue-900 whitespace-pre-wrap ${compact ? "text-[13px]" : "text-[13.5px]"}`}>
            {review.impact_statement}
          </p>
        </div>
      )}

      {review.secondary_evaluations && review.secondary_evaluations.length > 0 && (
        <div className={`${compact ? "rounded-lg p-3" : "rounded-xl p-5"} border border-dashed border-border bg-background/50`}>
          <h3 className="text-[12px] font-bold uppercase tracking-widest text-text-muted mb-3 flex items-center gap-2">
            <User className="h-3.5 w-3.5" /> Secondary Feedback
          </h3>
          <div className="flex flex-col gap-3">
            {review.secondary_evaluations.map((ev) => (
              <div key={ev.id} className="flex flex-col gap-1.5 pb-3 border-b border-border/50 last:border-0 last:pb-0">
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-main">
                  <UserCircle className="h-4 w-4 text-text-muted" />
                  {ev.evaluator_name}
                  <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold tracking-wider text-slate-600 uppercase">
                    Secondary
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed text-text-muted pl-5 whitespace-pre-wrap">
                  {ev.impact_statement ?? "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Grid: Review Detail Panel (shown below the grid) ────────────────

function ReviewDetailPanel({
  card,
  expectations,
  onClose,
}: {
  readonly card: MyProjectCard;
  readonly expectations: RoleExpectationResponse[];
  readonly onClose: () => void;
}) {
  const [reviewDetails, setReviewDetails] = useState<ProjectReviewResponse | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState("");

  const { settings } = useSystemSettings();
  const projectRatingsVisible = settings?.project_ratings_visible ?? false;

  const roleExp = expectations.find(
    (e) => e.department_name === card.department_name && e.designation_name === card.assignment_role
  );

  useEffect(() => {
    if (!card.review_id) return;
    setIsFetching(true);
    setError("");
    setReviewDetails(null);

    projectReviewService
      .getReview(card.review_id)
      .then(setReviewDetails)
      .catch(() => setError("Failed to fetch evaluation details"))
      .finally(() => setIsFetching(false));
  }, [card.review_id]);

  const isPending = card.review_status !== "reviewed";

  return (
    <div className="rounded-xl border border-brand/20 bg-surface shadow-md animate-in slide-in-from-top-2 fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-bold text-text-main">{card.project_name}</h3>
            <span className="text-[11px] font-mono text-text-muted bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              {card.project_code}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[12px] text-text-muted">
            <span className="flex items-center gap-1"><User className="h-3 w-3" /> PM: {card.pm_name ?? "Unassigned"}</span>
            <span>Cycle: {card.cycle}</span>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-100 transition-colors" aria-label="Close details">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="px-5 py-5">
        {isPending ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Clock className="h-8 w-8 text-amber-500 mb-3" />
            <p className="font-medium text-text-main">Evaluation Pending</p>
            <p className="mt-1 text-sm text-text-muted">Your PM hasn't submitted the evaluation for this cycle yet.</p>
          </div>
        ) : isFetching ? (
          <div className="flex flex-col items-center justify-center py-10 text-text-muted gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
            <span className="text-[13px] font-medium">Fetching evaluation details...</span>
          </div>
        ) : error ? (
          <div className="text-center py-6 text-[13px] text-red-600 bg-red-50 rounded-xl">{error}</div>
        ) : reviewDetails ? (
          <div className="flex flex-col gap-6">
            {projectRatingsVisible && (
              <div className="flex items-center justify-between gap-4 flex-wrap rounded-lg border border-emerald-100 bg-emerald-50/50 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Star className="h-4 w-4 text-emerald-600" />
                  <span className="text-[13.5px] text-text-main">
                    Project Evaluation Score: <span className="font-bold text-emerald-700">{formatPerformanceScore(reviewDetails.performance_group)}</span>
                  </span>
                </div>
                {reviewDetails.reviewer_name && (
                  <div className="flex items-center gap-1.5 text-[12px] text-emerald-800/80 font-medium bg-emerald-100/50 px-2.5 py-1 rounded-md">
                    <UserCircle className="h-3.5 w-3.5" />
                    Evaluated by {reviewDetails.reviewer_name}
                  </div>
                )}
              </div>
            )}
            <CompetencyBlock review={reviewDetails} roleExp={roleExp} />
            <ImpactBlock review={reviewDetails} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Table View: Expandable Row ──────────────────────────────────────

function TableExpandedRow({
  card,
  expectations,
}: {
  readonly card: MyProjectCard;
  readonly expectations: RoleExpectationResponse[];
}) {
  const [reviewDetails, setReviewDetails] = useState<ProjectReviewResponse | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState("");

  const { settings } = useSystemSettings();
  const projectRatingsVisible = settings?.project_ratings_visible ?? false;

  const roleExp = expectations.find(
    (e) => e.department_name === card.department_name && e.designation_name === card.assignment_role
  );

  useEffect(() => {
    if (!card.review_id) { setIsFetching(false); return; }
    setIsFetching(true);
    projectReviewService
      .getReview(card.review_id)
      .then(setReviewDetails)
      .catch(() => setError("Failed to load"))
      .finally(() => setIsFetching(false));
  }, [card.review_id]);

  if (card.review_status !== "reviewed") {
    return (
      <tr>
        <td colSpan={6} className="px-5 py-6 text-center text-sm text-text-muted bg-slate-50/50">
          <Clock className="h-5 w-5 text-amber-500 mx-auto mb-2" />
          Evaluation pending — awaiting PM review.
        </td>
      </tr>
    );
  }

  if (isFetching) {
    return (
      <tr>
        <td colSpan={6} className="px-5 py-6 text-center bg-slate-50/50">
          <Loader2 className="h-5 w-5 animate-spin text-brand mx-auto" />
        </td>
      </tr>
    );
  }

  if (error || !reviewDetails) {
    return (
      <tr>
        <td colSpan={6} className="px-5 py-4 text-center text-sm text-red-600 bg-red-50/30">
          {error || "No data available"}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={6} className="p-0">
        <div className="border-t border-brand/10 bg-slate-50/40 px-5 py-5 animate-in slide-in-from-top-1 fade-in duration-200">
          <div className="flex flex-col gap-4">
            {/* Rating bar */}
            {projectRatingsVisible && (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2">
                <Star className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-[13px] text-text-main">
                  Score: <span className="font-bold text-emerald-700">{formatPerformanceScore(reviewDetails.performance_group)}</span>
                </span>
                {reviewDetails.reviewer_name && (
                  <span className="ml-auto text-[11px] text-emerald-700">by {reviewDetails.reviewer_name}</span>
                )}
              </div>
            )}

            <CompetencyBlock review={reviewDetails} roleExp={roleExp} compact />
            <ImpactBlock review={reviewDetails} compact />
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Skeleton Loaders ────────────────────────────────────────────────

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex justify-between mb-3">
            <div className="h-4 w-16 rounded bg-slate-100" />
            <div className="h-4 w-20 rounded-full bg-slate-100" />
          </div>
          <div className="h-4 w-3/4 rounded bg-slate-100 mb-2" />
          <div className="h-3 w-1/2 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-6 px-5 py-3 border-b border-border">
          <div className="h-4 w-1/4 rounded bg-slate-100" />
          <div className="h-4 w-16 rounded bg-slate-100" />
          <div className="h-4 w-1/5 rounded bg-slate-100" />
          <div className="h-4 w-20 rounded-full bg-slate-100" />
          <div className="h-4 w-12 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

// ── Main Page Component ─────────────────────────────────────────────

export function ProjectReviews() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();

  const projectRatingsVisible = settings?.project_ratings_visible ?? false;

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [selectedCycle, setSelectedCycle] = useState<string>("");
  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null);
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pmFilter, setPmFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortState<MyReviewsSortKey> | null>(null);

  const [cards, setCards] = useState<MyProjectCard[]>([]);
  const [expectations, setExpectations] = useState<RoleExpectationResponse[]>([]);
  const [showEvaluateTab, setShowEvaluateTab] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [projectsData, expectationsData, pmQueue, secQueue] = await Promise.all([
        projectReviewService.getMyProjects(),
        projectReviewService.getRoleExpectations(),
        projectReviewService.getPMQueue().catch(() => []),
        projectReviewService.getSecondaryQueue().catch(() => []),
      ]);
      setCards(projectsData);
      setExpectations(expectationsData);
      setShowEvaluateTab(pmQueue.length > 0 || secQueue.length > 0);
    } catch {
      // Stays empty on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    if (settings?.active_cycle_name && selectedCycle === "") {
      setSelectedCycle(settings.active_cycle_name);
    }
  }, [settings?.active_cycle_name, selectedCycle]);

  const availableCycles = Array.from(new Set(cards.map((c) => c.cycle).filter(Boolean) as string[]));

  const availablePMs = Array.from(new Set(cards.map((c) => c.pm_name).filter(Boolean) as string[]));
  const availableDepts = Array.from(new Set(cards.map((c) => c.department_name).filter(Boolean) as string[]));

  // Apply all filters
  const filteredCards = cards.filter((c) => {
    if (selectedCycle && selectedCycle !== "all" && c.cycle !== selectedCycle) return false;
    if (pmFilter !== "all" && c.pm_name !== pmFilter) return false;
    if (statusFilter !== "all" && c.review_status !== statusFilter) return false;
    if (deptFilter !== "all" && c.department_name !== deptFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesName = c.project_name.toLowerCase().includes(q);
      const matchesCode = c.project_code.toLowerCase().includes(q);
      if (!matchesName && !matchesCode) return false;
    }
    return true;
  });

  // Apply current sort (if any) on top of the filtered list.
  // We don't mutate filteredCards — Array.slice first so React state stays immutable.
  const sortedCards = sort
    ? filteredCards.slice().sort((a, b) => {
        const { kind, get } = MY_REVIEWS_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filteredCards;

  const selectedCard = sortedCards.find(
    (c) => `${c.project_id}-${c.cycle}` === selectedCardKey
  );

  // Clear selections when filters change
  useEffect(() => {
    setSelectedCardKey(null);
    setExpandedRowKey(null);
  }, [selectedCycle, pmFilter, statusFilter, deptFilter, searchQuery]);

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-3 text-[14px] font-semibold border-b-2 transition-all ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      viewMode === mode
        ? "bg-brand/10 text-brand"
        : "text-text-muted hover:bg-slate-100"
    }`;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 pb-10 animate-in fade-in duration-500">

      {/* ── Page Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-text-main">
            Project Reviews
          </h1>
          <p className="mt-1 text-[13px] text-text-muted flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Project-specific performance feedback and evaluations.
          </p>
        </div>

        <div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-2 shadow-sm">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Active Cycle</span>
            <div className="mt-0.5 flex items-center gap-1.5 px-1">
              <CalendarClock className="h-3.5 w-3.5 text-brand shrink-0" aria-hidden="true" />
              <span className="text-[13px] font-semibold text-text-main">
                {settings?.active_cycle_name ?? "—"}
              </span>
            </div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Reviews</span>
            <span className={`mt-1 text-[13px] font-semibold flex items-center gap-1.5 ${settings?.reviews_submission_open ? "text-emerald-600" : "text-text-muted"}`}>
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {settings?.reviews_submission_open ? "Open" : "Closed"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main Content Container ── */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">

        <div className="flex border-b border-border px-2">
          <button type="button" className={tabCls("my")} onClick={() => setActiveTab("my")}>
            My Reviews
          </button>
          {showEvaluateTab && (
            <button type="button" className={tabCls("evaluate")} onClick={() => setActiveTab("evaluate")}>
              Evaluate Team
            </button>
          )}
        </div>

        <div className="p-5">
          {/* ── My Reviews Tab ── */}
          {activeTab === "my" && (
            <div className="flex flex-col gap-5">
              {/* Toolbar */}
              {!isLoading && cards.length > 0 && (
                <div className="flex flex-col gap-3">
                  {/* Row 1: Search + View Toggle */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-xs">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Search projects..."
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

                  {/* Row 2: Filters */}
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Cycle</label>
                      <select
                        value={selectedCycle}
                        onChange={(e) => setSelectedCycle(e.target.value)}
                        className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
                      >
                        <option value="all">All Cycles</option>
                        {availableCycles.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">PM</label>
                      <select
                        value={pmFilter}
                        onChange={(e) => setPmFilter(e.target.value)}
                        className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[140px] cursor-pointer"
                      >
                        <option value="all">All PMs</option>
                        {availablePMs.map((pm) => (
                          <option key={pm} value={pm}>{pm}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Status</label>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
                      >
                        <option value="all">All</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Dept</label>
                      <select
                        value={deptFilter}
                        onChange={(e) => setDeptFilter(e.target.value)}
                        className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
                      >
                        <option value="all">All Depts</option>
                        {availableDepts.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Content */}
              {isLoading ? (
                viewMode === "grid" ? <GridSkeleton /> : <TableSkeleton />
              ) : cards.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
                  <Briefcase className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
                  <p className="font-display text-base font-medium text-text-main">No projects assigned</p>
                  <p className="mt-1 text-sm text-text-muted">You'll see your project evaluations here once HR assigns them.</p>
                </div>
              ) : filteredCards.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
                  <Search className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
                  <p className="font-display text-sm font-medium text-text-main">No matching reviews</p>
                  <p className="mt-1 text-xs text-text-muted">Try adjusting your filters or search query.</p>
                </div>
              ) : viewMode === "grid" ? (
                /* ── Grid View ── */
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {sortedCards.map((card) => {
                      const key = `${card.project_id}-${card.cycle}`;
                      return (
                        <ProjectSummaryCard
                          key={key}
                          card={card}
                          isSelected={selectedCardKey === key}
                          onClick={() => setSelectedCardKey(selectedCardKey === key ? null : key)}
                        />
                      );
                    })}
                  </div>

                  {selectedCard && (
                    <ReviewDetailPanel
                      key={selectedCardKey}
                      card={selectedCard}
                      expectations={expectations}
                      onClose={() => setSelectedCardKey(null)}
                    />
                  )}
                </>
              ) : (
                /* ── Table View ── */
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-border">
                        <th className="text-left px-5 py-2.5">
                          <SortableHeader label="Project" columnKey="project_name" sort={sort} onSort={setSort} />
                        </th>
                        <th className="text-left px-4 py-2.5">
                          <SortableHeader label="Code" columnKey="project_code" sort={sort} onSort={setSort} />
                        </th>
                        <th className="hidden sm:table-cell text-left px-4 py-2.5">
                          <SortableHeader label="PM" columnKey="pm_name" sort={sort} onSort={setSort} />
                        </th>
                        <th className="text-left px-4 py-2.5">
                          <SortableHeader label="Cycle" columnKey="cycle" sort={sort} onSort={setSort} />
                        </th>
                        <th className="text-left px-4 py-2.5">
                          <SortableHeader label="Status" columnKey="review_status" sort={sort} onSort={setSort} />
                        </th>
                        <th className="text-left px-4 py-2.5">
                          <SortableHeader label="Rating" columnKey="performance_group" sort={sort} onSort={setSort} />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {sortedCards.map((card) => {
                        const key = `${card.project_id}-${card.cycle}`;
                        const isExpanded = expandedRowKey === key;
                        const isReviewed = card.review_status === "reviewed";

                        return (
                          <Fragment key={key}>
                            <tr
                              className={`transition-colors cursor-pointer ${
                                isExpanded ? "bg-brand/5" : "hover:bg-slate-50/60"
                              }`}
                              onClick={() => setExpandedRowKey(isExpanded ? null : key)}
                            >
                              <td className="px-5 py-3 font-medium text-text-main">
                                <div className="flex items-center gap-2">
                                  <ChevronDown className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                                  {card.project_name}
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono text-text-muted text-[12px]">{card.project_code}</td>
                              <td className="hidden sm:table-cell px-4 py-3 text-text-muted">{card.pm_name ?? "—"}</td>
                              <td className="px-4 py-3">
                                <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                                  {card.cycle ?? "—"}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {isReviewed ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                                    <CheckCircle2 className="h-3 w-3" /> Reviewed
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                                    <Clock className="h-3 w-3" /> Pending
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {!projectRatingsVisible ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-text-muted/60">
                                    <Lock className="h-3 w-3" /> Hidden
                                  </span>
                                ) : card.performance_group ? (
                                  <span className="font-semibold text-text-main">{card.performance_group}</span>
                                ) : (
                                  <span className="text-text-muted">—</span>
                                )}
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
              )}
            </div>
          )}

          {/* ── Evaluate Team Tab ── */}
          {activeTab === "evaluate" && showEvaluateTab && (
            <PMEvaluationTab />
          )}
        </div>
      </div>
    </div>
  );
}
