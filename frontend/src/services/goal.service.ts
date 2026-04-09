import apiClient from "./api.client";

export type GoalStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface Goal {
  id: number;
  org_id: number;
  user_id: number;
  manager_id: number | null;
  title: string;
  description: string | null;
  status: GoalStatus;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface GoalCreatePayload {
  title: string;
  description?: string | null;
  status?: GoalStatus;
  start_date?: string | null;
  due_date?: string | null;
  user_id: number;
  manager_id?: number | null;
}

export interface GoalUpdatePayload {
  title?: string;
  description?: string | null;
  status?: GoalStatus;
  start_date?: string | null;
  due_date?: string | null;
}

export const goalService = {
  getMyGoals: async (): Promise<Goal[]> => {
    const res = await apiClient.get<Goal[]>("/goals");
    return res.data;
  },

  createGoal: async (payload: GoalCreatePayload): Promise<Goal> => {
    const res = await apiClient.post<Goal>("/goals", payload);
    return res.data;
  },

  updateGoal: async (
    goalId: number,
    payload: GoalUpdatePayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(`/goals/${goalId}`, payload);
    return res.data;
  },
};
