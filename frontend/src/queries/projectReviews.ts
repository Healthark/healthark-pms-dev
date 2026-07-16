import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  projectReviewService,
  type AdminProjectSummary,
  type CompetencySet,
  type MyProjectCard,
  type PMEvaluationPayload,
  type PMEvaluationDraftPayload,
  type PMPendingReviewCard,
  type ProjectReviewResponse,
  type RoleExpectation,
  type SecondaryEvalCard,
  type SecondaryEvalPayload,
  type SecondaryEvalDraftPayload,
  type SecondaryEvalResponse,
} from "../services/project-review.service";
import { dashboardSummaryQueryKey } from "./dashboard";
import { invalidateMentees } from "./mentees";
import { fyTokenToStartYear } from "../utils/fy";

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
export const reportsToQueueQueryKey = [
  "project-reviews",
  "reports-to-queue",
] as const;
export const roleExpectationsQueryKey = [
  "project-reviews",
  "role-expectations",
] as const;
export const competenciesQueryKey = (
  departmentId: number | null,
  level: number | null,
) => ["project-reviews", "competencies", departmentId ?? "def", level ?? "def"] as const;
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
  return useQuery<SecondaryEvalCard[]>({
    queryKey: secondaryQueueQueryKey,
    queryFn: () => projectReviewService.getSecondaryQueue(),
  });
}

export function useReportsToQueue() {
  return useQuery<PMPendingReviewCard[]>({
    queryKey: reportsToQueueQueryKey,
    queryFn: () => projectReviewService.getReportsToQueue(),
  });
}

export function useRoleExpectations() {
  return useQuery<RoleExpectation[]>({
    queryKey: roleExpectationsQueryKey,
    queryFn: () => projectReviewService.getRoleExpectations(),
    staleTime: ROLE_EXPECTATIONS_STALE_TIME,
  });
}

/** Resolve the competency set for a (department, level) — drives the dynamic
 *  eval form. Null args resolve to the org default set. Cached like role
 *  expectations (competencies change rarely, at seed time). */
export function useCompetencies(
  departmentId: number | null,
  level: number | null,
) {
  return useQuery<CompetencySet>({
    queryKey: competenciesQueryKey(departmentId, level),
    queryFn: () => projectReviewService.getCompetencies(departmentId, level),
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

export function useAllProjectReviews(fyYear?: number | null) {
  return useQuery<ProjectReviewResponse[]>({
    queryKey: [...allProjectReviewsQueryKey, fyYear ?? "all"],
    queryFn: () => projectReviewService.getAllReviews(fyYear),
    // Keep the prior year's rows on screen while the new year loads (no
    // skeleton flash when switching the Year filter).
    placeholderData: keepPreviousData,
  });
}

export function useAllReviewYears() {
  return useQuery<number[]>({
    queryKey: [...allProjectReviewsQueryKey, "years"],
    queryFn: () => projectReviewService.getAllReviewYears(),
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
  // Mentor-side MenteeDetail.project_assignments[].review_detail is
  // derived from the same review rows; keep it fresh.
  invalidateMentees(qc);
}

/** Drafts don't bump dashboard counters but still surface on
 *  MenteeProjectsTab (the saved draft text + flag rides on
 *  review_detail inside MenteeDetail.project_assignments). */
function invalidateProjectReviewDrafts(
  qc: ReturnType<typeof useQueryClient>,
): void {
  qc.invalidateQueries({ queryKey: projectReviewsQueryKey });
  invalidateMentees(qc);
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
    onSuccess: () => invalidateProjectReviewDrafts(qc),
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

type DeleteReviewContext = { backups: Array<[QueryKey, unknown]> };

export function useDeleteProjectReview() {
  const qc = useQueryClient();
  return useMutation<void, Error, number, DeleteReviewContext>({
    mutationFn: (reviewId: number) => projectReviewService.deleteReview(reviewId),
    onMutate: async (reviewId: number) => {
      await qc.cancelQueries({ queryKey: allProjectReviewsQueryKey });
      const prev = qc.getQueriesData({ queryKey: allProjectReviewsQueryKey });
      const backups: Array<[QueryKey, unknown]> = [];
      for (const [qKey, data] of prev) {
        backups.push([qKey, data]);
        if (!data) continue;
        const arr = data as ProjectReviewResponse[];
        const idx = arr.findIndex((r) => r.id === reviewId);
        if (idx === -1) continue;
        const target = arr[idx];
        const fy = target.cycle ? fyTokenToStartYear(target.cycle) : null;
        // Remove the deleted review from this cached query
        let newArr = arr.filter((r) => r.id !== reviewId);
        // If this removal makes the group disappear, insert a lightweight placeholder
        const groupStillExists = newArr.some((r) => {
          const rfy = r.cycle ? fyTokenToStartYear(r.cycle) : null;
          return r.user_id === target.user_id && r.project_id === target.project_id && rfy === fy;
        });
        if (!groupStillExists) {
          const placeholder: ProjectReviewResponse = {
            ...target,
            id: -(Math.abs(reviewId)),
            reviewer_id: null,
            reviewer_name: null,
            status: "pending",
            comments: null,
            competencies: undefined,
            secondary_evaluations: [],
            created_at: new Date().toISOString(),
            updated_at: null,
          };
          newArr = [...newArr, placeholder];
        }
        qc.setQueryData(qKey, newArr);
      }
      return { backups };
    },
    onError: (_err, _variables, context) => {
      // rollback
      if (context?.backups) {
        for (const [qKey, data] of context.backups) {
          qc.setQueryData(qKey, data as unknown);
        }
      }
    },
    onSettled: () => invalidateProjectReviewsAndDashboard(qc),
  });
}

export function useSubmitReportsToEvaluation() {
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
    }) => projectReviewService.submitReportsToEvaluation(projectId, userId, payload),
    onSuccess: () => invalidateProjectReviewsAndDashboard(qc),
  });
}

export function useSaveReportsToDraft() {
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
    }) => projectReviewService.saveReportsToDraft(projectId, userId, payload),
    onSuccess: () => invalidateProjectReviewDrafts(qc),
  });
}

export function useSubmitSecondaryEval() {
  const qc = useQueryClient();
  return useMutation<
    SecondaryEvalResponse,
    Error,
    { projectId: number; userId: number; payload: SecondaryEvalPayload }
  >({
    mutationFn: ({ projectId, userId, payload }) =>
      projectReviewService.submitSecondaryEval(projectId, userId, payload),
    onSuccess: () => invalidateProjectReviewsAndDashboard(qc),
  });
}

export function useSaveSecondaryDraft() {
  const qc = useQueryClient();
  return useMutation<
    SecondaryEvalResponse,
    Error,
    { projectId: number; userId: number; payload: SecondaryEvalDraftPayload }
  >({
    mutationFn: ({ projectId, userId, payload }) =>
      projectReviewService.saveSecondaryDraft(projectId, userId, payload),
    onSuccess: () => invalidateProjectReviewDrafts(qc),
  });
}

export function useUpdateSecondaryEval() {
  const qc = useQueryClient();
  return useMutation<
    SecondaryEvalResponse,
    Error,
    { projectId: number; userId: number; payload: SecondaryEvalPayload }
  >({
    mutationFn: ({ projectId, userId, payload }) =>
      projectReviewService.updateSecondaryEval(projectId, userId, payload),
    onSuccess: () => invalidateProjectReviewsAndDashboard(qc),
  });
}
