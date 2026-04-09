import apiClient from "./api.client";

export type GoalStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type ApprovalStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "changes_requested";

export interface Goal {
  id: number;
  org_id: number;
  user_id: number;
  manager_id: number | null;
  title: string;
  description: string | null;
  status: GoalStatus;
  approval_status: ApprovalStatus;
  manager_feedback: string | null;
  progress_notes: string | null;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Extended type for the manager's Team Goals view */
export interface TeamGoal extends Goal {
  owner_name: string;
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
  progress_notes?: string | null;
}

export interface GoalApprovalPayload {
  approval_status: "approved" | "changes_requested";
  feedback?: string | null;
}

export const goalService = {
  // Employee
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

  submitGoal: async (goalId: number): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(`/goals/${goalId}/submit`, {});
    return res.data;
  },

  // Manager
  getTeamGoals: async (): Promise<TeamGoal[]> => {
    const res = await apiClient.get<TeamGoal[]>("/goals/team");
    return res.data;
  },

  updateApproval: async (
    goalId: number,
    payload: GoalApprovalPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/approval`,
      payload,
    );
    return res.data;
  },
};
