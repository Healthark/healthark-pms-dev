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
  /** May be null for an intentionally unleveled role (blank in the competency
   *  matrix) — it maps to no level column in the framework. */
  level: number | null;
  /** Home department — roles are department-scoped. Null only for legacy/
   *  unscoped rows. Used to filter the role dropdown by the chosen department
   *  and to infer the department from a chosen role. */
  department_id: number | null;
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
}

/** Per-fiscal-year access configuration types. The System Settings tab's
 *  Year dropdown drives which FY's row is loaded; each FY has its own copy
 *  of the four access toggles, so HR can keep past-year reviews editable
 *  even after the system advances into the next fiscal year. */

export interface YearOption {
  period_label: string;
  is_current: boolean;
  has_override: boolean;
}

export interface YearOptionsResponse {
  /** FY options for the Annual Review dropdown ("FY26-27"). */
  years: YearOption[];
  /** Half options for the Goals & Project dropdown ("H1 FY26-27"). */
  halves: YearOption[];
}

export interface YearSettingsResponse {
  period_label: string;
  annual_reviews_enabled: boolean;
  annual_review_final_rating_visible: boolean;
  annual_review_mentor_rating_visible: boolean;
  annual_goals_edit_enabled: boolean;
  project_ratings_visible: boolean;
  annual_goals_final_rating_visible: boolean;
  management_review_enabled: boolean;
  is_current: boolean;
  updated_at: string | null;
}

export interface YearSettingsUpdatePayload {
  annual_reviews_enabled?: boolean;
  annual_review_final_rating_visible?: boolean;
  annual_review_mentor_rating_visible?: boolean;
  annual_goals_edit_enabled?: boolean;
  project_ratings_visible?: boolean;
  annual_goals_final_rating_visible?: boolean;
  management_review_enabled?: boolean;
}

export interface YearPreflightEntry {
  in_flight_count: number;
  warning: string | null;
}

