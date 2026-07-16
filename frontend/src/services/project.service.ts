/**
 * project.service.ts — Admin/HR Project Management API (Revised).
 *
 * Changes:
 *   - Removed allocated_hours
 *   - expected_end_date instead of end_date
 *   - Added reports_to_id/reports_to_name on Project (required on create)
 *   - Added pm_id/pm_name on Project (Primary evaluator, resolved server-side)
 *   - Added secondary_evaluator_id/secondary_evaluator_name on Project (single,
 *     project-level Secondary; replaces multi-row Secondary assignments)
 *   - Added department_id/department_name on Assignment
 *   - Assignment.evaluator_type: "Primary" | null only
 */

import apiClient from "./api.client";
import type { Page, PageQuery } from "./pagination";

// ── Types ───────────────────────────────────────────────────────────

export interface AssignmentResponse {
  id: number;
  project_id: number;
  user_id: number;
  user_name: string;
  assignment_role: string | null;
  department_id: number | null;
  department_name: string | null;
  evaluator_type: string | null; // "Primary" | "Secondary" | null
  assigned_date: string | null;
  /** Multi-PM hierarchy: the member's PM + per-member Secondary, with names
   *  resolved for display. Null on single-PM projects. */
  manager_id: number | null;
  manager_name: string | null;
  secondary_evaluator_id: number | null;
  secondary_evaluator_name: string | null;
  created_at: string;
  /** Soft-delete audit. is_deleted members render greyed at the bottom of the
   *  team list; removed_by_name/removed_at power the "… was removed by … on …"
   *  line. Active members have is_deleted=false and null removal fields. */
  is_deleted: boolean;
  removed_at: string | null;
  removed_by_name: string | null;
}

export interface AssignmentCreatePayload {
  user_id: number;
  assignment_role?: string | null;
  department_id?: number | null;
  evaluator_type?: "Primary" | null;
  assigned_date?: string | null;
  /** Multi-PM: the PM who evaluates this member (null = top PM). */
  manager_id?: number | null;
  secondary_evaluator_id?: number | null;
}

export interface AssignmentUpdatePayload {
  assignment_role?: string | null;
  department_id?: number | null;
  evaluator_type?: "Primary" | null;
  assigned_date?: string | null;
  manager_id?: number | null;
  secondary_evaluator_id?: number | null;
}

export interface ProjectResponse {
  id: number;
  org_id: number;
  project_code: string;
  name: string;
  description: string | null;
  start_date: string | null;
  expected_end_date: string | null;
  reports_to_id: number | null;
  reports_to_name: string | null;
  pm_id: number | null;
  pm_name: string | null;
  secondary_evaluator_id: number | null;
  secondary_evaluator_name: string | null;
  status: "active" | "completed";
  completed_at: string | null;
  completed_by_name: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string | null;
  member_count: number;
  /** When true the team uses a PM hierarchy (per-member manager + secondary). */
  multi_pm_enabled: boolean;
}

export interface ProjectDetail extends ProjectResponse {
  assignments: AssignmentResponse[];
}

/** Query params for the paginated Projects table. */
export interface ProjectQuery extends PageQuery {
  status?: "all" | "active" | "completed";
  year?: number;
  pm?: string;
  /** Only projects with no active PM (mutually exclusive with `pm`). */
  no_pm?: boolean;
}

/** Year + PM dropdown options for the Projects tab filters. */
export interface ProjectsFilterOptions {
  years: number[];
  pms: string[];
}

export interface ProjectCreatePayload {
  project_code: string;
  name: string;
  description?: string | null;
  start_date?: string | null;
  expected_end_date?: string | null;
  // Required by the backend Pydantic validator.
  reports_to_id: number;
  secondary_evaluator_id?: number | null;
  // Single-PM: exactly one entry with evaluator_type === "Primary".
  // Multi-PM: any number of members with manager_id null (top-level PMs).
  assignments: AssignmentCreatePayload[];
  /** Multi-PM mode: members carry per-member manager_id + secondary_evaluator_id. */
  multi_pm_enabled?: boolean;
}

