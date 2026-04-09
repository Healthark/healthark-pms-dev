import apiClient from "./api.client";

export interface NotificationItem {
  type: string;
  message: string;
  count: number;
  severity: "info" | "warning" | "blocking";
}

export interface TopbarSummary {
  active_cycle: string | null;
  notifications: NotificationItem[];
}

export const notificationService = {
  getSummary: async (): Promise<TopbarSummary> => {
    const res = await apiClient.get<TopbarSummary>("/notifications/summary");
    return res.data;
  },
};
