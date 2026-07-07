import apiClient from "./api.client";
import type { DesignationBrief } from "./admin.service";

// ── Types (mirror backend admin_schemas FrameworkResponse) ──────────────

export interface FrameworkCell {
  competency_id: number;
  expectation: string | null;
}

export interface FrameworkCompetency {
  key: string;
  label: string;
  is_reviewable: boolean;
  display_order: number;
  /** level (as a string) → cell; for the default set the single cell is
   *  keyed "default". */
  cells: Record<string, FrameworkCell>;
}

export interface FrameworkResponse {
  is_default: boolean;
  department_id: number | null;
  levels: number[];
  competencies: FrameworkCompetency[];
  designations: DesignationBrief[];
}

/** Cell key used for the org default set (no levels). */
export const DEFAULT_CELL_KEY = "default";

// ── Bulk save (mirror backend admin_schemas FrameworkBulkSave) ──────────

export interface BulkCell {
  /** null for the org default set's single column. */
  level: number | null;
  expectation: string | null;
}

export interface BulkCompetency {
  /** null = a NEW competency (server assigns a unique slug from the label). */
  key: string | null;
  label: string;
  is_reviewable: boolean;
  display_order: number;
  /** true marks an existing competency for soft-deletion. */
  is_deleted: boolean;
  cells: BulkCell[];
}

export interface BulkDesignation {
  id: number;
  level: number | null;
}

export interface FrameworkBulkSave {
  department_id: number | null;
  competencies: BulkCompetency[];
  designations: BulkDesignation[];
}

const BASE = "/admin/competency-framework";

export const competencyFrameworkService = {
  /** The framework matrix for a department, or the org default set (null). */
  getFramework: async (departmentId: number | null): Promise<FrameworkResponse> => {
    const params = departmentId != null ? { department_id: departmentId } : {};
    const res = await apiClient.get<FrameworkResponse>(BASE, { params });
    return res.data;
  },

  createCompetency: async (
    departmentId: number | null,
    label: string,
    isReviewable: boolean,
  ): Promise<FrameworkResponse> => {
    const res = await apiClient.post<FrameworkResponse>(`${BASE}/competencies`, {
      department_id: departmentId,
      label,
      is_reviewable: isReviewable,
    });
    return res.data;
  },

  updateCompetency: async (payload: {
    department_id: number | null;
    key: string;
    label?: string;
    is_reviewable?: boolean;
    display_order?: number;
  }): Promise<FrameworkResponse> => {
    const res = await apiClient.patch<FrameworkResponse>(`${BASE}/competencies`, payload);
    return res.data;
  },

  deleteCompetency: async (
    departmentId: number | null,
    key: string,
  ): Promise<FrameworkResponse> => {
    const params: Record<string, string | number> = { key };
    if (departmentId != null) params.department_id = departmentId;
    const res = await apiClient.delete<FrameworkResponse>(`${BASE}/competencies`, { params });
    return res.data;
  },

  updateCell: async (
    competencyId: number,
    expectation: string | null,
  ): Promise<FrameworkResponse> => {
    const res = await apiClient.patch<FrameworkResponse>(`${BASE}/cells/${competencyId}`, {
      expectation,
    });
    return res.data;
  },

  addLevel: async (departmentId: number, level: number): Promise<FrameworkResponse> => {
    const res = await apiClient.post<FrameworkResponse>(`${BASE}/levels`, {
      department_id: departmentId,
      level,
    });
    return res.data;
  },

  setDesignationLevel: async (
    designationId: number,
    level: number,
  ): Promise<DesignationBrief> => {
    const res = await apiClient.patch<DesignationBrief>(
      `${BASE}/designations/${designationId}`,
      { level },
    );
    return res.data;
  },

  /** Save the whole framework (one department or the org default set) at once —
   *  the editor's Save button. Reconciled server-side in a single transaction. */
  bulkSave: async (payload: FrameworkBulkSave): Promise<FrameworkResponse> => {
    const res = await apiClient.put<FrameworkResponse>(`${BASE}/bulk`, payload);
    return res.data;
  },
};
