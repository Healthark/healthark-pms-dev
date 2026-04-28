import apiClient from "./api.client";

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
  is_deleted: boolean;
  created_at: string;
  department: DepartmentBrief | null;
  designation: DesignationBrief | null;
}

export interface PasswordResetResponse {
  user_id: number;
  full_name: string;
  email: string;
  /** One-time, time-limited URL of the form `${APP_BASE_URL}/reset-password?token=…`.
   *  The plaintext token is the secret — only its hash is persisted server-side.
   *  Returned to the admin so they can relay it manually if email delivery fails. */
  reset_link: string;
  /** Token TTL — drives the "expires in X minutes" copy in the modal. */
  expires_in_minutes: number;
  /** Whether the backend queued an outbound email to the user. True =
   *  scheduled for background delivery (SMTP is configured); False = SMTP
   *  is unconfigured at the server, so the admin must relay the link
   *  manually. Note: True does not guarantee the message ultimately
   *  reached the inbox — transient SMTP failures are logged server-side
   *  but not surfaced here. If the user reports never receiving it, click
   *  Reset Password again to issue a fresh link. */
  email_sent: boolean;
}

export interface SystemSettings {
  id: number;
  org_id: number;
  active_cycle: string | null;
  cycle_type: string;
  fiscal_start_month: number;
  goals_edit_enabled: boolean;
  annual_goals_edit_enabled: boolean;
  annual_goals_final_rating_visible: boolean;
  project_ratings_visible: boolean;
  annual_reviews_enabled: boolean;
  annual_review_final_rating_visible: boolean;
  updated_at: string | null;
}

export interface AdminSettingsUpdatePayload {
  cycle_type?: string;
  fiscal_start_month?: number;
  goals_edit_enabled?: boolean;
  annual_goals_edit_enabled?: boolean;
  annual_goals_final_rating_visible?: boolean;
  project_ratings_visible?: boolean;
  annual_reviews_enabled?: boolean;
  annual_review_final_rating_visible?: boolean;
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
  getUsers: async (): Promise<UserResponse[]> => {
    const res = await apiClient.get<UserResponse[]>("/admin/users");
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

  resetUserPassword: async (userId: number): Promise<PasswordResetResponse> => {
    const res = await apiClient.post<PasswordResetResponse>(
      `/admin/users/${userId}/reset-password`,
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