export interface YearPreflightResponse {
  period_label: string;
  annual_goals_edit_enabled: YearPreflightEntry;
  annual_reviews_enabled: YearPreflightEntry;
  project_ratings_visible: YearPreflightEntry;
  annual_review_final_rating_visible: YearPreflightEntry;
  annual_review_mentor_rating_visible: YearPreflightEntry;
  annual_goals_final_rating_visible: YearPreflightEntry;
  management_review_enabled: YearPreflightEntry;
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
  password?: string;
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

/** Delivery channel for an Admin Notify broadcast. */
export type NotifyChannel = "email" | "in_app" | "both";

/** Body for the Admin "Notify" broadcast (POST /admin/notify).
 *  Recipients = active org users narrowed by the (AND-combined) filters;
 *  with no filter set, everyone is targeted. */
export interface AdminNotifyPayload {
  subject: string;
  body: string;
  /** Restrict to these specific users (any of); empty = no user filter. */
  user_ids: number[];
  /** Restrict to these departments (any of); empty = no department filter. */
  department_ids: number[];
  /** "in_app" = bell only, "email" = email only, "both" = both. */
  channel: NotifyChannel;
}

/** Mentor/PM coverage gaps surfaced as the Admin-Panel warning banner. */
export interface CoverageGapEntity {
  id: number;
  name: string;
}
export interface CoverageGaps {
  orphaned_mentees: CoverageGapEntity[];
  pm_less_projects: CoverageGapEntity[];
}

export interface AdminNotifyResult {
  recipients: number;
  emailed: boolean;
}

// ── Cycle roll-out ──────────────────────────────────────────────────
// The active cycle is admin-advanced (manual), not date-derived.

export interface CycleEffects {
  from_cycle: string;
  to_cycle: string;
  /** True when advancing changes the FY (heavyweight transition). */
  fy_rollover: boolean;
  /** The FE requires a typed confirmation for the (irreversible) FY rollover. */
  requires_typed_confirmation: boolean;
}

export interface CycleStatus {
  active_cycle: string;
  next_cycle: string;
  /** The cycle the org was on before the most recent change — drives the
   *  one-click "Roll back" action. null when the cycle has never changed. */
  previous_cycle: string | null;
  effects: CycleEffects;
}

export interface CycleSetPayload {
  /** Strict cycle label, e.g. "H1 FY26-27". */
  target_cycle: string;
}

// ── Goal access overrides (per-employee gate exceptions) ─────────────

/** One active per-employee goal-access grant (overview row). Mirrors backend
 *  GoalAccessGrantResponse. */
export interface GoalAccessGrant {
  user_id: number;
  user_name: string;
  employee_code: string;
  period_label: string;
  allow_create: boolean;
  allow_edit: boolean;
  note: string | null;
  granted_by_name: string | null;
  granted_at: string | null;
}

/** A goal row in the Goal Access detail view. Mirrors backend AdminGoalBrief.
 *  `can_revert` is true only for an 'approved' goal (the sole revertible state). */
export interface AdminGoalBrief {
  id: number;
  title: string;
  approval_status: string;
  cycle_name: string | null;
  period_label: string | null;
  can_revert: boolean;
}

/** GET /admin/goal-access/{user_id} payload — the employee's active grants plus
 *  their active-FY annual goals. Mirrors backend GoalAccessDetailResponse. */
export interface GoalAccessDetail {
  user_id: number;
  user_name: string;
  employee_code: string;
  active_period_label: string | null;
  grants: GoalAccessGrant[];
  goals: AdminGoalBrief[];
}

/** PATCH /admin/goal-access/{user_id} body — only the flags sent are written;
 *  period_label defaults to the active half server-side. */
export interface GoalAccessGrantUpdatePayload {
  allow_create?: boolean;
  allow_edit?: boolean;
  note?: string | null;
  period_label?: string;
}

// ── Project review eligibility (per-project, org-wide) ───────────────

/** One active project with its review-eligibility — a checkbox row in the
 *  Review Eligibility tab. Mirrors backend ReviewEligibilityProject. */
export interface ReviewEligibilityProject {
  project_id: number;
  project_name: string;
  project_code: string;
  is_billable: boolean;
  review_eligible: boolean;
}

/** GET /admin/review-eligibility query — page/per_page + name/code search +
 *  optional billable filter (true = billable, false = non-billable, omitted = all). */
export interface ReviewEligibilityQuery {
  page: number;
  per_page: number;
  search?: string;
  billable?: boolean;
}

/** PATCH /admin/review-eligibility body — only the listed projects change. */
export interface ReviewEligibilityUpdatePayload {
  projects: { project_id: number; review_eligible: boolean }[];
}

/** PATCH /admin/review-eligibility response — how many projects changed. */
export interface ReviewEligibilityUpdateResult {
  updated: number;
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

  /** Live mentor/PM coverage gaps for the Admin-Panel warning banner. */
  getCoverageGaps: async (): Promise<CoverageGaps> => {
    const res = await apiClient.get<CoverageGaps>("/admin/coverage-gaps");
    return res.data;
  },

  updateSettings: async (payload: AdminSettingsUpdatePayload): Promise<SystemSettings> => {
    const res = await apiClient.patch<SystemSettings>("/admin/settings", payload);
    return res.data;
  },

  // ── Per-FY access configuration ─────────────────────────────────
  // The System Settings tab's Year dropdown loads via listSettingsYears();
  // the four toggles below it bind to the row returned by getYearSettings.
  // Save fires updateYearSettings (PATCH) with all four values for the
  // selected FY. getYearPreflight powers the confirmation modal's
  // in-flight impact warning.

  listSettingsYears: async (): Promise<YearOptionsResponse> => {
    const res = await apiClient.get<YearOptionsResponse>(
      "/admin/settings/years",
    );
    return res.data;
  },

  getYearSettings: async (fyLabel: string): Promise<YearSettingsResponse> => {
    const res = await apiClient.get<YearSettingsResponse>(
      `/admin/settings/year/${encodeURIComponent(fyLabel)}`,
    );
    return res.data;
  },

