import apiClient from "./api.client";

export interface DashboardSummary {
  total_goals: number;
  // Approval-workflow breakdown of the caller's annual goals
  draft_goals: number;
  submitted_goals: number;
  approved_goals: number;
  changes_requested_goals: number;
  // Criteria-driven completion average across approved annual goals (0–100)
  completion_percent: number;
  active_cycle: string | null;
  mentee_count: number;
}

export const dashboardService = {
  getSummary: async (): Promise<DashboardSummary> => {
    const res = await apiClient.get<DashboardSummary>("/dashboard/summary");
    return res.data;
  },
};
