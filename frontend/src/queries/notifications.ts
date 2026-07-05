import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notificationService,
  type NotificationCategory,
  type TopbarSummary,
} from "../services/notification.service";

/**
 * Strict, shared query key for the topbar notification summary read
 * (`GET /notifications/summary`). Consumed by the Topbar bell + count
 * dot and the new-notification toast watcher. The `markAllRead` mutation
 * invalidates this key so the unread count refreshes after the round-trip.
 */
export const notificationsSummaryQueryKey = [
  "notifications",
  "summary",
] as const;

// Poll cadence for live notifications. There's no push channel (websocket/SSE),
// so a genuinely-new notification surfaces on the next poll — worst-case this
// many ms after it's created. `refetchIntervalInBackground` is left at its
// default (false), so we don't poll a hidden tab; `refetchOnWindowFocus` below
// catches the user up the moment they return.
export const NOTIFICATIONS_POLL_MS = 30_000;

export function useNotificationsSummary() {
  return useQuery<TopbarSummary>({
    queryKey: notificationsSummaryQueryKey,
    queryFn: () => notificationService.getSummary(),
    refetchInterval: NOTIFICATIONS_POLL_MS,
    refetchOnWindowFocus: true,
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
