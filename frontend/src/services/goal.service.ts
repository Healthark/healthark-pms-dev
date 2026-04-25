/**
 * goal.service.ts — Updated for Story 3.1 (Criteria) and 3.3 (Progress).
 *
 * Changes:
 *   - Added Criterion, CriterionCreatePayload, CriterionUpdatePayload types
 *   - Goal interface now includes criteria[] and progress_percent
 *   - GoalCreatePayload now accepts optional criteria[] array
 *   - New API calls: addCriterion, updateCriterion, deleteCriterion
 */

import apiClient from "./api.client";

// ── Enums ───────────────────────────────────────────────────────────

export type ApprovalStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "changes_requested";
export type GoalType = "regular" | "annual";
/** Which half of the fiscal year a self-review covers. */
export type SelfReviewCycleHalf = "H1" | "H2";

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
  /** Single freeform paragraph, mirrors the Annual Review self-appraisal shape. */
  self_overall_review: string;
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

// ── Service ─────────────────────────────────────────────────────────

export const goalService = {
  // ── Employee — Goals ────────────────────────────────────────────
  getMyGoals: async (goalType?: GoalType): Promise<Goal[]> => {
    const res = await apiClient.get<Goal[]>("/goals/", {
      params: goalType ? { goal_type: goalType } : undefined,
    });
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

  submitGoal: async (goalId: number): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(`/goals/${goalId}/submit`, {});
    return res.data;
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

  deleteCriterion: async (criterionId: number): Promise<void> => {
    await apiClient.delete(`/goals/criteria/${criterionId}`);
  },

  // ── Manager ─────────────────────────────────────────────────────
  getTeamGoals: async (goalType?: GoalType): Promise<TeamGoal[]> => {
    const res = await apiClient.get<TeamGoal[]>("/goals/team", {
      params: goalType ? { goal_type: goalType } : undefined,
    });
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
};
