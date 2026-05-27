import apiClient from "./api.client";
import type { Page, PageQuery } from "./pagination";

// ---------------------------------------------------------------------------
// Response types — mirror backend admin_schemas.py exactly
// ---------------------------------------------------------------------------

export interface DepartmentBrief {
  id: number;
  name: string;
}

export interface DesignationBrief {
  id: number;
  name: string;
  level: number;
}

export interface UserResponse {
  id: number;
  org_id: number;
  employee_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  department_id: number | null;
  designation_id: number | null;
  mentor_id: number | null;
  /** Resolved server-side by the paginated /admin/users route (self-join).
   *  Null on the non-paginated /admin/users/all picker list. */
  mentor_name: string | null;
  is_deleted: boolean;
  created_at: string;
  department: DepartmentBrief | null;
  designation: DesignationBrief | null;
}

/** Query params for the paginated Admin users table. */
export interface UserQuery extends PageQuery {
  role?: string;
  status?: "all" | "active" | "inactive";
  department_id?: number;
  designation_id?: number;
}

export interface SystemSettings {
  id: number;
  org_id: number;
  active_cycle: string | null;
  cycle_type: string;
  fiscal_start_month: number;
  goals_edit_enabled: boolean;
  annual_goals_edit_enabled: boolean;
  project_ratings_visible: boolean;
  annual_reviews_enabled: boolean;
  annual_review_final_rating_visible: boolean;
  /** ISO date string set by Admin + management when previewing cycle
   *  behavior at a different point in time. NULL when unset. */
  simulated_today: string | null;
  /** Mirrors the backend's ALLOW_DATE_SIMULATION env flag. UI hides the
   *  Date Simulation control entirely when false. */
  simulation_allowed: boolean;
  updated_at: string | null;
}

export interface AdminSettingsUpdatePayload {
  cycle_type?: string;
  fiscal_start_month?: number;
  goals_edit_enabled?: boolean;
  annual_goals_edit_enabled?: boolean;
  project_ratings_visible?: boolean;
  annual_reviews_enabled?: boolean;
  annual_review_final_rating_visible?: boolean;
  /** ISO date string to pin "today" to. Pair with omitting
   *  clear_simulated_today. Rejected with 400 when ALLOW_DATE_SIMULATION
   *  is false on the backend. */
  simulated_today?: string;
  /** Set true to explicitly null the simulated_today column. PATCH
   *  treats omission as "leave unchanged", so this companion flag is
   *  the only way to express a clear. */
  clear_simulated_today?: boolean;
}

// ---------------------------------------------------------------------------
// Request payload types
// ---------------------------------------------------------------------------

export interface UserCreatePayload {
  employee_code: string;
  full_name: string;
  email: string;
  phone?: string;
  role: string;
  department_id?: number | null;
  designation_id?: number | null;
  mentor_id?: number | null;
  password: string;
}

export interface UserUpdatePayload {
  full_name?: string;
  phone?: string;
  role?: string;
  employee_code?: string;
  department_id?: number | null;
  designation_id?: number | null;
  mentor_id?: number | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const adminService = {
  // Users
  /** Full, non-paginated user list — for client-side pickers
   *  (UserCombobox). Hits /admin/users/all. */
  getUsers: async (): Promise<UserResponse[]> => {
    const res = await apiClient.get<UserResponse[]>("/admin/users/all");
    return res.data;
  },

  /** Paginated user list for the Admin Users table. Server applies
   *  search / role / status / department / designation filtering + sort
   *  + offset pagination. */
  getUsersPage: async (params: UserQuery): Promise<Page<UserResponse>> => {
    const res = await apiClient.get<Page<UserResponse>>("/admin/users", {
      params: {
        page: params.page,
        per_page: params.per_page,
        search: params.search || undefined,
        role: params.role && params.role !== "all" ? params.role : undefined,
        status:
          params.status && params.status !== "all" ? params.status : undefined,
        department_id: params.department_id ?? undefined,
        designation_id: params.designation_id ?? undefined,
        sort_by: params.sort_by || undefined,
        sort_dir: params.sort_by ? params.sort_dir : undefined,
      },
    });
    return res.data;
  },

  createUser: async (payload: UserCreatePayload): Promise<UserResponse> => {
    const res = await apiClient.post<UserResponse>("/admin/users", payload);
    return res.data;
  },

  updateUser: async (
    userId: number,
    payload: UserUpdatePayload,
  ): Promise<UserResponse> => {
    const res = await apiClient.patch<UserResponse>(
      `/admin/users/${userId}`,
      payload,
    );
    return res.data;
  },

  deactivateUser: async (userId: number): Promise<void> => {
    await apiClient.delete(`/admin/users/${userId}`);
  },

  reactivateUser: async (userId: number): Promise<UserResponse> => {
    const res = await apiClient.post<UserResponse>(
      `/admin/users/${userId}/reactivate`,
    );
    return res.data;
  },

  // Reference data (for form dropdowns)
  getDepartments: async (): Promise<DepartmentBrief[]> => {
    const res = await apiClient.get<DepartmentBrief[]>("/admin/departments");
    return res.data;
  },

  getDesignations: async (): Promise<DesignationBrief[]> => {
    const res = await apiClient.get<DesignationBrief[]>("/admin/designations");
    return res.data;
  },

  // System Settings
  getSettings: async (): Promise<SystemSettings> => {
    const res = await apiClient.get<SystemSettings>("/admin/settings");
    return res.data;
  },

  updateSettings: async (payload: AdminSettingsUpdatePayload): Promise<SystemSettings> => {
    const res = await apiClient.patch<SystemSettings>("/admin/settings", payload);
    return res.data;
  },
};
