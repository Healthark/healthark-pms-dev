/**
 * goal.service.ts — Updated for Story 3.1 (Criteria) and 3.3 (Progress).
 *
 * Changes:
 *   - Added Criterion, CriterionCreatePayload, CriterionUpdatePayload types
 *   - Goal interface now includes criteria[] and progress_percent
 *   - GoalCreatePayload now accepts optional criteria[] array
 *   - New API calls: addCriterion, updateCriterion
 */

import apiClient from "./api.client";
import type { Page, PageQuery } from "./pagination";

// ── Enums ───────────────────────────────────────────────────────────

/** Lifecycle states a goal moves through. Mirrors backend
 *  `app.models.goal_models.ApprovalStatus`. The post-approval segment
 *  splits by cadence: half-yearly orgs use the h1/h2 review states,
 *  quarterly orgs use the q1..q4 review states. A given goal stays
 *  within one family for life. */
export type ApprovalStatus =
  | "draft"
  | "pending_approval"
  | "changes_requested"
  | "approved"
  // Half-yearly cadence
  | "h1_self_reviewed"
  | "h1_mentor_reviewed"
  | "h2_self_reviewed"
  | "h2_mentor_reviewed"
  // Quarterly cadence
  | "q1_self_reviewed"
  | "q1_mentor_reviewed"
  | "q2_self_reviewed"
  | "q2_mentor_reviewed"
  | "q3_self_reviewed"
  | "q3_mentor_reviewed"
  | "q4_self_reviewed"
  | "q4_mentor_reviewed";
export type GoalType = "regular" | "annual";
/** Which review window a self-review covers. H1/H2 for half-yearly orgs,
 *  Q1..Q4 for quarterly orgs (the org's `cycle_type` in SystemSettings
 *  decides which family is in play). */
export type SelfReviewCycleHalf = "H1" | "H2" | "Q1" | "Q2" | "Q3" | "Q4";

// ── Criterion Types ─────────────────────────────────────────────────

