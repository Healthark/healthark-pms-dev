import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  menteeService,
  type MenteeDetail,
  type MenteeSummary,
} from "../services/mentee.service";

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

// ── Reads ─────────────────────────────────────────────────────────────

export function useMenteeSummaries() {
  return useQuery<MenteeSummary[]>({
    queryKey: menteeSummariesQueryKey,
    queryFn: () => menteeService.getSummaries(),
  });
}

/**
 * Single mentee's full aggregate (goals, reviews, project assignments).
 * Disabled when `menteeId` is null / NaN so route params still in flight
 * don't fire a request.
 */
export function useMenteeDetail(menteeId: number | null) {
  const id = menteeId ?? -1;
  return useQuery<MenteeDetail>({
    queryKey: menteeDetailQueryKey(id),
    queryFn: () => menteeService.getDetail(id),
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
