import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  goalService,
  type Goal,
  type GoalCreatePayload,
  type GoalUpdatePayload,
  type GoalSelfReviewPayload,
  type GoalMentorReviewPayload,
  type GoalApprovalPayload,
  type GoalType,
  type SelfReviewCycleHalf,
  type TeamGoal,
  type TeamGoalQuery,
  type TeamGoalsFilterOptions,
  type Criterion,
  type CriterionCreatePayload,
  type CriterionUpdatePayload,
  type BulkApproveResult,
  type MyGoalAccess,
} from "../services/goal.service";
import type { Page } from "../services/pagination";
import { dashboardSummaryQueryKey } from "./dashboard";
import { invalidateMentees } from "./mentees";

/**
 * Strict, shared query keys for the goals domain.
 *
 * Top-level `goalsQueryKey` is used as the invalidation broadcast key —
 * every mutation invalidates it, which catches every sub-key the cache
 * holds (mine + team + by-type variations). The dashboard summary is
 * additionally invalidated for any goal mutation that affects its
 * counters (approval-state changes, bulk approve, submit).
 */
export const goalsQueryKey = ["goals"] as const;
export const myGoalsQueryKey = (goalType?: GoalType) =>
  ["goals", "mine", goalType ?? "all"] as const;
// Paginated team-goals key includes the full query (page + filters +
// sort). The top-level ['goals'] mutation broadcast prefix-matches every
// variant, so approving a goal refetches the visible page automatically.
export const teamGoalsQueryKey = (params: TeamGoalQuery) =>
  ["goals", "team", params] as const;
export const teamGoalsFilterOptionsQueryKey = (goalType?: GoalType) =>
  ["goals", "team", "filter-options", goalType ?? "all"] as const;
export const pendingTeamGoalsQueryKey = (goalType?: GoalType) =>
  ["goals", "team", "pending", goalType ?? "all"] as const;
export const goalDetailQueryKey = (goalId: number) =>
  ["goals", "detail", goalId] as const;
export const allGoalsQueryKey = (fyYear?: number | null) =>
  ["goals", "all", fyYear ?? "all"] as const;

// ── Reads ─────────────────────────────────────────────────────────────

export function useMyGoals(goalType?: GoalType) {
  return useQuery<Goal[]>({
    queryKey: myGoalsQueryKey(goalType),
    queryFn: () => goalService.getMyGoals(goalType),
  });
}

// The caller's own goal-access grants. Sub-key of ['goals'], so any goal
// mutation's broadcast invalidation also refreshes it — cheap and keeps the
// Add/Edit affordances honest right after the employee acts.
export const myGoalAccessQueryKey = ["goals", "my-access"] as const;

export function useMyGoalAccess() {
  return useQuery<MyGoalAccess>({
    queryKey: myGoalAccessQueryKey,
    queryFn: () => goalService.getMyAccess(),
  });
}

export function useTeamGoals(params: TeamGoalQuery) {
  return useQuery<Page<TeamGoal>>({
    queryKey: teamGoalsQueryKey(params),
    queryFn: () => goalService.getTeamGoals(params),
    placeholderData: keepPreviousData,
  });
}

// Filter options + the bulk-approve pending set change only when goals
// enter/leave the actionable states, so a short staleTime avoids
// refetching them on every page/filter/sort interaction.
const TEAM_GOALS_AUX_STALE_TIME = 60_000;

export function useTeamGoalsFilterOptions(goalType?: GoalType) {
  return useQuery<TeamGoalsFilterOptions>({
    queryKey: teamGoalsFilterOptionsQueryKey(goalType),
    queryFn: () => goalService.getTeamGoalsFilterOptions(goalType),
    staleTime: TEAM_GOALS_AUX_STALE_TIME,
  });
}

/** Admin-only: org-wide goals for the All Goals tab, scoped to one FY.
 *  Year drives the fetch; keepPreviousData avoids a flash on year switch. */
export function useAllGoals(fyYear?: number | null) {
  return useQuery<TeamGoal[]>({
    queryKey: allGoalsQueryKey(fyYear),
    queryFn: () => goalService.getAllGoals(fyYear),
    placeholderData: keepPreviousData,
  });
}

/** All team goals awaiting mentor action — for the Bulk Approve modal,
 *  so it can act across every page. Enabled lazily by the modal. */
export function usePendingTeamGoals(goalType: GoalType | undefined, enabled: boolean) {
  return useQuery<TeamGoal[]>({
    queryKey: pendingTeamGoalsQueryKey(goalType),
    queryFn: () => goalService.getPendingTeamGoals(goalType),
    enabled,
  });
}

