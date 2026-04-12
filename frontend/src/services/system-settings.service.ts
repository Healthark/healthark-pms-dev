/**
 * system-settings.service.ts — API Contract for the Active Cycle.
 *
 * All system settings API calls funnel through the shared apiClient singleton,
 * which automatically attaches the Bearer token and handles 401 redirects.
 *
 * No raw fetch() or axios imports — we always go through api.client.ts.
 */

import apiClient from "./api.client";

// ── TypeScript Interfaces ───────────────────────────────────────────
// These mirror the Pydantic schemas on the backend exactly.
// If the backend adds a field, it must be added here too.

export type CycleType = "annual" | "half_yearly" | "quarterly";

export interface SystemSettingsResponse {
  id: number;
  org_id: number;
  active_cycle_name: string;
  cycle_type: CycleType;
  cycle_start_date: string | null; // ISO date string from backend
  cycle_end_date: string | null;
  goals_submission_open: boolean;
  reviews_submission_open: boolean;
  updated_by_id: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface SystemSettingsCreate {
  active_cycle_name: string;
  cycle_type?: CycleType;
  cycle_start_date?: string | null;
  cycle_end_date?: string | null;
  goals_submission_open?: boolean;
  reviews_submission_open?: boolean;
}

export interface SystemSettingsUpdate {
  active_cycle_name?: string;
  cycle_type?: CycleType;
  cycle_start_date?: string | null;
  cycle_end_date?: string | null;
  goals_submission_open?: boolean;
  reviews_submission_open?: boolean;
}

// ── Service Object ──────────────────────────────────────────────────

export const systemSettingsService = {
  /**
   * Fetch the current org's system settings.
   * Called by the Topbar on mount and the Admin Panel on load.
   */
  getSettings: async (): Promise<SystemSettingsResponse> => {
    const response = await apiClient.get<SystemSettingsResponse>("/settings/");
    return response.data;
  },

  /**
   * Initialize settings for a new organization (Admin only, one-time).
   */
  createSettings: async (
    data: SystemSettingsCreate,
  ): Promise<SystemSettingsResponse> => {
    const response = await apiClient.post<SystemSettingsResponse>(
      "/settings/",
      data,
    );
    return response.data;
  },

  /**
   * Update the active cycle, submission windows, or date boundaries.
   * Only sends the fields that actually changed (PATCH semantics).
   */
  updateSettings: async (
    data: SystemSettingsUpdate,
  ): Promise<SystemSettingsResponse> => {
    const response = await apiClient.patch<SystemSettingsResponse>(
      "/settings/",
      data,
    );
    return response.data;
  },
};
