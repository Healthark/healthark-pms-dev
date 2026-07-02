import { lazy, Suspense, useState, useEffect, Fragment } from "react";
import {
  Users,
  ChevronDown,
  UserCircle,
  Check,
  CheckCheck,
  RotateCcw,
  Link as LinkIcon,
  MessageSquare,
  Send,
} from "lucide-react";
import {
  type TeamGoal,
  type TeamGoalQuery,
  type ApprovalStatus,
  type SelfReviewCycleHalf,
  type GoalMentorReviewPayload,
} from "../../services/goal.service";
import {
  useTeamGoals,
  useTeamGoalsFilterOptions,
  usePendingTeamGoals,
  useUpdateApproval,
  useBulkApprove,
  useSaveMentorReviewDraft,
  useSubmitMentorReview,
  useRemindSelfReview,
} from "../../queries/goals";
import { getErrorMessage } from "../../utils/errors";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";
import { ApprovalStatusBadge } from "./ApprovalStatusBadge";
import { CriteriaChecklist } from "./CriteriaChecklist";
import { GoalMentorReviewModal } from "./GoalMentorReviewModal";
import { RequestChangesModal } from "./RequestChangesModal";
import { SelfReviewCycleMenu } from "./SelfReviewCycleMenu";
// BulkApproveModal lazy-loaded (F3) — toolbar action, fires ~2-4
// times per FY per mentor; ~16 kB kept out of the main chunk.
const BulkApproveModal = lazy(() =>
  import("./BulkApproveModal").then((m) => ({ default: m.BulkApproveModal })),
);
import { SortableHeader } from "../SortableHeader";
import { TablePagination } from "../common/TablePagination";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { StringCombobox } from "../common/StringCombobox";
import { type SortState } from "../../utils/sort";
import { formatFyYearSpan } from "../../utils/fy";
import { halfDisplayLabel, isPostApproved } from "../../utils/goalStatus";
import { useSystemSettings } from "../../hooks/useSystemSettings";

// ---------------------------------------------------------------------------
// Filter config
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

// Sort keys map 1:1 to the backend's _TEAM_GOALS_SORT_COLUMNS. Sorting is
// now server-side (the page only holds one slice), so there's no
// client-side compare config here anymore.
type TeamGoalsSortKey = "title" | "owner_name" | "fy_year" | "approval_status";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TeamGoalsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 animate-pulse">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className="h-44 rounded-lg border border-border bg-surface p-4"
        >
          <div className="h-3 w-1/3 rounded bg-surface-hover mb-3" />
          <div className="h-3 w-3/4 rounded bg-surface-hover mb-3" />
          <div className="h-2.5 w-full rounded bg-surface-hover" />
          <div className="h-2.5 w-2/3 rounded bg-surface-hover mt-1.5" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab component
// ---------------------------------------------------------------------------

