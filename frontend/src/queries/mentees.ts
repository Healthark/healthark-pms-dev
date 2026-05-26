import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  menteeService,
  type MenteeProjectAssignment,
  type MenteeSummary,
} from "../services/mentee.service";
import type { TeamGoal } from "../services/goal.service";
import type { AnnualReview } from "../services/annual-review.service";

/**
 * Strict, shared query keys for the mentees domain.
 *
 * Key shape is forward-compatible for Phase E1 — when the backend
 * splits `GET /mentees/{id}/detail` into sub-resources, additional
 * keys like `["mentees", id, "goals"]`, `["mentees", id, "reviews"]`,
 * `["mentees", id, "projects"]` slot in without restructuring.
 *
 * The mentees domain is read-only from the mentor's perspective —
 * there are no write endpoints under `/mentees`. The monolithic
 * detail payload aggregates data owned by goals / annual-reviews /
 * project-reviews, so mutations in *those* modules invalidate
 * `["mentees"]` as part of their broadcast. That replaces the
 * manual `onReload()` callback chain we used pre-migration.
 */
export const menteesQueryKey = ["mentees"] as const;
export const menteeSummariesQueryKey = ["mentees", "list"] as const;
export const menteeDetailQueryKey = (menteeId: number) =>
  ["mentees", menteeId, "detail"] as const;
export const menteeGoalsQueryKey = (menteeId: number) =>
  ["mentees", menteeId, "goals"] as const;
export const menteeReviewsQueryKey = (menteeId: number) =>
  ["mentees", menteeId, "reviews"] as const;
export const menteeProjectsQueryKey = (menteeId: number) =>
  ["mentees", menteeId, "projects"] as const;

// ── Reads ─────────────────────────────────────────────────────────────

export function useMenteeSummaries() {
  return useQuery<MenteeSummary[]>({
    queryKey: menteeSummariesQueryKey,
    queryFn: () => menteeService.getSummaries(),
  });
}

/**
 * Single mentee's identity + rolled-up stats (the MenteeSummary shape).
 * The inline goals/reviews/projects arrays previously returned from
 * `/mentees/{id}/detail` moved to dedicated sub-resource hooks
 * (`useMenteeGoals`, `useMenteeReviews`, `useMenteeProjects`) in PR 19.
 * Disabled when `menteeId` is null / NaN so route params still in
 * flight don't fire a request.
 */
export function useMenteeDetail(menteeId: number | null) {
  const id = menteeId ?? -1;
  return useQuery<MenteeSummary>({
    queryKey: menteeDetailQueryKey(id),
    queryFn: () => menteeService.getDetail(id),
    enabled: menteeId !== null && !Number.isNaN(menteeId),
  });
}

/** Annual goals for a mentee — drives the Goals tab + the Annual
 *  Summary tab's goals section. Each MenteeDetail tab fires its own
 *  fetch on mount; subsequent tab switches are 0 requests. */
export function useMenteeGoals(menteeId: number | null) {
  const id = menteeId ?? -1;
  return useQuery<TeamGoal[]>({
    queryKey: menteeGoalsQueryKey(id),
    queryFn: () => menteeService.getMenteeGoals(id),
    enabled: menteeId !== null && !Number.isNaN(menteeId),
  });
}

/** All annual reviews for a mentee, newest first. Drives the Reviews
 *  tab + the Annual Summary tab's FY picker. */
export function useMenteeReviews(menteeId: number | null) {
  const id = menteeId ?? -1;
  return useQuery<AnnualReview[]>({
    queryKey: menteeReviewsQueryKey(id),
    queryFn: () => menteeService.getMenteeReviews(id),
    enabled: menteeId !== null && !Number.isNaN(menteeId),
  });
}

/** Project assignments with inline review_detail for completed
 *  evaluations. Drives the Projects tab + the Annual Summary tab's
 *  project section. */
export function useMenteeProjects(menteeId: number | null) {
  const id = menteeId ?? -1;
  return useQuery<MenteeProjectAssignment[]>({
    queryKey: menteeProjectsQueryKey(id),
    queryFn: () => menteeService.getMenteeProjects(id),
    enabled: menteeId !== null && !Number.isNaN(menteeId),
  });
}

// ── Cross-domain helper ───────────────────────────────────────────────

/**
 * Invalidate every mentee-detail and the mentee-summaries list.
 * Called from goals / annual-reviews / project-reviews mutation
 * onSuccess broadcasts so the mentor's aggregate stays fresh after
 * any write that touches goal approval, annual reviews, or project
 * review evaluations.
 */
export function invalidateMentees(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: menteesQueryKey });
}
