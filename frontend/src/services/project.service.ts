/**
 * project.service.ts — Admin/HR Project Management API.
 *
 * Covers:
 *   Project CRUD:     list, create, getDetail, update, delete
 *   Assignment CRUD:  add, update, remove members
 *
 * All calls go through the shared apiClient singleton.
 */

import apiClient from "./api.client";

// ── Types ───────────────────────────────────────────────────────────

export interface AssignmentResponse {
  id: number;
  project_id: number;
  user_id: number;
  user_name: string;
  assignment_role: string | null;
  evaluator_type: string | null; // "Primary" | "Secondary" | "Peer" | null
  assigned_date: string | null;
  created_at: string;
}

export interface AssignmentCreatePayload {
  user_id: number;
  assignment_role?: string | null;
  evaluator_type?: string | null;
  assigned_date?: string | null;
}

export interface AssignmentUpdatePayload {
  assignment_role?: string | null;
  evaluator_type?: string | null;
  assigned_date?: string | null;
}

export interface ProjectResponse {
  id: number;
  org_id: number;
  project_code: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  allocated_hours: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string | null;
  member_count: number;
}

export interface ProjectDetail extends ProjectResponse {
  assignments: AssignmentResponse[];
}

export interface ProjectCreatePayload {
  project_code: string;
  name: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  allocated_hours?: string | null;
  assignments?: AssignmentCreatePayload[];
}

export interface ProjectUpdatePayload {
  project_code?: string;
  name?: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  allocated_hours?: string | null;
}

// ── Service ─────────────────────────────────────────────────────────

export const projectService = {
  // ── Project CRUD ────────────────────────────────────────────────
  listProjects: async (): Promise<ProjectResponse[]> => {
    const res = await apiClient.get<ProjectResponse[]>("/projects/");
    return res.data;
  },

  createProject: async (
    payload: ProjectCreatePayload,
  ): Promise<ProjectDetail> => {
    const res = await apiClient.post<ProjectDetail>("/projects/", payload);
    return res.data;
  },

  getProjectDetail: async (projectId: number): Promise<ProjectDetail> => {
    const res = await apiClient.get<ProjectDetail>(`/projects/${projectId}`);
    return res.data;
  },

  updateProject: async (
    projectId: number,
    payload: ProjectUpdatePayload,
  ): Promise<ProjectResponse> => {
    const res = await apiClient.patch<ProjectResponse>(
      `/projects/${projectId}`,
      payload,
    );
    return res.data;
  },

  deleteProject: async (projectId: number): Promise<void> => {
    await apiClient.delete(`/projects/${projectId}`);
  },

  // ── Assignment CRUD ─────────────────────────────────────────────
  addAssignment: async (
    projectId: number,
    payload: AssignmentCreatePayload,
  ): Promise<AssignmentResponse> => {
    const res = await apiClient.post<AssignmentResponse>(
      `/projects/${projectId}/assignments`,
      payload,
    );
    return res.data;
  },

  updateAssignment: async (
    assignmentId: number,
    payload: AssignmentUpdatePayload,
  ): Promise<AssignmentResponse> => {
    const res = await apiClient.patch<AssignmentResponse>(
      `/projects/assignments/${assignmentId}`,
      payload,
    );
    return res.data;
  },

  removeAssignment: async (assignmentId: number): Promise<void> => {
    await apiClient.delete(`/projects/assignments/${assignmentId}`);
  },
};