  updateYearSettings: async (
    fyLabel: string,
    payload: YearSettingsUpdatePayload,
  ): Promise<YearSettingsResponse> => {
    const res = await apiClient.patch<YearSettingsResponse>(
      `/admin/settings/year/${encodeURIComponent(fyLabel)}`,
      payload,
    );
    return res.data;
  },

  getYearPreflight: async (fyLabel: string): Promise<YearPreflightResponse> => {
    const res = await apiClient.get<YearPreflightResponse>(
      `/admin/settings/year/${encodeURIComponent(fyLabel)}/preflight`,
    );
    return res.data;
  },

  // Admin "Notify" tab — fan out an org-wide announcement (in-app + optional email).
  sendNotify: async (payload: AdminNotifyPayload): Promise<AdminNotifyResult> => {
    const res = await apiClient.post<AdminNotifyResult>("/admin/notify", payload);
    return res.data;
  },

  // ── Cycle roll-out (manual active-cycle advancement) ─────────────
  getCycleStatus: async (): Promise<CycleStatus> => {
    const res = await apiClient.get<CycleStatus>("/admin/cycle");
    return res.data;
  },

  rolloutCycle: async (): Promise<CycleStatus> => {
    const res = await apiClient.post<CycleStatus>("/admin/cycle/rollout");
    return res.data;
  },

  setCycle: async (payload: CycleSetPayload): Promise<CycleStatus> => {
    const res = await apiClient.post<CycleStatus>("/admin/cycle/set", payload);
    return res.data;
  },

  // ── Goal access overrides (per-employee gate exceptions) ─────────
  /** Every active per-employee goal-access grant (the overview list). */
  getGoalAccessGrants: async (): Promise<GoalAccessGrant[]> => {
    const res = await apiClient.get<GoalAccessGrant[]>("/admin/goal-access");
    return res.data;
  },

  /** One employee's active grants + their active-FY annual goals. */
  getGoalAccessForUser: async (userId: number): Promise<GoalAccessDetail> => {
    const res = await apiClient.get<GoalAccessDetail>(
      `/admin/goal-access/${userId}`,
    );
    return res.data;
  },

  /** Grant/adjust an employee's access (active half unless period_label set). */
  setGoalAccess: async (
    userId: number,
    payload: GoalAccessGrantUpdatePayload,
  ): Promise<GoalAccessDetail> => {
    const res = await apiClient.patch<GoalAccessDetail>(
      `/admin/goal-access/${userId}`,
      payload,
    );
    return res.data;
  },

  /** Revoke an employee's grant for a half (defaults to the active half). */
  revokeGoalAccess: async (
    userId: number,
    periodLabel?: string,
  ): Promise<GoalAccessDetail> => {
    const res = await apiClient.post<GoalAccessDetail>(
      `/admin/goal-access/${userId}/revoke`,
      { period_label: periodLabel ?? null },
    );
    return res.data;
  },

  /** Throw an approved annual goal back to draft (auto-grants the owner edit
   *  access for that goal's half). Returns the owner's refreshed detail. */
  revertGoalToDraft: async (goalId: number): Promise<GoalAccessDetail> => {
    const res = await apiClient.post<GoalAccessDetail>(
      `/admin/goals/${goalId}/revert-to-draft`,
    );
    return res.data;
  },

  // Project review eligibility
  /** One page of active projects + whether each is eligible for review.
   *  Server-side search (name/code) + offset pagination. */
  getReviewEligibility: async (
    params: ReviewEligibilityQuery,
  ): Promise<Page<ReviewEligibilityProject>> => {
    const res = await apiClient.get<Page<ReviewEligibilityProject>>(
      "/admin/review-eligibility",
      { params },
    );
    return res.data;
  },

  /** Set eligibility for a set of projects. Only the listed projects change;
   *  ineligible projects drop out of every review surface server-side. */
  updateReviewEligibility: async (
    payload: ReviewEligibilityUpdatePayload,
  ): Promise<ReviewEligibilityUpdateResult> => {
    const res = await apiClient.patch<ReviewEligibilityUpdateResult>(
      "/admin/review-eligibility",
      payload,
    );
    return res.data;
  },
};
