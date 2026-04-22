/**
 * annual-review.service.ts — API Contract for the 3-Stage Appraisal.
 *
 * Covers:
 *   Stage 1: Employee self-appraisal (create, draft save, get mine)
 *   Stage 2: Mentor evaluation (get mentees, submit eval)
 *   Stage 3: Management calibration (get grid, finalize)
 *   Shared:  Get single review by ID
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

  // Stage 1
  self_desc_ownership: string | null;
  self_desc_productivity: string | null;
  self_desc_communication: string | null;
  self_desc_leadership: string | null;
  self_desc_adaptability: string | null;
  self_desc_time_management: string | null;
  self_stars: number | null;

  // Stage 2
  mentor_comment_ownership: string | null;
  mentor_comment_productivity: string | null;
  mentor_comment_communication: string | null;
  mentor_comment_leadership: string | null;
  mentor_comment_adaptability: string | null;
  mentor_comment_time_management: string | null;
  mentor_stars: number | null;

  // Stage 3
  management_stars: number | null;
  final_stars: number | null;
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
  self_stars: number | null;
  mentor_stars: number | null;
  management_stars: number | null;
  final_stars: number | null;
  status: ReviewStatus;
  final_rating_enabled: boolean;
}

// ── Request Payload Types ───────────────────────────────────────────

export interface SelfAppraisalPayload {
  self_desc_ownership: string;
  self_desc_productivity: string;
  self_desc_communication: string;
  self_desc_leadership: string;
  self_desc_adaptability: string;
  self_desc_time_management: string;
  self_stars: number;
}

export interface SelfAppraisalDraftPayload {
  self_desc_ownership?: string;
  self_desc_productivity?: string;
  self_desc_communication?: string;
  self_desc_leadership?: string;
  self_desc_adaptability?: string;
  self_desc_time_management?: string;
  self_stars?: number;
}

export interface MentorEvalPayload {
  mentor_comment_ownership: string;
  mentor_comment_productivity: string;
  mentor_comment_communication: string;
  mentor_comment_leadership: string;
  mentor_comment_adaptability: string;
  mentor_comment_time_management: string;
  mentor_stars: number;
}

export interface ManagementFinalizePayload {
  management_stars?: number | null;
  final_stars: number;
  management_comments?: string | null;
}

// ── Service ─────────────────────────────────────────────────────────

export const annualReviewService = {
  // ── Stage 1: Employee ───────────────────────────────────────────
  /** Submit the full self-appraisal (creates the review + advances to pending_mentor). */
  submitSelfAppraisal: async (
    payload: SelfAppraisalPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.post<AnnualReview>(
      "/annual-reviews/self",
      payload,
    );
    return res.data;
  },

  /** Save a partial draft (no status change). */
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

  /** Get the current user's review for the active cycle. */
  getMyReview: async (): Promise<AnnualReview> => {
    const res = await apiClient.get<AnnualReview>("/annual-reviews/mine");
    return res.data;
  },

  // ── Stage 2: Mentor ─────────────────────────────────────────────
  /** Get all reviews for the current mentor's direct mentees (any status). */
  getMenteeReviews: async (): Promise<MenteeAnnualReview[]> => {
    const res = await apiClient.get<MenteeAnnualReview[]>(
      "/annual-reviews/mentees",
    );
    return res.data;
  },

  /** Submit the mentor evaluation (advances to pending_management). */
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
  /** Get the calibration grid (all reviews in pending_management + completed). */
  getCalibrationGrid: async (): Promise<CalibrationRow[]> => {
    const res = await apiClient.get<CalibrationRow[]>(
      "/annual-reviews/calibration",
    );
    return res.data;
  },

  /** Finalize and publish a review (advances to completed). */
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
  /** Get a single review by ID (access-controlled on the backend). */
  getReview: async (reviewId: number): Promise<AnnualReview> => {
    const res = await apiClient.get<AnnualReview>(
      `/annual-reviews/${reviewId}`,
    );
    return res.data;
  },
};