export interface Criterion {
  id: number;
  goal_id: number;
  title: string;
  sort_order: number;
  is_completed: boolean;
  completed_at: string | null;
  proof_comments: string | null;
  proof_attachment_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface CriterionCreatePayload {
  title: string;
  sort_order?: number;
}

export interface CriterionUpdatePayload {
  title?: string;
  sort_order?: number;
  is_completed?: boolean;
  proof_comments?: string | null;
}

// ── Goal Types ──────────────────────────────────────────────────────

/**
 * One fiscal-year-half self-review on a goal.
 *
 * A goal carries 0–2 of these: the employee submits one for H1 and
 * one for H2 of the goal's FY.  Presence of a row (matched by
 * cycle_half) means "Submitted".
 */
export interface GoalSelfReview {
  id: number;
  goal_id: number;
  cycle_half: SelfReviewCycleHalf;
  submitted_at: string;
  /** Single freeform paragraph, mirrors the Annual Review self-review shape. */
  self_overall_review: string;
  /** True while the row is a saved-but-not-submitted draft. Mentors only
   *  see rows where this is false (drafts are owner-only). */
  is_draft: boolean;
}

/**
 * Mentor's review of a mentee's self-review for one fiscal-year half.
 * A goal carries 0–2 of these (one per half), each submitted after the
 * mentee has already submitted their corresponding self-review.
 */
export interface GoalMentorReview {
  id: number;
  goal_id: number;
  cycle_half: SelfReviewCycleHalf;
  submitted_at: string;
  /** Single freeform paragraph; the form surfaces Firm Growth and Competency
   *  & Skills role expectations as reference panels rather than separate fields. */
  mentor_overall_review: string;
  /** The mentor who authored THIS half's review, snapshotted at write time.
   *  Distinct from the goal's current mentor (manager_name) — a half reviewed
   *  before a mentor change keeps its real author. Null for legacy rows. */
  mentor_id: number | null;
  mentor_name: string | null;
  /** True while the row is a saved-but-not-submitted draft. Mentees only
   *  see rows where this is false. */
  is_draft: boolean;
}

export interface GoalMentorReviewPayload {
  mentor_overall_review: string;
}

export interface Goal {
  id: number;
  org_id: number;
  user_id: number;
  manager_id: number | null;
  /** Display name of the assigned mentor; null when the owner has no mentor. */
  manager_name: string | null;
  title: string;
  description: string | null;
  attachment_url: string | null;
  goal_type: GoalType;
  cycle_name: string | null;
  fy_year: number | null;
  approval_status: ApprovalStatus;
  manager_feedback: string | null;
  progress_notes: string | null;
  start_date: string | null;
  due_date: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string | null;
  criteria: Criterion[];
  progress_percent: number;
  /** 0–2 entries, one per FY half. Look up by `cycle_half`. */
  self_reviews: GoalSelfReview[];
  /** 0–2 mentor reviews, one per FY half. Look up by `cycle_half`. */
  mentor_reviews: GoalMentorReview[];
}

export interface GoalSelfReviewPayload {
  self_overall_review: string;
}

/** Extended type for the manager's Team Goals view */
export interface TeamGoal extends Goal {
  owner_name: string;
  /** Owner's department / designation — used by the mentor-review modal to
   *  match the right RoleExpectation row without an extra fetch. */
  owner_department_name: string | null;
  owner_designation_name: string | null;
}

/** Query params for the paginated Team Goals table. */
export interface TeamGoalQuery extends PageQuery {
  goal_type?: GoalType;
  year?: number;
  mentee?: string;
  status?: string;
}

/** Year + mentee dropdown options for the Team Goals tab. */
export interface TeamGoalsFilterOptions {
  years: number[];
  mentees: string[];
}

export interface GoalCreatePayload {
  title: string;
  description?: string | null;
  attachment_url?: string | null;
  goal_type?: GoalType;
  start_date?: string | null;
  due_date?: string | null;
  // Ownership is server-determined from the JWT (or ?user_id= query param
  // for mentor-on-behalf-of-mentee creation, authorized server-side).
  // Intentionally not in the body to prevent client-side spoofing.
  criteria?: CriterionCreatePayload[];
}

export interface GoalUpdatePayload {
  title?: string;
  description?: string | null;
  attachment_url?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  progress_notes?: string | null;
}

export interface GoalApprovalPayload {
  approval_status: "approved" | "changes_requested";
  feedback?: string | null;
}

/** One goal that the bulk-approve endpoint refused to approve, with the
 *  human-readable reason. The UI surfaces these in a snackbar so the mentor
 *  knows which goals slipped state between modal-open and submit. */
export interface BulkApproveFailure {
  goal_id: number;
  reason: string;
}

export interface BulkApproveResult {
  approved_ids: number[];
  failures: BulkApproveFailure[];
}

/**
 * The caller's own active annual-goal access grants — per-employee exceptions
 * an Admin set on the Goal Access tab. Mirrors backend MyGoalAccessResponse.
 * Drives the My Goals Add/Edit affordances when the org-wide half is closed.
 */
export interface MyGoalAccess {
  /** Canonical active half ("H1 FY26-27"), or null when unparseable. */
  active_period_label: string | null;
  /** May add new annual goals despite the closed gate (active half). */
  allow_create: boolean;
  /** May edit goals despite the closed gate (active half). */
  allow_edit: boolean;
  /** Every half the caller currently holds an edit grant for — so a goal thrown
   *  back in a non-active half still resolves as editable. */
  edit_period_labels: string[];
}

// ── Service ─────────────────────────────────────────────────────────

export const goalService = {
  // ── Employee — Goals ────────────────────────────────────────────
  getMyGoals: async (goalType?: GoalType): Promise<Goal[]> => {
    const res = await apiClient.get<Goal[]>("/goals/", {
      params: goalType ? { goal_type: goalType } : undefined,
    });
    return res.data;
  },

  /** The caller's own goal-access grants — drives the My Goals Add/Edit
   *  affordances when the org-wide half is closed. Self-scoped server-side. */
  getMyAccess: async (): Promise<MyGoalAccess> => {
    const res = await apiClient.get<MyGoalAccess>("/goals/my-access");
    return res.data;
  },

  createGoal: async (payload: GoalCreatePayload): Promise<Goal> => {
    const res = await apiClient.post<Goal>("/goals/", payload);
    return res.data;
  },

  updateGoal: async (
    goalId: number,
    payload: GoalUpdatePayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(`/goals/${goalId}`, payload);
    return res.data;
  },

  /** Fetch a single goal with full self_reviews + mentor_reviews text.
   *  Used by the mentor-review modal after the /goals/team list response
   *  was slimmed to drop those text bodies (payload reduction PR 18). */
  getGoal: async (goalId: number): Promise<Goal> => {
    const res = await apiClient.get<Goal>(`/goals/${goalId}`);
    return res.data;
  },

  submitGoal: async (goalId: number): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(`/goals/${goalId}/submit`, {});
    return res.data;
  },

