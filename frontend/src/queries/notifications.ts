import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notificationService,
  type NotificationCategory,
  type TopbarSummary,
} from "../services/notification.service";

/**
 * Strict, shared query key for the topbar notification summary read
 * (`GET /notifications/summary`). Consumed by the Topbar bell + count
 * dot. The `markAllRead` mutation invalidates this key so the unread
 * count refreshes after the round-trip.
 *
 * Note: this hook does NOT currently set `refetchInterval`. The legacy
 * code didn't poll either — adding polling would be a UX change, not
 * a migration. Toggle on in a follow-up if the team wants live updates.
 */
export const notificationsSummaryQueryKey = [
  "notifications",
  "summary",
] as const;

export function useNotificationsSummary() {
  return useQuery<TopbarSummary>({
    queryKey: notificationsSummaryQueryKey,
    queryFn: () => notificationService.getSummary(),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => notificationService.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsSummaryQueryKey });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    // Optional category scopes the bulk action to one Topbar tab.
    mutationFn: (category?: NotificationCategory) =>
      notificationService.markAllRead(category),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsSummaryQueryKey });
    },
  });
}
