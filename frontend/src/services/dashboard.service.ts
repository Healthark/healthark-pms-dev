import apiClient from "./api.client";

export interface DashboardSummary {
  total_goals: number;
  pending_goals: number;
  in_progress_goals: number;
  completed_goals: number;
  active_cycle: string | null;
  mentee_count: number;
}

export const dashboardService = {
  getSummary: async (): Promise<DashboardSummary> => {
    const res = await apiClient.get<DashboardSummary>("/dashboard/summary");
    return res.data;
  },
};
