/**
 * annual-review.service.ts — API Contract for the 3-Stage Appraisal.
 *
 * Covers:
 *   Stage 1: Employee self-review (create, draft save, get mine, get history)
 *   Stage 2: Mentor evaluation (get mentees, submit eval)
 *   Stage 3: Management calibration (get grid, finalize)
 *   Shared:  Get single review by ID
 *
 * Each stage captures a single free-text overall review plus a 1–5
 * performance rating (1 = beyond expectations … 5 = did not achieve goals,
 * same guide as Project Review).
 */

import apiClient from "./api.client";

// ── Enums ───────────────────────────────────────────────────────────

export type ReviewStatus =
  | "draft"
  | "pending_mentor"
  | "pending_management"
  | "completed";

// ── Response Types ──────────────────────────────────────────────────

export interface AnnualReview {
  id: number;
  org_id: number;
  user_id: number;
  mentor_id: number | null;
  cycle_name: string;
  status: ReviewStatus;

  // Stage 1 — employee self-review
  self_overall_review: string | null;
  self_performance_rating: number | null;

  // Stage 2 — mentor evaluation
  mentor_overall_review: string | null;
  mentor_performance_rating: number | null;

  // Stage 3 — management calibration
  management_performance_rating: number | null;
  final_performance_rating: number | null;
  management_comments: string | null;
  final_rating_enabled: boolean;

  created_at: string;
  updated_at: string | null;
}

export interface MenteeAnnualReview extends AnnualReview {
  employee_name: string;
  employee_email: string | null;
  department: string | null;
  designation: string | null;
}

export interface CalibrationRow {
  review_id: number;
  user_id: number;
  employee_name: string;
  department: string | null;
  designation: string | null;
  self_performance_rating: number | null;
  mentor_performance_rating: number | null;
  management_performance_rating: number | null;
  final_performance_rating: number | null;
  status: ReviewStatus;
  final_rating_enabled: boolean;
}

// ── Request Payload Types ───────────────────────────────────────────

export interface SelfAppraisalPayload {
  self_overall_review: string;
  self_performance_rating: number;
}

export type SelfAppraisalDraftPayload = Partial<SelfAppraisalPayload>;

export interface MentorEvalPayload {
  mentor_overall_review: string;
  mentor_performance_rating: number;
}

export interface ManagementFinalizePayload {
  management_performance_rating?: number | null;
  final_performance_rating: number;
  management_comments?: string | null;
}

// ── Service ─────────────────────────────────────────────────────────

export const annualReviewService = {
  // ── Stage 1: Employee ───────────────────────────────────────────
  submitSelfAppraisal: async (
    payload: SelfAppraisalPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.post<AnnualReview>(
      "/annual-reviews/self",
      payload,
    );
    return res.data;
  },

  saveDraft: async (
    reviewId: number,
    payload: SelfAppraisalDraftPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.patch<AnnualReview>(
      `/annual-reviews/${reviewId}/draft`,
      payload,
    );
    return res.data;
  },

  getMyReview: async (): Promise<AnnualReview> => {
    const res = await apiClient.get<AnnualReview>("/annual-reviews/mine");
    return res.data;
  },

  /** Full history of the current user's reviews across cycles, newest-first. */
  getMyReviewHistory: async (): Promise<AnnualReview[]> => {
    const res = await apiClient.get<AnnualReview[]>(
      "/annual-reviews/mine/history",
    );
    return res.data;
  },

  // ── Stage 2: Mentor ─────────────────────────────────────────────
  getMenteeReviews: async (): Promise<MenteeAnnualReview[]> => {
    const res = await apiClient.get<MenteeAnnualReview[]>(
      "/annual-reviews/mentees",
    );
    return res.data;
  },

  submitMentorEval: async (
    reviewId: number,
    payload: MentorEvalPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.patch<AnnualReview>(
      `/annual-reviews/${reviewId}/mentor-eval`,
      payload,
    );
    return res.data;
  },

  // ── Stage 3: Management ─────────────────────────────────────────
  getCalibrationGrid: async (): Promise<CalibrationRow[]> => {
    const res = await apiClient.get<CalibrationRow[]>(
      "/annual-reviews/calibration",
    );
    return res.data;
  },

  finalizeReview: async (
    reviewId: number,
    payload: ManagementFinalizePayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.patch<AnnualReview>(
      `/annual-reviews/${reviewId}/finalize`,
      payload,
    );
    return res.data;
  },

  // ── Shared ──────────────────────────────────────────────────────
  getReview: async (reviewId: number): Promise<AnnualReview> => {
    const res = await apiClient.get<AnnualReview>(
      `/annual-reviews/${reviewId}`,
    );
    return res.data;
  },
};
