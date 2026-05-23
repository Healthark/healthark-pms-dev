import { useQuery } from "@tanstack/react-query";
import {
  dashboardService,
  type DashboardSummary,
} from "../services/dashboard.service";

/**
 * Strict, shared query key for the dashboard summary read
 * (`GET /dashboard/summary`). Single consumer for now — the `/dashboard`
 * page renders six widgets from this one payload — but lives in
 * `src/queries/` so future consumers (e.g. a sidebar summary chip)
 * automatically dedupe.
 *
 * No mutations: the dashboard is a read-only aggregate computed from
 * goals / reviews / projects. Cross-domain mutations elsewhere
 * (goal-approve, review-submit, etc.) could invalidate this key in a
 * follow-up if the team wants the dashboard to reflect changes without
 * a manual refresh; for now we rely on the default 60s staleTime and
 * the next route navigation to pick up updates.
 */
export const dashboardSummaryQueryKey = ["dashboard", "summary"] as const;

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: dashboardSummaryQueryKey,
    queryFn: () => dashboardService.getSummary(),
  });
}