/**
 * Single goal with the full self_reviews + mentor_reviews text bodies.
 *
 * The team-list response was slimmed to drop those text fields (payload
 * reduction PR 18) — `GET /goals/team` now returns only `cycle_half` +
 * `is_draft` per review row so the SelfReviewCycleMenu can render its
 * status indicators. The mentor-review modal needs the actual text and
 * calls this hook to fetch the full goal on open. Subsequent opens of
 * the same goal are cache hits.
 */
export function useGoalDetail(goalId: number | null) {
  return useQuery<Goal>({
    queryKey: goalDetailQueryKey(goalId ?? -1),
    queryFn: () => goalService.getGoal(goalId as number),
    enabled: goalId !== null,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────

/** Invalidate every goals cache + the dashboard summary + the mentees
 *  aggregate. Used by mutations whose result affects the goal list, the
 *  aggregate counters, AND the inline `goals_list` on a mentor's
 *  MenteeDetail view. */
function invalidateGoalsAndDashboard(
  qc: ReturnType<typeof useQueryClient>,
): void {
  qc.invalidateQueries({ queryKey: goalsQueryKey });
  qc.invalidateQueries({ queryKey: dashboardSummaryQueryKey });
  invalidateMentees(qc);
}

/** Drafts don't bump dashboard counters but still surface inline on
 *  MenteeDetail (mentee's draft self-review text + criteria progress
 *  show up in MenteeAnnualSummaryTab). */
function invalidateGoalDrafts(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: goalsQueryKey });
  invalidateMentees(qc);
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: GoalCreatePayload) => goalService.createGoal(payload),
    onSuccess: () => invalidateGoalsAndDashboard(qc),
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      payload,
    }: {
      goalId: number;
      payload: GoalUpdatePayload;
    }) => goalService.updateGoal(goalId, payload),
    onSuccess: () => invalidateGoalsAndDashboard(qc),
  });
}

export function useSubmitGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (goalId: number) => goalService.submitGoal(goalId),
    onSuccess: () => invalidateGoalsAndDashboard(qc),
  });
}

export function useSubmitSelfReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      cycleHalf,
      payload,
    }: {
      goalId: number;
      cycleHalf: SelfReviewCycleHalf;
      payload: GoalSelfReviewPayload;
    }) => goalService.submitSelfReview(goalId, cycleHalf, payload),
    onSuccess: () => invalidateGoalsAndDashboard(qc),
  });
}

export function useSaveSelfReviewDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      cycleHalf,
      payload,
    }: {
      goalId: number;
      cycleHalf: SelfReviewCycleHalf;
      payload: GoalSelfReviewPayload;
    }) => goalService.saveSelfReviewDraft(goalId, cycleHalf, payload),
    onSuccess: () => invalidateGoalDrafts(qc),
  });
}

export function useSubmitMentorReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      cycleHalf,
      payload,
    }: {
      goalId: number;
      cycleHalf: SelfReviewCycleHalf;
      payload: GoalMentorReviewPayload;
    }) => goalService.submitMentorReview(goalId, cycleHalf, payload),
    onSuccess: () => invalidateGoalsAndDashboard(qc),
  });
}

export function useSaveMentorReviewDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      cycleHalf,
      payload,
    }: {
      goalId: number;
      cycleHalf: SelfReviewCycleHalf;
      payload: GoalMentorReviewPayload;
    }) => goalService.saveMentorReviewDraft(goalId, cycleHalf, payload),
    onSuccess: () => invalidateGoalDrafts(qc),
  });
}

export function useRemindSelfReview() {
  return useMutation({
    mutationFn: (goalId: number) => goalService.remindSelfReview(goalId),
  });
}

export function useAddCriterion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      payload,
    }: {
      goalId: number;
      payload: CriterionCreatePayload;
    }): Promise<Criterion> => goalService.addCriterion(goalId, payload),
    onSuccess: () => invalidateGoalDrafts(qc),
  });
}

export function useUpdateCriterion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      criterionId,
      payload,
    }: {
      criterionId: number;
      payload: CriterionUpdatePayload;
    }): Promise<Criterion> => goalService.updateCriterion(criterionId, payload),
    onSuccess: () => {
      // Criterion checkbox toggles change progress_percent on the parent
      // goal AND the completion_percent on the dashboard summary.
      invalidateGoalsAndDashboard(qc);
    },
  });
}

export function useUpdateApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      payload,
    }: {
      goalId: number;
      payload: GoalApprovalPayload;
    }) => goalService.updateApproval(goalId, payload),
    onSuccess: () => invalidateGoalsAndDashboard(qc),
  });
}

export function useBulkApprove() {
  const qc = useQueryClient();
  return useMutation<BulkApproveResult, Error, number[]>({
    mutationFn: (goalIds: number[]) => goalService.bulkApprove(goalIds),
    onSuccess: () => invalidateGoalsAndDashboard(qc),
  });
}
