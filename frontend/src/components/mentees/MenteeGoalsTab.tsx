import { useEffect, useState, Fragment } from "react";
import {
  ChevronDown,
  Check,
  RotateCcw,
  Link as LinkIcon,
  MessageSquare,
  Target,
} from "lucide-react";
import {
  type TeamGoal,
  type ApprovalStatus,
  type SelfReviewCycleHalf,
  type GoalMentorReviewPayload,
} from "../../services/goal.service";
import {
  useUpdateApproval,
  useSubmitMentorReview,
  useSaveMentorReviewDraft,
} from "../../queries/goals";
import { useMenteeGoals } from "../../queries/mentees";
import { getErrorMessage } from "../../utils/errors";
import { formatFyYearSpan } from "../../utils/fy";
import { halfDisplayLabel, isPostApproved } from "../../utils/goalStatus";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { ApprovalStatusBadge } from "../goals/ApprovalStatusBadge";
import { CriteriaChecklist } from "../goals/CriteriaChecklist";
import { GoalMentorReviewModal } from "../goals/GoalMentorReviewModal";
import { SelfReviewCycleMenu } from "../goals/SelfReviewCycleMenu";
import { RequestChangesModal } from "../goals/RequestChangesModal";
import { SortableHeader } from "../SortableHeader";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { TablePagination } from "../common/TablePagination";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";

// ---------------------------------------------------------------------------
// Filter + sort config
// ---------------------------------------------------------------------------

type StatusFilter = "all" | ApprovalStatus;

function buildStatusFilters(
  cycleType: string | null,
): { value: StatusFilter; label: string }[] {
  const base: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "pending_approval", label: "Pending Approval" },
    { value: "changes_requested", label: "Changes Requested" },
    { value: "approved", label: "Approved" },
  ];
  if (cycleType === "quarterly") {
    return [
      ...base,
      { value: "q1_self_reviewed",   label: "Q1 Self-Reviewed" },
      { value: "q1_mentor_reviewed", label: "Q1 Mentor-Reviewed" },
      { value: "q2_self_reviewed",   label: "Q2 Self-Reviewed" },
      { value: "q2_mentor_reviewed", label: "Q2 Mentor-Reviewed" },
      { value: "q3_self_reviewed",   label: "Q3 Self-Reviewed" },
      { value: "q3_mentor_reviewed", label: "Q3 Mentor-Reviewed" },
      { value: "q4_self_reviewed",   label: "Q4 Self-Reviewed" },
      { value: "q4_mentor_reviewed", label: "Q4 Mentor-Reviewed" },
    ];
  }
  return [
    ...base,
    { value: "h1_self_reviewed",   label: "H1 Mentor Review Pending" },
    { value: "h1_mentor_reviewed", label: "H1 Mentor-Reviewed" },
    { value: "h2_self_reviewed",   label: "H2 Mentor Review Pending" },
    { value: "h2_mentor_reviewed", label: "H2 Mentor-Reviewed" },
  ];
}

type MenteeGoalsSortKey = "title" | "fy_year" | "approval_status";

const SORT_CONFIG: Record<
  MenteeGoalsSortKey,
  { kind: SortKind; get: (g: TeamGoal) => unknown }