export function TeamGoalsTab() {
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const { settings } = useSystemSettings();
  const cycleType = settings?.cycle_type ?? null;

  const updateApprovalMutation = useUpdateApproval();
  const bulkApproveMutation = useBulkApprove();
  const saveMentorReviewDraftMutation = useSaveMentorReviewDraft();
  const submitMentorReviewMutation = useSubmitMentorReview();
  const remindMutation = useRemindSelfReview();
  const isActing = updateApprovalMutation.isPending;
  const bulkSaving = bulkApproveMutation.isPending;
  const isSavingReview = submitMentorReviewMutation.isPending;
  const isSavingReviewDraft = saveMentorReviewDraftMutation.isPending;

  const [sort, setSort] = useState<SortState<TeamGoalsSortKey> | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [menteeFilter, setMenteeFilter] = useState("all");
  const [expandedGoalId, setExpandedGoalId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Reset to page 1 (and collapse any expanded row) whenever a filter,
  // sort, or page size changes. `page` itself isn't a dep, so Next/Prev
  // don't bounce back to 1.
  useEffect(() => {
    setPage(1);
    setExpandedGoalId(null);
  }, [statusFilter, yearFilter, menteeFilter, sort, pageSize]);

  const query: TeamGoalQuery = {
    page,
    per_page: pageSize,
    goal_type: "annual",
    year: yearFilter !== "all" ? Number(yearFilter) : undefined,
    mentee: menteeFilter !== "all" ? menteeFilter : undefined,
    status: statusFilter,
    sort_by: sort?.key,
    sort_dir: sort?.direction,
  };

  // ['goals','team',query] — param-keyed page cache.
  const { data, isLoading, isFetching } = useTeamGoals(query);
  const goals = data?.items ?? [];
  const total = data?.total ?? 0;

  // Year + mentee dropdown options (server-distinct, cached).
  const { data: filterOptions } = useTeamGoalsFilterOptions("annual");
  const availableYears = filterOptions?.years ?? [];
  const availableMentees = filterOptions?.mentees ?? [];

  // All actionable goals (pending_approval + changes_requested), fetched
  // independently so the Bulk Approve modal can act across every page and
  // the toolbar badge shows the true pending count regardless of the
  // current page/filter.
  const { data: pendingGoals = [] } = usePendingTeamGoals("annual", true);
  const pendingApprovalCount = pendingGoals.filter(
    (g) => g.approval_status === "pending_approval",
  ).length;

  const hasActiveFilters =
    statusFilter !== "all" ||
    yearFilter !== "all" ||
    menteeFilter !== "all";

  const clearFilters = () => {
    setStatusFilter("all");
    setYearFilter("all");
    setMenteeFilter("all");
    setPage(1);
  };

  // "Request Changes" modal state
  const [feedbackTarget, setFeedbackTarget] = useState<TeamGoal | null>(null);
  const [modalError, setModalError] = useState("");

  // Bulk approve modal state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkError, setBulkError] = useState("");

  // Mentor review modal state — opens for any post-approval half. The modal
  // itself decides editable vs read-only based on whether a mentor review
  // for this (goal, half) already exists.
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

  const handleRemind = async (goal: TeamGoal) => {
    try {
      await remindMutation.mutateAsync(goal.id);
      toast.success(`Self-review reminder sent to ${goal.owner_name}.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleApprove = async (goal: TeamGoal) => {
    const ok = await confirm({
      title: `Approve ${goal.owner_name}'s goal?`,
      message: `Approve "${goal.title}". This locks the goal for editing and opens the H1/H2 self-review window for ${goal.owner_name}. You won't be able to undo this from here.`,
      variant: "default",
      confirmText: "Approve",
    });
    if (!ok) return;
    try {
      await updateApprovalMutation.mutateAsync({
        goalId: goal.id,
        payload: { approval_status: "approved" },
      });
      toast.success(`${goal.owner_name}'s goal approved.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleBulkApprove = async (goalIds: number[]) => {
    setBulkError("");
    try {
      const result = await bulkApproveMutation.mutateAsync(goalIds);
      if (result.failures.length === 0) {
        toast.success(
          `Approved ${result.approved_ids.length} goal${
            result.approved_ids.length === 1 ? "" : "s"
          }.`,
        );
        setBulkOpen(false);
      } else {
        toast.success(
          `Approved ${result.approved_ids.length} of ${goalIds.length} goal${
            goalIds.length === 1 ? "" : "s"
          }.`,
        );
        const firstReason = result.failures[0]?.reason ?? "Some goals could not be approved.";
        const extra =
          result.failures.length > 1
            ? ` (+${result.failures.length - 1} more)`
            : "";
        setBulkError(`${firstReason}${extra}`);
      }
    } catch (err) {
      setBulkError(getErrorMessage(err));
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

  if (isLoading) return <TeamGoalsSkeleton />;

  // Genuinely-empty state (no goals at all, no filters applied). When
  // filters are active and the page is empty, the content section below
  // renders the "no match" message instead.
  if (total === 0 && !hasActiveFilters) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
        <Users className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">
          No annual goals to review
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Your mentees haven't requested approval on any annual goals yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        {/* Filters, with Clear + Bulk Approve pushed to the right */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label
              htmlFor="team-year-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Fiscal Year
            </label>
            <select
              id="team-year-filter"
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
              htmlFor="team-mentee-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Mentee
            </label>
            <StringCombobox
              id="team-mentee-filter"
              options={availableMentees}
              value={menteeFilter === "all" ? "" : menteeFilter}
              onChange={(v) => setMenteeFilter(v || "all")}
              placeholder="All mentees"
            />
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="team-status-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Status
            </label>
            <select
              id="team-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[160px] cursor-pointer"
            >
              {buildStatusFilters(cycleType).map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <ClearFiltersButton
            active={hasActiveFilters}
            onClear={clearFilters}
            className="ml-auto"
          />
          <button
            type="button"
            onClick={() => {
              setBulkError("");
              setBulkOpen(true);
            }}
            disabled={pendingApprovalCount === 0}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={
              pendingApprovalCount === 0
                ? "No goals are currently awaiting approval"
                : `Bulk approve ${pendingApprovalCount} pending goal${
                    pendingApprovalCount === 1 ? "" : "s"
                  }`
            }
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Bulk Approve
            {pendingApprovalCount > 0 && (
              <span className="rounded-full bg-surface/20 px-1.5 text-[10px] font-semibold">
                {pendingApprovalCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {total === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <Users className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
          <p className="font-display text-sm font-medium text-text-main">
            No goals match this filter
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Try adjusting your search or filter options.
          </p>
        </div>
      ) : (
        /* ── Table View ── */
        <div
          className={`overflow-x-auto rounded-lg border border-border transition-opacity ${
            isFetching ? "opacity-60" : "opacity-100"
          }`}
          aria-busy={isFetching}
        >
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-muted/80 border-b border-border">
                <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-text-muted">#</th>
                <th className="text-left px-5 py-2.5">
                  <SortableHeader label="Goal" columnKey="title" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Mentee" columnKey="owner_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Fiscal Year" columnKey="fy_year" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Status" columnKey="approval_status" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
                <th className="text-center px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Notify
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {goals.map((goal, i) => {
                const isExpanded = expandedGoalId === goal.id;
                const isSubmitted = goal.approval_status === "pending_approval";
                const isApproved = isPostApproved(goal.approval_status);
                const isChangesRequested = goal.approval_status === "changes_requested";

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
                      <td className="px-3 py-3 text-center text-text-muted tabular-nums text-xs">
                        {((page - 1) * pageSize + i + 1).toLocaleString()}
                      </td>

                      {/* Goal title */}
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

                      {/* Mentee */}
                      <td className="px-4 py-3 text-text-muted">
                        <div className="flex items-center gap-1.5">
                          <UserCircle className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{goal.owner_name}</span>
                        </div>
                      </td>

                      {/* Year */}
                      <td className="px-4 py-3">
                        {goal.fy_year ? (
                          <span className="text-[12px] font-semibold text-text-muted bg-surface-hover px-1.5 py-0.5 rounded">
                            {formatFyYearSpan(goal.fy_year)}
                          </span>
                        ) : (
                          <span className="text-[12px] text-text-muted">—</span>
                        )}
                      </td>

                      {/* Status badge */}
                      <td className="px-4 py-3">
                        <ApprovalStatusBadge
                          status={goal.approval_status}
                          viewerRole="mentor"
                        />
                      </td>

                      {/* Actions — approval workflow + read-only self-review view */}
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
                            // Per-half mentor review entry. The modal handles
                            // both editable (no mentor review yet) and read-only
                            // (already submitted) modes. The mentor can open it
                            // to DRAFT even before the mentee submits their
                            // self-review; the submit gate lives in the modal +
                            // backend.
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

                      {/* Notify — send a self-review reminder (in-app + email).
                          Separate column so it doesn't crowd the workflow
                          actions; only meaningful once the goal is approved. */}
                      <td
                        className="px-2 py-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isApproved && (
                          <button
                            type="button"
                            onClick={() => handleRemind(goal)}
                            disabled={remindMutation.isPending}
                            aria-label={`Send ${goal.owner_name} a self-review reminder`}
                            title={`Send ${goal.owner_name} a self-review reminder`}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-text-muted hover:bg-brand/10 hover:text-brand disabled:opacity-50 transition-colors"
                          >
                            <Send className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row — colSpan covers all 7 columns */}
                    {isExpanded && (
                      <tr className="bg-brand/5">
                        <td colSpan={7} className="px-10 py-4">
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
        </div>
      )}

      {total > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          totalItems={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}

      {/* "Request Changes" modal */}
      {feedbackTarget && (
        <RequestChangesModal
          goal={feedbackTarget}
          onSend={handleSendFeedback}
          onClose={() => setFeedbackTarget(null)}
          isSaving={isActing}
          error={modalError}
        />
      )}

      {/* Bulk approve modal — lazy chunk (F3). Gated on bulkOpen so
          the chunk only fetches on first open. */}
      <Suspense fallback={null}>
        {bulkOpen && (
          <BulkApproveModal
            isOpen={bulkOpen}
            goals={pendingGoals}
            onClose={() => {
              setBulkOpen(false);
              setBulkError("");
            }}
            onSubmit={handleBulkApprove}
            isSaving={bulkSaving}
            error={bulkError}
          />
        )}
      </Suspense>

      {/* Mentor review modal — editable when no review yet for this half,
          read-only once the mentor's review has been submitted. */}
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
