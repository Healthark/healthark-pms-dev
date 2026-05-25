import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  projectReviewService,
  type AdminProjectSummary,
  type MyProjectCard,
  type PMEvaluationPayload,
  type PMEvaluationDraftPayload,
  type PMPendingReviewCard,
  type ProjectReviewResponse,
  type RoleExpectation,
  type SecondaryEvalPayload,
  type SecondaryEvalDraftPayload,
  type SecondaryEvalResponse,
} from "../services/project-review.service";
import { dashboardSummaryQueryKey } from "./dashboard";

/**
 * Strict, shared query keys for the project-reviews domain.
 *
 * Top-level `projectReviewsQueryKey` is the invalidation broadcast —
 * every mutation invalidates it, which catches mine/pm-queue/
 * secondary-queue/detail/all/management sub-keys in one shot.
 *
 * Status-changing mutations (submit / update) additionally invalidate
 * `['dashboard', 'summary']` so the dashboard counters
 * (project_reviews_pending_primary / _secondary) stay fresh.
 */
export const projectReviewsQueryKey = ["project-reviews"] as const;
export const myProjectReviewsQueryKey = ["project-reviews", "mine"] as const;
export const pmQueueQueryKey = ["project-reviews", "pm-queue"] as const;
export const secondaryQueueQueryKey = [
  "project-reviews",
  "secondary-queue",
] as const;
export const roleExpectationsQueryKey = [
  "project-reviews",
  "role-expectations",
] as const;
export const projectReviewDetailQueryKey = (reviewId: number) =>
  ["project-reviews", "detail", reviewId] as const;
export const allProjectReviewsQueryKey = [
  "project-reviews",
  "all",
] as const;
export const managementViewQueryKey = (cycle?: string) =>
  ["project-reviews", "management", cycle ?? "current"] as const;

// Role expectations almost never change — quarterly at most. Long
// staleTime keeps it cached across the whole session.
const ROLE_EXPECTATIONS_STALE_TIME = 15 * 60_000;

// ── Reads ─────────────────────────────────────────────────────────────

export function useMyProjectReviews() {
  return useQuery<MyProjectCard[]>({
    queryKey: myProjectReviewsQueryKey,
    queryFn: () => projectReviewService.getMyProjects(),
  });
}

export function usePMQueue() {
  return useQuery<PMPendingReviewCard[]>({
    queryKey: pmQueueQueryKey,
    queryFn: () => projectReviewService.getPMQueue(),
  });
}

export function useSecondaryQueue() {
  return useQuery<ProjectReviewResponse[]>({
    queryKey: secondaryQueueQueryKey,
    queryFn: () => projectReviewService.getSecondaryQueue(),
  });
}

export function useRoleExpectations() {
  return useQuery<RoleExpectation[]>({
    queryKey: roleExpectationsQueryKey,
    queryFn: () => projectReviewService.getRoleExpectations(),
    staleTime: ROLE_EXPECTATIONS_STALE_TIME,
  });
}

/**
 * Single review detail. Replaces the `useReviewDetails` reducer hook —
 * use the standard useQuery state shape (`data` / `isPending` / `error`)
 * instead of the reducer's `details` / `isFetching` / `error`.
 */
export function useProjectReviewDetail(reviewId: number | null) {
  return useQuery<ProjectReviewResponse>({
    queryKey: projectReviewDetailQueryKey(reviewId ?? -1),
    queryFn: () => projectReviewService.getReview(reviewId as number),
    enabled: reviewId !== null,
  });
}

export function useAllProjectReviews() {
  return useQuery<ProjectReviewResponse[]>({
    queryKey: allProjectReviewsQueryKey,
    queryFn: () => projectReviewService.getAllReviews(),
  });
}

export function useManagementView(cycle?: string) {
  return useQuery<AdminProjectSummary[]>({
    queryKey: managementViewQueryKey(cycle),
    queryFn: () => projectReviewService.getManagementView(cycle),
  });
}

// ── Mutations ─────────────────────────────────────────────────────────

function invalidateProjectReviewsAndDashboard(
  qc: ReturnType<typeof useQueryClient>,
): void {
  qc.invalidateQueries({ queryKey: projectReviewsQueryKey });
  qc.invalidateQueries({ queryKey: dashboardSummaryQueryKey });
}

export function useSubmitPMEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      userId,
      payload,
    }: {
      projectId: number;
      userId: number;
      payload: PMEvaluationPayload;
    }) => projectReviewService.submitPMEvaluation(projectId, userId, payload),
    onSuccess: () => invalidateProjectReviewsAndDashboard(qc),
  });
}

export function useSavePMDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      userId,
      payload,
    }: {
      projectId: number;
      userId: number;
      payload: PMEvaluationDraftPayload;
    }) => projectReviewService.savePMDraft(projectId, userId, payload),
    onSuccess: () => {
      // Drafts don't affect dashboard counters; only refresh the
      // project-reviews caches so the editing surface sees the saved
      // state and the queue's "has_draft_content" flag updates.
      qc.invalidateQueries({ queryKey: projectReviewsQueryKey });
    },
  });
}

export function useUpdateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reviewId,
      payload,
    }: {
      reviewId: number;
      payload: PMEvaluationPayload;
    }) => projectReviewService.updateReview(reviewId, payload),
    onSuccess: () => invalidateProjectReviewsAndDashboard(qc),
  });
}

export function useSubmitSecondaryEval() {
  const qc = useQueryClient();
  return useMutation<
    SecondaryEvalResponse,
    Error,
    { reviewId: number; payload: SecondaryEvalPayload }
  >({
    mutationFn: ({ reviewId, payload }) =>
      projectReviewService.submitSecondaryEval(reviewId, payload),
    onSuccess: () => invalidateProjectReviewsAndDashboard(qc),
  });
}

export function useSaveSecondaryDraft() {
  const qc = useQueryClient();
  return useMutation<
    SecondaryEvalResponse,
    Error,
    { reviewId: number; payload: SecondaryEvalDraftPayload }
  >({
    mutationFn: ({ reviewId, payload }) =>
      projectReviewService.saveSecondaryDraft(reviewId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectReviewsQueryKey });
    },
  });
}

export function useUpdateSecondaryEval() {
  const qc = useQueryClient();
  return useMutation<
    SecondaryEvalResponse,
    Error,
    { reviewId: number; payload: SecondaryEvalPayload }
  >({
    mutationFn: ({ reviewId, payload }) =>
      projectReviewService.updateSecondaryEval(reviewId, payload),
    onSuccess: () => invalidateProjectReviewsAndDashboard(qc),
  });
}
