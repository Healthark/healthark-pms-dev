/**
 * TanStack hooks for the admin Goal Access tab (per-employee gate exceptions).
 *
 * Reads: the org-wide active-grants overview + one employee's detail. Writes:
 * grant/adjust, revoke, and throw-a-goal-back-to-draft. Every mutation returns
 * the affected employee's refreshed detail and broadcasts an invalidation on
 * the ["goal-access"] prefix so both the overview and any open detail refetch.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminService,
  type GoalAccessDetail,
  type GoalAccessGrant,
  type GoalAccessGrantUpdatePayload,
} from "../services/admin.service";

/** Broadcast prefix — every grant/revoke/revert invalidates this. */
export const goalAccessQueryKey = ["goal-access"] as const;
export const goalAccessGrantsQueryKey = ["goal-access", "grants"] as const;
export const goalAccessUserQueryKey = (userId: number | null) =>
  ["goal-access", "user", userId] as const;

/** All active per-employee grants — the overview/revoke table. */
export function useGoalAccessGrants() {
  return useQuery<GoalAccessGrant[]>({
    queryKey: goalAccessGrantsQueryKey,
    queryFn: () => adminService.getGoalAccessGrants(),
  });
}

/** One employee's grants + their active-FY annual goals. Gated on a selection. */
export function useGoalAccessForUser(userId: number | null) {
  return useQuery<GoalAccessDetail>({
    queryKey: goalAccessUserQueryKey(userId),
    queryFn: () => adminService.getGoalAccessForUser(userId as number),
    enabled: userId != null,
  });
}

export function useSetGoalAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: number;
      payload: GoalAccessGrantUpdatePayload;
    }) => adminService.setGoalAccess(userId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: goalAccessQueryKey }),
  });
}

export function useRevokeGoalAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      periodLabel,
    }: {
      userId: number;
      periodLabel?: string;
    }) => adminService.revokeGoalAccess(userId, periodLabel),
    onSuccess: () => qc.invalidateQueries({ queryKey: goalAccessQueryKey }),
  });
}

export function useRevertGoalToDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (goalId: number) => adminService.revertGoalToDraft(goalId),
    onSuccess: () => qc.invalidateQueries({ queryKey: goalAccessQueryKey }),
  });
}