> = {
  title:           { kind: "alpha",   get: (g) => g.title },
  fy_year:         { kind: "numeric", get: (g) => g.fy_year },
  approval_status: { kind: "alpha",   get: (g) => g.approval_status },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MenteeGoalsTabProps {
  readonly menteeId: number;
  readonly menteeName: string;
}

export function MenteeGoalsTab({ menteeId, menteeName }: MenteeGoalsTabProps) {
  // Per-tab fetch (PR 19 split) — keys on ['mentees', id, 'goals'].
  // Cross-domain invalidation from the goals/annual-reviews/
  // project-reviews mutation broadcasts catches this via the
  // top-level ['mentees'] prefix.
  const {
    data: goals = [],
    isPending,
    error: queryError,
  } = useMenteeGoals(menteeId);
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const { settings } = useSystemSettings();
  const cycleType = settings?.cycle_type ?? null;

  const updateApprovalMutation = useUpdateApproval();
  const submitMentorReviewMutation = useSubmitMentorReview();
  const saveMentorReviewDraftMutation = useSaveMentorReviewDraft();
  const isActing = updateApprovalMutation.isPending;
  const isSavingReview = submitMentorReviewMutation.isPending;
  const isSavingReviewDraft = saveMentorReviewDraftMutation.isPending;
  const [sort, setSort] = useState<SortState<MenteeGoalsSortKey> | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [expandedGoalId, setExpandedGoalId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Request-Changes modal
  const [feedbackTarget, setFeedbackTarget] = useState<TeamGoal | null>(null);
  const [modalError, setModalError] = useState("");

  // Mentor-review modal — opens for any post-approval half. The modal shows
  // the mentee's self-review and lets the mentor write/submit their per-half
  // review (editable until submitted, then read-only). Mirrors Team Goals so
  // a mentor can complete goal reviews from My Mentees too.
  const [reviewGoal, setReviewGoal] = useState<TeamGoal | null>(null);
  const [reviewCycle, setReviewCycle] = useState<SelfReviewCycleHalf | null>(null);
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

  const handleSaveReviewDraft = async (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ) => {
    if (!reviewGoal) return;
    setReviewError("");
    try {
      await saveMentorReviewDraftMutation.mutateAsync({
        goalId: reviewGoal.id,
        cycleHalf,
        payload,
      });
      toast.success("Draft saved.");
    } catch (err) {
      setReviewError(getErrorMessage(err));
    }
  };

  const handleSubmitReview = async (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ) => {
    if (!reviewGoal) return;
    const halfLabel = halfDisplayLabel(cycleHalf, cycleType);
    const ok = await confirm({
      title: `Submit ${halfLabel} mentor review?`,
      message: `Submit your ${halfLabel} review on "${reviewGoal.title}" for ${reviewGoal.owner_name}. Mentor reviews are one-shot — once submitted you can't edit this entry, and ${reviewGoal.owner_name} will see your assessment for this half.`,
      variant: "warning",
      confirmText: "Submit Mentor Review",
    });
    if (!ok) return;
    setReviewError("");
    try {
      await submitMentorReviewMutation.mutateAsync({
        goalId: reviewGoal.id,
        cycleHalf,
        payload,
      });
      closeReview();
    } catch (err) {
      setReviewError(getErrorMessage(err));
    }
  };

  const handleApprove = async (goal: TeamGoal) => {
    const ok = await confirm({
      title: `Approve ${menteeName}'s goal?`,
      message: `Approve "${goal.title}". This locks the goal for editing and opens the H1/H2 self-review window for ${menteeName}. You won't be able to undo this from here.`,
      variant: "default",
      confirmText: "Approve",
    });
    if (!ok) return;
    try {
      await updateApprovalMutation.mutateAsync({
        goalId: goal.id,
        payload: { approval_status: "approved" },
      });
      // Mutation onSuccess invalidates ['goals'] + ['mentees'] → parent
      // MenteeDetail re-fetches automatically.
      toast.success(`${goal.owner_name}'s goal approved.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleSendFeedback = async (feedback: string) => {
    if (!feedbackTarget) return;
    setModalError("");
    try {
      await updateApprovalMutation.mutateAsync({
        goalId: feedbackTarget.id,
        payload: { approval_status: "changes_requested", feedback },
      });
      setFeedbackTarget(null);
      toast.success("Feedback sent.");
    } catch (err) {
      setModalError(getErrorMessage(err));
    }
  };

  // Reset expanded row when filters change so the UI stays coherent
  useEffect(() => {
    setExpandedGoalId(null);
  }, [statusFilter, yearFilter]);

  const hasActiveFilters =
    statusFilter !== "all" || yearFilter !== "all";

  const clearFilters = () => {
    setStatusFilter("all");
    setYearFilter("all");
  };

  const availableYears = Array.from(
    new Set(goals.map((g) => g.fy_year).filter((y): y is number => y !== null)),
  ).sort((a, b) => b - a);

  const filtered = goals
    .filter((g) => statusFilter === "all" || g.approval_status === statusFilter)
    .filter((g) => yearFilter === "all" || g.fy_year === Number(yearFilter));

  const sortedGoals = sort
    ? filtered.slice().sort((a, b) => {
        const { kind, get } = SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filtered;

  // Client-side pagination over the sorted rows. Reset to page 1 when the
  // filter set / page size changes — tracked during render.
  const filterKey = [statusFilter, yearFilter, pageSize].join("|");
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  let currentPage = page;
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
    currentPage = 1;
  }
  const totalPages = Math.max(1, Math.ceil(sortedGoals.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = sortedGoals.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (isPending) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center text-sm text-text-muted">
        Loading goals…
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
        Could not load goals. Please try again.
      </div>
    );
  }

  // Empty: no goals at all for this mentee
  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center">
        <Target className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
        <p className="font-display text-sm font-medium text-text-main">
          No annual goals to review
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {menteeName} hasn't requested approval on any annual goals yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label
              htmlFor="mentee-goal-year-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Fiscal Year
            </label>
            <select
              id="mentee-goal-year-filter"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
            >
              <option value="all">All Years</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {formatFyYearSpan(y)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="mentee-goal-status-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Status
            </label>
            <select
              id="mentee-goal-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[160px] cursor-pointer"
            >
              {buildStatusFilters(cycleType).map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                  {f.value !== "all" &&
                    ` (${goals.filter((g) => g.approval_status === f.value).length})`}
                </option>
              ))}
            </select>
          </div>

          <ClearFiltersButton
            active={hasActiveFilters}
            onClear={clearFilters}
            className="ml-auto"
          />
        </div>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <Target className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
          <p className="font-display text-sm font-medium text-text-main">
            No goals match this filter
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Try adjusting your filter options.
          </p>
        </div>
      ) : (
        /* ── Table view ── */
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-muted/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader
                    label="Goal"
                    columnKey="title"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader
                    label="Fiscal Year"
                    columnKey="fy_year"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader
                    label="Status"
                    columnKey="approval_status"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {pageRows.map((goal) => {
                const isExpanded = expandedGoalId === goal.id;
                const isSubmitted = goal.approval_status === "pending_approval";
                const isApproved = isPostApproved(goal.approval_status);
                const isChangesRequested =
                  goal.approval_status === "changes_requested";

                return (
                  <Fragment key={goal.id}>
                    <tr
                      className={`transition-colors cursor-pointer ${
                        isExpanded ? "bg-brand/5" : "hover:bg-surface-muted/60"
                      }`}
                      onClick={() =>
                        setExpandedGoalId(isExpanded ? null : goal.id)
                      }
                    >
                      <td className="px-5 py-3 font-medium text-text-main max-w-xs">
                        <div className="flex items-center gap-2">
                          <ChevronDown
                            className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                          <span className="line-clamp-1">{goal.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {goal.fy_year ? (
                          <span className="text-[12px] font-semibold text-text-muted bg-surface-hover px-1.5 py-0.5 rounded">
                            {formatFyYearSpan(goal.fy_year)}
                          </span>
                        ) : (
                          <span className="text-[12px] text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ApprovalStatusBadge
                          status={goal.approval_status}
                          viewerRole="mentor"
                        />
                      </td>
                      <td
                        className="px-4 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {isSubmitted && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setModalError("");
                                  setFeedbackTarget(goal);
                                }}
                                disabled={isActing}
                                className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 transition-colors"
                              >
                                <RotateCcw className="h-3 w-3" /> Request Changes
                              </button>
                              <button
                                type="button"
                                onClick={() => handleApprove(goal)}
                                disabled={isActing}
                                className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                              >
                                <Check className="h-3 w-3" /> Approve
                              </button>
                            </>
                          )}
                          {isApproved && (
                            <SelfReviewCycleMenu
                              goal={goal}
                              mode="mentor"
                              onSelect={(half) => openReview(goal, half)}
                            />
                          )}
                          {isChangesRequested && (
                            <span className="text-[11px] text-amber-700 dark:text-amber-300 italic">
                              Awaiting revision
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-brand/5">
                        <td colSpan={4} className="px-10 py-4">
                          <div className="space-y-3 max-w-2xl">
                            {goal.description && (
                              <p className="text-sm text-text-muted">
                                {goal.description}
                              </p>
                            )}
                            {goal.attachment_url && (
                              <a
                                href={goal.attachment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-brand hover:underline w-fit"
                              >
                                <LinkIcon className="h-3 w-3 shrink-0" />
                                Attachment
                              </a>
                            )}
                            {isChangesRequested && goal.manager_feedback && (
                              <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2">
                                <MessageSquare className="h-4 w-4 text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-0.5">
                                    Mentor Feedback
                                  </p>
                                  <p className="text-xs text-amber-800 dark:text-amber-300">
                                    {goal.manager_feedback}
                                  </p>
                                </div>
                              </div>
                            )}
                            {goal.criteria.length > 0 && (
                              <CriteriaChecklist
                                criteria={goal.criteria}
                                approvalStatus={goal.approval_status}
                                progressPercent={goal.progress_percent}
                                readOnly
                              />
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
          <TablePagination
            page={safePage}
            pageSize={pageSize}
            totalItems={sortedGoals.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {/* Request-Changes modal */}
      {feedbackTarget && (
        <RequestChangesModal
          goal={feedbackTarget}
          onSend={handleSendFeedback}
          onClose={() => setFeedbackTarget(null)}
          isSaving={isActing}
          error={modalError}
        />
      )}

      {/* Mentor review modal — shows the mentee's self-review and lets the
          mentor write/submit their per-half review (read-only once submitted). */}
      <GoalMentorReviewModal
        isOpen={reviewGoal !== null && reviewCycle !== null}
        goal={reviewGoal}
        cycleHalf={reviewCycle}
        onClose={closeReview}
        onSubmit={handleSubmitReview}
        onSaveDraft={handleSaveReviewDraft}
        isSaving={isSavingReview}
        isDraftSaving={isSavingReviewDraft}
        error={reviewError}
      />
    </div>
  );
}
