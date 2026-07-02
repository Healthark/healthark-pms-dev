/**
 * TanStack hooks for the admin Review Scope tab (per-employee project review
 * scope). Reads one employee's active member projects + their in-scope state;
 * the write applies a new scope and invalidates the ["review-scope"] prefix so
 * the open detail refetches.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminService,
  type EmployeeReviewScope,
  type ReviewScopeUpdatePayload,
} from "../services/admin.service";

/** Broadcast prefix — the scope mutation invalidates this. */
export const reviewScopeQueryKey = ["review-scope"] as const;
export const reviewScopeUserQueryKey = (userId: number | null) =>
  ["review-scope", "user", userId] as const;

/** One employee's active member projects + review-scope state. Gated on a
 *  selection. */
export function useEmployeeReviewScope(userId: number | null) {
  return useQuery<EmployeeReviewScope>({
    queryKey: reviewScopeUserQueryKey(userId),
    queryFn: () => adminService.getEmployeeReviewScope(userId as number),
    enabled: userId != null,
  });
}

export function useUpdateReviewScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: number;
      payload: ReviewScopeUpdatePayload;
    }) => adminService.updateEmployeeReviewScope(userId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: reviewScopeQueryKey }),
  });
}
