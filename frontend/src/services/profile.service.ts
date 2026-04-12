/**
 * profile.service.ts — Self-Service API for the Profile Page.
 *
 * Two calls:
 *   getProfile()      → GET  /users/me          (rich profile data)
 *   changePassword()  → POST /users/me/password  (current + new password)
 *
 * All calls go through the shared apiClient singleton which handles
 * Bearer token injection and global 401 redirects automatically.
 */

import apiClient from "./api.client";

// ── Response Types ──────────────────────────────────────────────────

export interface UserProfile {
  id: number;
  org_id: number;
  org_name: string;
  employee_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  avatar_url: string | null;
  department: string | null;
  designation: string | null;
  mentor_name: string | null;
  created_at: string;
}

// ── Request Types ───────────────────────────────────────────────────

export interface PasswordChangePayload {
  current_password: string;
  new_password: string;
}

// ── Service ─────────────────────────────────────────────────────────

export const profileService = {
  /** Fetch the authenticated user's full profile for the Profile page. */
  getProfile: async (): Promise<UserProfile> => {
    const res = await apiClient.get<UserProfile>("/users/me");
    return res.data;
  },

  /** Change the current user's password. Requires the current password. */
  changePassword: async (payload: PasswordChangePayload): Promise<void> => {
    await apiClient.post("/users/me/password", payload);
  },
};
