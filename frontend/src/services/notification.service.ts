import apiClient from "./api.client";

export interface NotificationItem {
  type: string;
  message: string;
  count: number;
  severity: "info" | "warning" | "blocking";
}

export interface UserNotificationItem {
  id: number;
  message: string;
  goal_id: number;
  created_at: string;
  is_read: boolean;
}

export interface TopbarSummary {
  active_cycle: string | null;
  notifications: NotificationItem[];
  user_notifications: UserNotificationItem[];
}

export const notificationService = {
  getSummary: async (): Promise<TopbarSummary> => {
    const res = await apiClient.get<TopbarSummary>("/notifications/summary");
    return res.data;
  },

  markRead: async (id: number): Promise<void> => {
    await apiClient.post(`/notifications/${id}/mark-read`, {});
  },

  markAllRead: async (): Promise<void> => {
    await apiClient.post("/notifications/mark-all-read", {});
  },
};
