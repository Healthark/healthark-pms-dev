/**
 * annual-review.service.ts — API Contract for the 3-Stage Review.
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
import type { Page, PageQuery } from "./pagination";

// ── Enums ───────────────────────────────────────────────────────────

export type ReviewStatus =
  | "draft"
  | "pending_mentor"
  | "pending_management"
  | "completed"
  // Synthetic — only the All Reviews roster returns this, for active-cycle
  // employees with no review row yet. Never persisted.
  | "not_started";

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
  /** Mentor's in-progress draft, surfaced only to the mentor (the
   *  backend strips these for the mentee). Cleared on submit. */
  mentor_overall_review_draft: string | null;
  mentor_performance_rating_draft: number | null;

  // Stage 3 — management calibration
  management_performance_rating: number | null;
  final_performance_rating: number | null;
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

/** Filter dropdown options for the calibration grid — distinct values
 *  across the org's calibration set (all years), fetched once. */
export interface CalibrationFilterOptions {
  employees: string[];
  departments: string[];
  designations: string[];
  mentors: string[];
  /** FY labels with at least one calibration review, newest first; always
   *  includes active_year. */
  years: string[];
  /** The active cycle's FY label — the grid's default year selection. */
  active_year: string;
}

/** Query params accepted by GET /annual-reviews/calibration. Extends the
 *  shared PageQuery with the grid's domain-specific filters. */
export interface CalibrationQuery extends PageQuery {
  /** Exact employee name (from the Employee filter combobox). */
  employee?: string;
  department?: string;
  designation?: string;
  /** Exact mentor name, or the "(No mentor)" sentinel for unmentored employees. */
  mentor?: string;
  status?: "all" | "pending" | "rated";
  /** FY label (e.g. "FY25-26"), "all", or omitted (active cycle). */
  year?: string;
}

export interface CalibrationRow {
  /** null for synthetic not_started rows — there's no review to open yet. */
  review_id: number | null;
  user_id: number;
  /** Bare FY label of the review (e.g. "FY25-26") — drives the Year column. */
  cycle_name: string;
  employee_name: string;
  employee_email: string | null;
  mentor_name: string | null;
  department: string | null;
  designation: string | null;
  self_performance_rating: number | null;
  mentor_performance_rating: number | null;
  management_performance_rating: number | null;
  final_performance_rating: number | null;
  status: ReviewStatus;
  final_rating_enabled: boolean;
}

export interface ManagementRatingPayload {
  management_performance_rating: number;
}

/** Active-cycle annual-review progress for the admin dashboard funnel card.
 *  The five stage counts sum to `total` (the active headcount); `cycle_name`
 *  is null when no active cycle is configured. */
export interface AnnualReviewFunnel {
  cycle_name: string | null;
  total: number;
  not_started: number;
  draft: number;
  pending_mentor: number;
  pending_management: number;
  completed: number;
}

// ── Request Payload Types ───────────────────────────────────────────

export interface SelfReviewPayload {
  self_overall_review: string;
  self_performance_rating: number;
}

export type SelfReviewDraftPayload = Partial<SelfReviewPayload>;

export interface MentorEvalPayload {
  mentor_overall_review: string;
  mentor_performance_rating: number;
}

/** Save-draft payload — both fields optional. The mentor can park work
 *  before having committed to either the text or the rating. */
export type MentorEvalDraftPayload = Partial<MentorEvalPayload>;

// ── Service ─────────────────────────────────────────────────────────

export const annualReviewService = {
  // ── Stage 1: Employee ───────────────────────────────────────────
  submitSelfReview: async (
    payload: SelfReviewPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.post<AnnualReview>(
      "/annual-reviews/self",
      payload,
    );
    return res.data;
  },

  /** Create a new annual self-review in DRAFT state. Use when no row
   *  exists yet for the active cycle; for updating an existing draft,
   *  use saveDraft. */
  createSelfDraft: async (
    payload: SelfReviewDraftPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.post<AnnualReview>(
      "/annual-reviews/self/draft",
      payload,
    );
    return res.data;
  },

  saveDraft: async (
    reviewId: number,
    payload: SelfReviewDraftPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.patch<AnnualReview>(
      `/annual-reviews/${reviewId}/draft`,
      payload,
    );
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

  /** Mentor saves an in-progress evaluation as a draft. Both fields are
   *  optional; the row stays in pending_mentor status, the draft cols on
   *  the row carry the in-progress text/rating. */
  saveMentorDraft: async (
    reviewId: number,
    payload: MentorEvalDraftPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.patch<AnnualReview>(
      `/annual-reviews/${reviewId}/mentor-draft`,
      payload,
    );
    return res.data;
  },

  // ── Stage 3: Management ─────────────────────────────────────────
  /** Paginated calibration grid. Server applies employee / department /
   *  designation / mentor / status filtering + sort + offset pagination;
   *  the response is a Page<CalibrationRow> envelope. */
  getCalibrationGrid: async (
    params: CalibrationQuery,
  ): Promise<Page<CalibrationRow>> => {
    const res = await apiClient.get<Page<CalibrationRow>>(
      "/annual-reviews/calibration",
      {
        params: {
          page: params.page,
          per_page: params.per_page,
          // Only send filters/sort when set so the URL stays clean and
          // the backend treats absent params as "no filter".
          employee: params.employee || undefined,
          department: params.department || undefined,
          designation: params.designation || undefined,
          mentor: params.mentor || undefined,
          status:
            params.status && params.status !== "all"
              ? params.status
              : undefined,
          year: params.year || undefined,
          sort_by: params.sort_by || undefined,
          sort_dir: params.sort_by ? params.sort_dir : undefined,
        },
      },
    );
    return res.data;
  },

  /** Distinct dept + mentor names for the grid's filter dropdowns. */
  getCalibrationFilterOptions: async (): Promise<CalibrationFilterOptions> => {
    const res = await apiClient.get<CalibrationFilterOptions>(
      "/annual-reviews/calibration/filter-options",
    );
    return res.data;
  },

  /** Admin-only org-wide annual-review listing across every employee and
   *  fiscal year (drafts + deactivated employees excluded). Powers the
   *  All Reviews tab — the FE filters + paginates this set client-side. */
  getAllReviews: async (): Promise<CalibrationRow[]> => {
    const res = await apiClient.get<CalibrationRow[]>("/annual-reviews/all");
    return res.data;
  },

  /** Admin-only active-cycle progress counts for the dashboard funnel card. */
  getFunnel: async (): Promise<AnnualReviewFunnel> => {
    const res = await apiClient.get<AnnualReviewFunnel>("/annual-reviews/funnel");
    return res.data;
  },

  /** Lightweight inline action from the Management Review tab — sets only
   * management_performance_rating and unlocks the per-row visibility flag. */
  setManagementRating: async (
    reviewId: number,
    payload: ManagementRatingPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.patch<AnnualReview>(
      `/annual-reviews/${reviewId}/management-rating`,
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
