/**
 * project-review.service.ts — Project Review Workflow API.
 *
 * Covers:
 *   Employee:           getMyProjects, submitSelfReview, saveDraft, getReview
 *   Primary Evaluator:  getPendingEvaluations, submitPrimaryEval
 *   Secondary/Peer:     submitSecondaryPeerEval
 *   Admin:              getAllReviews
 */

import apiClient from "./api.client";

// ── Enums ───────────────────────────────────────────────────────────

export type ProjectReviewStatus = "draft" | "submitted";
export type EvaluatorStatus = "draft" | "submitted";
export type EvaluatorType = "Primary" | "Secondary";
export type PerformanceGroup =
  | "Needs Improvement"
  | "Meeting Expectations"
  | "Exceeding Expectations"
  | "Meeting High Expectations"
  | "Exceeding High Expectations";

// ── Response Types ──────────────────────────────────────────────────

export interface EvaluatorResponse {
  id: number;
  evaluator_id: number;
  evaluator_name: string;
  evaluator_type: EvaluatorType;
  status: EvaluatorStatus;
  performance_group: PerformanceGroup | null;
  impact_statement: string | null;
  comment_task_execution: string | null;
  comment_ownership: string | null;
  comment_project_management: string | null;
  comment_client_deliverables: string | null;
  comment_communication: string | null;
  comment_mentoring: string | null;
  comment_firm_growth: string | null;
  comment_competency_skills: string | null;
  created_at: string;
}

export interface ProjectReviewResponse {
  id: number;
  org_id: number;
  user_id: number;
  project_id: number;
  cycle: string;
  status: ProjectReviewStatus;
  employee_name: string;
  project_name: string;
  project_code: string;
  self_desc_task_execution: string | null;
  self_desc_ownership: string | null;
  self_desc_project_management: string | null;
  self_desc_client_deliverables: string | null;
  self_desc_communication: string | null;
  self_desc_mentoring: string | null;
  self_desc_firm_growth: string | null;
  self_desc_competency_skills: string | null;
  evaluators: EvaluatorResponse[];
  is_deleted: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface MyProjectReviewCard {
  review_id: number | null;
  project_id: number;
  project_name: string;
  project_code: string;
  project_start_date: string | null;
  project_end_date: string | null;
  assigned_date: string | null;
  assignment_role: string | null;
  review_status: string | null;
  primary_submitted: boolean;
  cycle: string | null;
}

// ── Request Payload Types ───────────────────────────────────────────

export interface SelfReviewPayload {
  project_id: number;
  self_desc_task_execution: string;
  self_desc_ownership: string;
  self_desc_project_management: string;
  self_desc_client_deliverables: string;
  self_desc_communication: string;
  self_desc_mentoring: string;
  self_desc_firm_growth: string;
  self_desc_competency_skills: string;
}

export interface SelfReviewDraftPayload {
  self_desc_task_execution?: string;
  self_desc_ownership?: string;
  self_desc_project_management?: string;
  self_desc_client_deliverables?: string;
  self_desc_communication?: string;
  self_desc_mentoring?: string;
  self_desc_firm_growth?: string;
  self_desc_competency_skills?: string;
}

export interface PrimaryEvalPayload {
  performance_group: PerformanceGroup;
  impact_statement: string;
  comment_task_execution: string;
  comment_ownership: string;
  comment_project_management: string;
  comment_client_deliverables: string;
  comment_communication: string;
  comment_mentoring: string;
  comment_firm_growth: string;
  comment_competency_skills: string;
}

export interface SecondaryPeerPayload {
  impact_statement: string;
}

// ── Service ─────────────────────────────────────────────────────────

export const projectReviewService = {
  // ── Employee ────────────────────────────────────────────────────
  /** List all projects assigned to current user with review status. */
  getMyProjects: async (): Promise<MyProjectReviewCard[]> => {
    const res = await apiClient.get<MyProjectReviewCard[]>(
      "/project-reviews/mine",
    );
    return res.data;
  },

  /** Submit a full self-review (all 8 competencies, immediately Submitted). */
  submitSelfReview: async (
    payload: SelfReviewPayload,
  ): Promise<ProjectReviewResponse> => {
    const res = await apiClient.post<ProjectReviewResponse>(
      "/project-reviews/self",
      payload,
    );
    return res.data;
  },

  /** Save a partial self-review draft (no status change). */
  saveDraft: async (
    reviewId: number,
    payload: SelfReviewDraftPayload,
  ): Promise<ProjectReviewResponse> => {
    const res = await apiClient.patch<ProjectReviewResponse>(
      `/project-reviews/${reviewId}/draft`,
      payload,
    );
    return res.data;
  },

  /** Get a single review with visibility-controlled evaluator data. */
  getReview: async (reviewId: number): Promise<ProjectReviewResponse> => {
    const res = await apiClient.get<ProjectReviewResponse>(
      `/project-reviews/${reviewId}`,
    );
    return res.data;
  },

  // ── Primary Evaluator ──────────────────────────────────────────
  /** List submitted reviews pending the current user's primary evaluation. */
  getPendingEvaluations: async (): Promise<ProjectReviewResponse[]> => {
    const res = await apiClient.get<ProjectReviewResponse[]>(
      "/project-reviews/evaluations",
    );
    return res.data;
  },

  /** Submit primary evaluation — 8 comments + performance group + impact. */
  submitPrimaryEval: async (
    reviewId: number,
    payload: PrimaryEvalPayload,
  ): Promise<EvaluatorResponse> => {
    const res = await apiClient.post<EvaluatorResponse>(
      `/project-reviews/${reviewId}/primary-eval`,
      payload,
    );
    return res.data;
  },

  // ── Secondary / Peer Evaluator ─────────────────────────────────
  /** Submit secondary or peer impact statement. */
  submitSecondaryPeerEval: async (
    reviewId: number,
    payload: SecondaryPeerPayload,
  ): Promise<EvaluatorResponse> => {
    const res = await apiClient.post<EvaluatorResponse>(
      `/project-reviews/${reviewId}/secondary-eval`,
      payload,
    );
    return res.data;
  },

  // ── Admin ──────────────────────────────────────────────────────
  /** Admin-only: list all reviews across the org for the active cycle. */
  getAllReviews: async (): Promise<ProjectReviewResponse[]> => {
    const res = await apiClient.get<ProjectReviewResponse[]>(
      "/project-reviews/all",
    );
    return res.data;
  },
  /** List submitted reviews pending the current user's secondary evaluation. */
  getPendingSecondaryEvaluations: async (): Promise<ProjectReviewResponse[]> => {
    const res = await apiClient.get<ProjectReviewResponse[]>(
      "/project-reviews/secondary-evaluations",
    );
    return res.data;
  },
};