export interface ProjectUpdatePayload {
  project_code?: string;
  name?: string;
  description?: string | null;
  start_date?: string | null;
  expected_end_date?: string | null;
  reports_to_id?: number | null;
  secondary_evaluator_id?: number | null;
  multi_pm_enabled?: boolean;
}

// ── Service ─────────────────────────────────────────────────────────

export const projectService = {
  /** Paginated project list for the Admin Projects table. Server applies
   *  search / status / year / PM filtering + sort + pagination. */
  listProjects: async (params: ProjectQuery): Promise<Page<ProjectResponse>> => {
    const res = await apiClient.get<Page<ProjectResponse>>("/projects/", {
      params: {
        page: params.page,
        per_page: params.per_page,
        search: params.search || undefined,
        status:
          params.status && params.status !== "all" ? params.status : undefined,
        year: params.year ?? undefined,
        pm: params.pm || undefined,
        no_pm: params.no_pm || undefined,
        sort_by: params.sort_by || undefined,
        sort_dir: params.sort_by ? params.sort_dir : undefined,
      },
    });
    return res.data;
  },

  /** Year + PM dropdown options for the Projects tab filters. */
  getProjectsFilterOptions: async (): Promise<ProjectsFilterOptions> => {
    const res = await apiClient.get<ProjectsFilterOptions>(
      "/projects/filter-options",
    );
    return res.data;
  },

  createProject: async (payload: ProjectCreatePayload): Promise<ProjectDetail> => {
    const res = await apiClient.post<ProjectDetail>("/projects/", payload);
    return res.data;
  },

  getProjectDetail: async (projectId: number): Promise<ProjectDetail> => {
    const res = await apiClient.get<ProjectDetail>(`/projects/${projectId}`);
    return res.data;
  },

  updateProject: async (projectId: number, payload: ProjectUpdatePayload): Promise<ProjectResponse> => {
    const res = await apiClient.patch<ProjectResponse>(`/projects/${projectId}`, payload);
    return res.data;
  },

  deleteProject: async (projectId: number): Promise<void> => {
    await apiClient.delete(`/projects/${projectId}`);
  },

  addAssignment: async (projectId: number, payload: AssignmentCreatePayload): Promise<AssignmentResponse> => {
    const res = await apiClient.post<AssignmentResponse>(`/projects/${projectId}/assignments`, payload);
    return res.data;
  },

  updateAssignment: async (assignmentId: number, payload: AssignmentUpdatePayload): Promise<AssignmentResponse> => {
    const res = await apiClient.patch<AssignmentResponse>(`/projects/assignments/${assignmentId}`, payload);
    return res.data;
  },

  removeAssignment: async (assignmentId: number): Promise<void> => {
    await apiClient.delete(`/projects/assignments/${assignmentId}`);
  },

  /** Re-add a soft-removed member (clears the removal marker). */
  restoreAssignment: async (assignmentId: number): Promise<AssignmentResponse> => {
    const res = await apiClient.post<AssignmentResponse>(
      `/projects/assignments/${assignmentId}/restore`,
    );
    return res.data;
  },

  /** Admin-only. Marks the project completed. Idempotent — re-completing
   *  an already-completed project returns its current state. The team
   *  list is preserved across complete/reopen. */
  markComplete: async (projectId: number): Promise<ProjectResponse> => {
    const res = await apiClient.post<ProjectResponse>(
      `/projects/${projectId}/complete`,
    );
    return res.data;
  },

  /** Admin-only. Re-opens a completed project. Idempotent. The team
   *  list (preserved on complete) returns intact. */
  reopen: async (projectId: number): Promise<ProjectResponse> => {
    const res = await apiClient.post<ProjectResponse>(
      `/projects/${projectId}/reopen`,
    );
    return res.data;
  },
};