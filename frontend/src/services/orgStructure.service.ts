import apiClient from "./api.client";
import type { DepartmentBrief, DesignationBrief } from "./admin.service";

// ── Types (mirror backend admin_schemas OrgStructureResponse) ───────────

export interface OrgDesignation {
  id: number;
  name: string;
  level: number | null;
  department_id: number | null;
  is_active: boolean;
  /** Active (non-deleted) users still assigned this role — shown before deactivate. */
  active_user_count: number;
}

export interface OrgDepartment {
  id: number;
  name: string;
  is_active: boolean;
  active_user_count: number;
  designations: OrgDesignation[];
}

export interface OrgStructure {
  departments: OrgDepartment[];
  /** Legacy roles with no department (predate scoping) — rename/deactivate only. */
  unscoped_designations: OrgDesignation[];
}

export interface DesignationCreatePayload {
  name: string;
  department_id: number;
  level?: number;
}

const BASE = "/admin";

export const orgStructureService = {
  /** Full structure incl. inactive rows + active-user counts (admin tab only). */
  get: async (): Promise<OrgStructure> => {
    const res = await apiClient.get<OrgStructure>(`${BASE}/organization`);
    return res.data;
  },

  createDepartment: async (name: string): Promise<DepartmentBrief> => {
    const res = await apiClient.post<DepartmentBrief>(`${BASE}/departments`, { name });
    return res.data;
  },
  renameDepartment: async (id: number, name: string): Promise<DepartmentBrief> => {
    const res = await apiClient.patch<DepartmentBrief>(`${BASE}/departments/${id}`, { name });
    return res.data;
  },
  deactivateDepartment: async (id: number): Promise<DepartmentBrief> => {
    const res = await apiClient.post<DepartmentBrief>(`${BASE}/departments/${id}/deactivate`);
    return res.data;
  },
  reactivateDepartment: async (id: number): Promise<DepartmentBrief> => {
    const res = await apiClient.post<DepartmentBrief>(`${BASE}/departments/${id}/reactivate`);
    return res.data;
  },

  createDesignation: async (payload: DesignationCreatePayload): Promise<DesignationBrief> => {
    const res = await apiClient.post<DesignationBrief>(`${BASE}/designations`, payload);
    return res.data;
  },
  renameDesignation: async (id: number, name: string): Promise<DesignationBrief> => {
    const res = await apiClient.patch<DesignationBrief>(`${BASE}/designations/${id}`, { name });
    return res.data;
  },
  deactivateDesignation: async (id: number): Promise<DesignationBrief> => {
    const res = await apiClient.post<DesignationBrief>(`${BASE}/designations/${id}/deactivate`);
    return res.data;
  },
  reactivateDesignation: async (id: number): Promise<DesignationBrief> => {
    const res = await apiClient.post<DesignationBrief>(`${BASE}/designations/${id}/reactivate`);
    return res.data;
  },
};
