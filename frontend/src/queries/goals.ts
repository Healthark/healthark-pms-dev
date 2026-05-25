import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  type Criterion,
  type CriterionCreatePayload,
  type CriterionUpdatePayload,
  type BulkApproveResult,
} from "../services/goal.service";
import { dashboardSummaryQueryKey } from "./dashboard";

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
export const teamGoalsQueryKey = (goalType?: GoalType) =>
  ["goals", "team", goalType ?? "all"] as const;

// ── Reads ─────────────────────────────────────────────────────────────

export function useMyGoals(goalType?: GoalType) {
  return useQuery<Goal[]>({
    queryKey: myGoalsQueryKey(goalType),
    queryFn: () => goalService.getMyGoals(goalType),
  });
}

export function useTeamGoals(goalType?: GoalType) {
  return useQuery<TeamGoal[]>({
    queryKey: teamGoalsQueryKey(goalType),
    queryFn: () => goalService.getTeamGoals(goalType),
  });
}

// ── Mutations ─────────────────────────────────────────────────────────

/** Invalidate every goals cache + the dashboard summary. Used by mutations
 *  whose result affects both the goal list and the aggregate counters. */
function invalidateGoalsAndDashboard(
  qc: ReturnType<typeof useQueryClient>,
): void {
  qc.invalidateQueries({ queryKey: goalsQueryKey });
  qc.invalidateQueries({ queryKey: dashboardSummaryQueryKey });
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
    onSuccess: () => {
      // Drafts don't affect dashboard counters; only refresh the goals
      // caches so the editing surface sees the saved state.
      qc.invalidateQueries({ queryKey: goalsQueryKey });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: goalsQueryKey });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: goalsQueryKey });
    },
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
