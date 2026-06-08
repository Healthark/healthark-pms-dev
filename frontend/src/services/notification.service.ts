import apiClient from "./api.client";

export type NotificationCategory = "personal" | "announcement";

/** A persisted notification row — a personal event or an org-wide announcement. */
export interface StoredNotificationItem {
  id: number;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  /** Relative in-app deep-link (e.g. "/annual-goals?tab=team"); null = no nav. */
  link: string | null;
  created_at: string;
  is_read: boolean;
}

export interface TopbarSummary {
  active_cycle: string | null;
  /** Persisted personal events (Notifications tab). */
  personal: StoredNotificationItem[];
  /** Persisted org-wide announcements (Announcements tab). */
  announcements: StoredNotificationItem[];
}

export const notificationService = {
  getSummary: async (): Promise<TopbarSummary> => {
    const res = await apiClient.get<TopbarSummary>("/notifications/summary");
    return res.data;
  },

  markRead: async (id: number): Promise<void> => {
    await apiClient.post(`/notifications/${id}/mark-read`, {});
  },

  /** Mark all read; pass a category to scope to one Topbar tab. */
  markAllRead: async (category?: NotificationCategory): Promise<void> => {
    await apiClient.post(
      "/notifications/mark-all-read",
      {},
      category ? { params: { category } } : undefined,
    );
  },
};
