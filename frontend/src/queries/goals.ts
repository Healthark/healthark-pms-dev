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
    // Optimistic update — checkbox toggles are the highest-frequency
    // mutation in the app, and waiting ~150-300 ms for the refetch
    // before the box visibly flips is the most visible source of lag.
    onMutate: async ({ criterionId, payload }) => {
      // Cancel any in-flight refetches so they don't clobber the
      // optimistic value when they settle.
      await qc.cancelQueries({ queryKey: ["goals", "mine"] });
      const snapshot = qc.getQueriesData<Goal[]>({
        queryKey: ["goals", "mine"],
      });
      qc.setQueriesData<Goal[]>(
        { queryKey: ["goals", "mine"] },
        (old) => {
          if (!old) return old;
          return old.map((goal) => {
            const idx = goal.criteria.findIndex((c) => c.id === criterionId);
            if (idx === -1) return goal;
            const nextCriteria = goal.criteria.slice();
            nextCriteria[idx] = { ...nextCriteria[idx], ...payload };
            // Recompute progress_percent so the bar reflects the toggle
            // before the server's authoritative value arrives.
            const total = nextCriteria.length;
            const completed = nextCriteria.filter((c) => c.is_completed).length;
            const progress_percent =
              total === 0 ? 0 : Math.round((completed / total) * 100);
            return { ...goal, criteria: nextCriteria, progress_percent };
          });
        },
      );
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      // Restore every cache entry we touched.
      if (context?.snapshot) {
        for (const [key, data] of context.snapshot) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      // Server is the source of truth for progress_percent + dashboard
      // counters; reconcile after the round-trip.
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
    // Optimistic: flip the row's approval_status (and feedback for
    // request-changes) before the refetch lands. Without this the
    // "Approve" / "Request Changes" buttons feel ~250 ms laggy.
    onMutate: async ({ goalId, payload }) => {
      await qc.cancelQueries({ queryKey: ["goals", "team"] });
      const snapshot = qc.getQueriesData<TeamGoal[]>({
        queryKey: ["goals", "team"],
      });
      qc.setQueriesData<TeamGoal[]>(
        { queryKey: ["goals", "team"] },
        (old) => {
          if (!old) return old;
          return old.map((g) =>
            g.id === goalId
              ? {
                  ...g,
                  approval_status: payload.approval_status,
                  manager_feedback:
                    payload.feedback !== undefined
                      ? payload.feedback
                      : g.manager_feedback,
                }
              : g,
          );
        },
      );
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) {
        for (const [key, data] of context.snapshot) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => invalidateGoalsAndDashboard(qc),
  });
}

export function useBulkApprove() {
  const qc = useQueryClient();
  return useMutation<
    BulkApproveResult,
    Error,
    number[],
    { snapshot: Array<[readonly unknown[], TeamGoal[] | undefined]> }
  >({
    mutationFn: (goalIds: number[]) => goalService.bulkApprove(goalIds),
    // Optimistic: flip every selected goal to "approved" so the modal's
    // pending count and the underlying table both reflect the change
    // before the refetch settles. If the server rejects any of them
    // (failures[]), the onSettled refetch reconciles the row's true
    // state and the consumer surfaces the failure list via a snackbar.
    onMutate: async (goalIds) => {
      await qc.cancelQueries({ queryKey: ["goals", "team"] });
      const snapshot = qc.getQueriesData<TeamGoal[]>({
        queryKey: ["goals", "team"],
      });
      const idSet = new Set(goalIds);
      qc.setQueriesData<TeamGoal[]>(
        { queryKey: ["goals", "team"] },
        (old) => {
          if (!old) return old;
          return old.map((g) =>
            idSet.has(g.id) ? { ...g, approval_status: "approved" } : g,
          );
        },
      );
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) {
        for (const [key, data] of context.snapshot) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => invalidateGoalsAndDashboard(qc),
  });
}