  /** Soft-delete a goal. Backend allows this only for the owner and only
   *  while the goal is still a DRAFT (returns 204). */
  deleteGoal: async (goalId: number): Promise<void> => {
    await apiClient.delete(`/goals/${goalId}`);
  },

  submitSelfReview: async (
    goalId: number,
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalSelfReviewPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/self-review/${cycleHalf}`,
      payload,
    );
    return res.data;
  },

  saveSelfReviewDraft: async (
    goalId: number,
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalSelfReviewPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/self-review/${cycleHalf}/draft`,
      payload,
    );
    return res.data;
  },

  submitMentorReview: async (
    goalId: number,
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/mentor-review/${cycleHalf}`,
      payload,
    );
    return res.data;
  },

  saveMentorReviewDraft: async (
    goalId: number,
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/mentor-review/${cycleHalf}/draft`,
      payload,
    );
    return res.data;
  },

  // ── Employee — Criteria ─────────────────────────────────────────
  addCriterion: async (
    goalId: number,
    payload: CriterionCreatePayload,
  ): Promise<Criterion> => {
    const res = await apiClient.post<Criterion>(
      `/goals/${goalId}/criteria`,
      payload,
    );
    return res.data;
  },

  updateCriterion: async (
    criterionId: number,
    payload: CriterionUpdatePayload,
  ): Promise<Criterion> => {
    const res = await apiClient.patch<Criterion>(
      `/goals/criteria/${criterionId}`,
      payload,
    );
    return res.data;
  },

  // ── Manager ─────────────────────────────────────────────────────
  /** Paginated team goals for the Team Goals table. Server applies
   *  search / year / mentee / status filtering + sort + pagination. */
  getTeamGoals: async (params: TeamGoalQuery): Promise<Page<TeamGoal>> => {
    const res = await apiClient.get<Page<TeamGoal>>("/goals/team", {
      params: {
        page: params.page,
        per_page: params.per_page,
        goal_type: params.goal_type || undefined,
        search: params.search || undefined,
        year: params.year ?? undefined,
        mentee: params.mentee || undefined,
        status: params.status && params.status !== "all" ? params.status : undefined,
        sort_by: params.sort_by || undefined,
        sort_dir: params.sort_by ? params.sort_dir : undefined,
      },
    });
    return res.data;
  },

  /** Year + mentee dropdown options for the Team Goals tab filters. */
  getTeamGoalsFilterOptions: async (
    goalType?: GoalType,
  ): Promise<TeamGoalsFilterOptions> => {
    const res = await apiClient.get<TeamGoalsFilterOptions>(
      "/goals/team/filter-options",
      { params: goalType ? { goal_type: goalType } : undefined },
    );
    return res.data;
  },

  /** All team goals awaiting mentor action (pending_approval +
   *  changes_requested), non-paginated — feeds the Bulk Approve modal so
   *  it can act across every page. */
  getPendingTeamGoals: async (goalType?: GoalType): Promise<TeamGoal[]> => {
    const res = await apiClient.get<TeamGoal[]>("/goals/team/pending", {
      params: goalType ? { goal_type: goalType } : undefined,
    });
    return res.data;
  },

  // ── Admin — All Goals (org-wide, read-only) ─────────────────────
  /** Admin-only: org-wide annual goals (every employee), optionally scoped to
   *  one fiscal year (e.g. 2026). Powers the read-only All Goals tab; the tab
   *  sends the selected Year so the browser loads just that year. */
  getAllGoals: async (fyYear?: number | null): Promise<TeamGoal[]> => {
    const params = fyYear != null ? { fy_year: fyYear } : undefined;
    const res = await apiClient.get<TeamGoal[]>("/goals/all", { params });
    return res.data;
  },

  updateApproval: async (
    goalId: number,
    payload: GoalApprovalPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/approve`,
      payload,
    );
    return res.data;
  },

  bulkApprove: async (goalIds: number[]): Promise<BulkApproveResult> => {
    const res = await apiClient.post<BulkApproveResult>("/goals/bulk-approve", {
      goal_ids: goalIds,
    });
    return res.data;
  },

  // Mentor nudges a mentee to complete the self-review on an approved goal
  // (in-app + email). Fire-and-forget — returns 204.
  remindSelfReview: async (goalId: number): Promise<void> => {
    await apiClient.post(`/goals/${goalId}/self-review-reminder`, {});
  },
};
