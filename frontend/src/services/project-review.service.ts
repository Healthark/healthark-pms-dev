/**
 * project-review.service.ts — PM-Centric Evaluation API (Revised).
 *
 * No self-review. The PM evaluates team members directly.
 *
 * Covers:
 *   Employee:    getMyProjects, getReview
 *   PM:          getPMQueue, getRoleExpectations, submitPMEvaluation
 *   Secondary:   getSecondaryQueue, submitSecondaryEval
 *   Admin:       getAllReviews
 */

import apiClient from "./api.client";

// ── Enums ───────────────────────────────────────────────────────────

export type ProjectReviewStatus = "pending" | "reviewed";
export type EvaluatorType = "Primary" | "Secondary";
export type PerformanceGroup =
  | "Needs Improvement"
  | "Meeting Expectations"
  | "Exceeding Expectations"
  | "Meeting High Expectations"
  | "Exceeding High Expectations";

// ── Response Types ──────────────────────────────────────────────────

export interface SecondaryEvalResponse {
  id: number;
  evaluator_id: number;
  evaluator_name: string;
  impact_statement: string | null;
  /** "draft" while the evaluator has saved but not yet submitted;
   *  "submitted" once finalized. The frontend gates editability on this. */
  status: "draft" | "submitted";
  created_at: string;
}

export interface ProjectReviewResponse {
  id: number;
  org_id: number;
  user_id: number;
  project_id: number;
  reviewer_id: number | null;
  cycle: string;
  status: ProjectReviewStatus;
  employee_name: string;
  reviewer_name: string | null;
  project_name: string;
  project_code: string;
  comment_task_execution: string | null;
  comment_ownership: string | null;
  comment_project_management: string | null;
  comment_client_deliverables: string | null;
  comment_communication: string | null;
  comment_mentoring: string | null;
  comment_competency_skills: string | null;
  /** Dynamic competency comments — {competency_id: text}. Source of truth for
   *  the department/level-aware framework; mirrors the comment_* fields above
   *  for the default set. Null on empty placeholder rows. */
  comments: Record<string, string | null> | null;
  /** The competencies THIS review was written against, resolved by the ids in
   *  its comments (ordered, soft-deleted included). Lets the eval form and
   *  read surfaces render an existing review by its OWN framework rather than
   *  re-resolving the reviewee's current set. Empty for a review with no
   *  comments yet. Optional: some local adapters build this shape without it. */
  competencies?: Competency[];
  performance_group: string | null;
  impact_statement: string | null;
  secondary_evaluations: SecondaryEvalResponse[];
  created_at: string;
  updated_at: string | null;
}

export interface MyProjectCard {
  review_id: number | null;
  project_id: number;
  project_name: string;
  project_code: string;
  project_start_date: string | null;
  project_expected_end_date: string | null;
  assigned_date: string | null;
  assignment_role: string | null;
  designation_name: string | null;
  department_name: string | null;
  /** Reviewee's department id + designation level — used to fetch the
   *  applicable competency set for the dynamic eval form. */
  department_id: number | null;
  level: number | null;
  review_status: string | null; // "pending" | "reviewed" | null
  performance_group: string | null;
  pm_name: string | null;
  secondary_evaluator_name: string | null;
  cycle: string | null;
}

export interface PMPendingReviewCard {
  review_id: number | null;
  project_id: number;
  project_name: string;
  project_code: string;
  user_id: number;
  employee_name: string;
  assignment_role: string | null;
  department_name: string | null;
  designation_name: string | null;
  /** Reviewee's department id + designation level — used to fetch the
   *  applicable competency set for the dynamic eval form. */
  department_id: number | null;
  level: number | null;
  assigned_date: string | null;
  review_status: string | null;
  performance_group: string | null;
  secondary_evaluator_name: string | null;
  cycle: string | null;
  /** True iff the row is pending AND the PM has typed any content into
   *  it. Backend distinguishes this from empty placeholder rows so the
   *  Draft pill / filter only fires on actual saved drafts. */
  has_draft_content: boolean;
}

export interface SecondaryEvalCard {
  project_id: number;
  project_name: string;
  project_code: string;
  user_id: number;
  employee_name: string;
  cycle: string;
  /** Null until a ProjectReview row exists (created lazily on first write). */
  review_id: number | null;
  /** The SECONDARY's own submission state: "submitted" once finalized, else
   *  "pending" (no impact yet, or only a saved draft). */
  review_status: "pending" | "submitted";
  /** True iff the secondary has a saved-but-unsubmitted draft. */
  has_draft_content: boolean;
  /** The secondary's own impact text (draft or submitted), for modal prefill. */
  existing_impact: string | null;
  /** The reviewed member's department on this project. */
  department_name: string | null;
  /** The PM's rating, shown once the PM finalizes the review (draft hidden).
   *  Display only. */
  performance_group: string | null;
  /** True once the member's PM evaluation is in (review reviewed). The
   *  Secondary can save a draft anytime but can only submit after this is
   *  true — the modal disables Submit until then, and the backend enforces it. */
  pm_submitted: boolean;
}

export interface RoleExpectation {
  id: number;
  department_name: string;
  designation_name: string;
  exp_task_execution: string | null;
  exp_ownership: string | null;
  exp_project_management: string | null;
  exp_client_deliverables: string | null;
  exp_communication: string | null;
  exp_mentoring: string | null;
  exp_firm_growth: string | null;
  exp_competency_skills: string | null;
  /** Dynamic expectations — {competency_id: text}. Matched to the resolved
   *  competency set by id; mirrors the exp_* fields for the default set. The
   *  API always sends it; optional here because a few call sites build a
   *  RoleExpectation-shaped adapter locally (e.g. goals self-review). */
  expectations?: Record<string, string | null> | null;
}

/** A single competency in a resolved (department, level) framework set. */
export interface Competency {
  id: number;
  key: string;
  label: string;
  display_order: number;
  is_reviewable: boolean;
}

/** The competency set that applies to a (department, level). `is_default` is
 *  true when the org default set is returned because that (department, level)
 *  has no framework of its own. */
export interface CompetencySet {
  is_default: boolean;
  competencies: Competency[];
}

// ── Request Payloads ────────────────────────────────────────────────

export interface PMEvaluationPayload {
  performance_group: PerformanceGroup;
  impact_statement: string;
  /** Dynamic {competency_id: text} map — the current write shape, covering
   *  the reviewee's applicable (incl. custom) competencies. */
  comments?: Record<string, string>;
  // Legacy fixed fields — still accepted by the backend for older clients, but
  // the current form sends `comments` instead.
  comment_task_execution?: string;
  comment_ownership?: string;
  comment_project_management?: string;
  comment_client_deliverables?: string;
  comment_communication?: string;
  comment_mentoring?: string;
  comment_competency_skills?: string;
}

/** Save-draft payload — every field optional so the PM can park a
 *  half-typed evaluation and resume later. */
export type PMEvaluationDraftPayload = Partial<PMEvaluationPayload>;

export interface SecondaryEvalPayload {
  impact_statement: string;
}

export type SecondaryEvalDraftPayload = Partial<SecondaryEvalPayload>;

// ── Admin Management View Types ─────────────────────────────────────

export interface AdminMemberReviewRow {
  review_id: number | null;
  user_id: number;
  employee_name: string;
  assignment_role: string | null;
  department_name: string | null;
  review_status: "pending" | "reviewed" | "not_started";
  performance_group: string | null;
}

export interface AdminProjectSummary {
  project_id: number;
  project_name: string;
  project_code: string;
  pm_name: string | null;
  total_members: number;
  reviewed_count: number;
  members: AdminMemberReviewRow[];
}

// ── Service ─────────────────────────────────────────────────────────

export const projectReviewService = {
  // ── Employee ────────────────────────────────────────────────────
  /** List my assigned projects with review status. */
  getMyProjects: async (): Promise<MyProjectCard[]> => {
    const res = await apiClient.get<MyProjectCard[]>("/project-reviews/mine");
    return res.data;
  },

  /** Get a single review (after PM has evaluated). */
  getReview: async (reviewId: number): Promise<ProjectReviewResponse> => {
    const res = await apiClient.get<ProjectReviewResponse>(`/project-reviews/${reviewId}`);
    return res.data;
  },

  // ── PM (Primary Evaluator) ─────────────────────────────────────
  /** List team members needing evaluation on PM's projects. */
  getPMQueue: async (): Promise<PMPendingReviewCard[]> => {
    const res = await apiClient.get<PMPendingReviewCard[]>("/project-reviews/pm-queue");
    return res.data;
  },

  /** Get role expectations reference data for evaluation. */
  getRoleExpectations: async (): Promise<RoleExpectation[]> => {
    const res = await apiClient.get<RoleExpectation[]>("/project-reviews/role-expectations");
    return res.data;
  },

  /** Resolve the competency set for a (department, level). Omitting either
   *  falls back to the org default set (flagged is_default). Drives the
   *  dynamic evaluation form. */
  getCompetencies: async (
    departmentId: number | null,
    level: number | null,
  ): Promise<CompetencySet> => {
    const params: Record<string, number> = {};
    if (departmentId != null) params.department_id = departmentId;
    if (level != null) params.level = level;
    const res = await apiClient.get<CompetencySet>(
      "/project-reviews/competencies",
      { params },
    );
    return res.data;
  },

  /** PM submits evaluation for a team member. */
  submitPMEvaluation: async (
    projectId: number,
    userId: number,
    payload: PMEvaluationPayload,
  ): Promise<ProjectReviewResponse> => {
    const res = await apiClient.post<ProjectReviewResponse>(
      `/project-reviews/${projectId}/evaluate/${userId}`,
      payload,
    );
    return res.data;
  },

  /** PM saves an in-progress evaluation as a draft (status=DRAFT). All
   *  fields optional — only those present on the payload are written.
   *  Submit (POST /evaluate) promotes the row to REVIEWED. */
  savePMDraft: async (
    projectId: number,
    userId: number,
    payload: PMEvaluationDraftPayload,
  ): Promise<ProjectReviewResponse> => {
    const res = await apiClient.patch<ProjectReviewResponse>(
      `/project-reviews/${projectId}/evaluate/${userId}/draft`,
      payload,
    );
    return res.data;
  },

  /** PM edits an already-submitted evaluation. */
  updateReview: async (
    reviewId: number,
    payload: PMEvaluationPayload,
  ): Promise<ProjectReviewResponse> => {
    const res = await apiClient.put<ProjectReviewResponse>(
      `/project-reviews/${reviewId}`,
      payload,
    );
    return res.data;
  },

  // ── Reports-To (the PM's evaluator) ────────────────────────────
  /** PMs the current user must evaluate — one per project where they are the
   *  project's reports-to senior. Same card shape as the PM queue, but the
   *  reviewee is the PM. */
  getReportsToQueue: async (): Promise<PMPendingReviewCard[]> => {
    const res = await apiClient.get<PMPendingReviewCard[]>(
      "/project-reviews/reports-to-queue",
    );
    return res.data;
  },

  /** Reports-to senior submits a root PM's evaluation. `userId` is the reviewee
   *  — the single Primary (single-PM) or one top-level member (multi-PM). */
  submitReportsToEvaluation: async (
    projectId: number,
    userId: number,
    payload: PMEvaluationPayload,
  ): Promise<ProjectReviewResponse> => {
    const res = await apiClient.post<ProjectReviewResponse>(
      `/project-reviews/reports-to/${projectId}/evaluate/${userId}`,
      payload,
    );
    return res.data;
  },

  /** Reports-to senior saves an in-progress root PM evaluation as a draft. */
  saveReportsToDraft: async (
    projectId: number,
    userId: number,
    payload: PMEvaluationDraftPayload,
  ): Promise<ProjectReviewResponse> => {
    const res = await apiClient.patch<ProjectReviewResponse>(
      `/project-reviews/reports-to/${projectId}/evaluate/${userId}/draft`,
      payload,
    );
    return res.data;
  },

  // ── Secondary Evaluator ────────────────────────────────────────
  // Writes are keyed on (projectId, userId), not a review id — a Secondary can
  // now write BEFORE the PM starts, when no review row exists yet. The backend
  // creates the parent PENDING review lazily and the PM's later evaluate
  // promotes it.
  /** List members awaiting a secondary impact statement (incl. before the PM
   *  has started — placeholder cards have review_id === null). */
  getSecondaryQueue: async (): Promise<SecondaryEvalCard[]> => {
    const res = await apiClient.get<SecondaryEvalCard[]>("/project-reviews/secondary-queue");
    return res.data;
  },

  /** Submit secondary impact statement for a member on a project. */
  submitSecondaryEval: async (
    projectId: number,
    userId: number,
    payload: SecondaryEvalPayload,
  ): Promise<SecondaryEvalResponse> => {
    const res = await apiClient.post<SecondaryEvalResponse>(
      `/project-reviews/${projectId}/secondary/${userId}`,
      payload,
    );
    return res.data;
  },

  /** Secondary evaluator saves an in-progress impact statement as a
   *  draft. Submit promotes it. */
  saveSecondaryDraft: async (
    projectId: number,
    userId: number,
    payload: SecondaryEvalDraftPayload,
  ): Promise<SecondaryEvalResponse> => {
    const res = await apiClient.patch<SecondaryEvalResponse>(
      `/project-reviews/${projectId}/secondary/${userId}/draft`,
      payload,
    );
    return res.data;
  },

  /** Update an existing secondary impact statement (active cycle). */
  updateSecondaryEval: async (
    projectId: number,
    userId: number,
    payload: SecondaryEvalPayload,
  ): Promise<SecondaryEvalResponse> => {
    const res = await apiClient.put<SecondaryEvalResponse>(
      `/project-reviews/${projectId}/secondary/${userId}`,
      payload,
    );
    return res.data;
  },

  // ── Admin ──────────────────────────────────────────────────────
  /** Admin-only: project reviews, optionally scoped to one fiscal year
   *  (e.g. 2026 → FY26-27). Omit `fyYear` to fetch every year. */
  getAllReviews: async (fyYear?: number | null): Promise<ProjectReviewResponse[]> => {
    const params = fyYear != null ? { fy_year: fyYear } : undefined;
    const res = await apiClient.get<ProjectReviewResponse[]>("/project-reviews/all", { params });
    return res.data;
  },

  /** Admin-only: distinct fiscal start years with project reviews (Year dropdown). */
  getAllReviewYears: async (): Promise<number[]> => {
    const res = await apiClient.get<number[]>("/project-reviews/all/years");
    return res.data;
  },

  /** Admin-only: per-project completion overview. Pass cycle string to view historical data. */
  getManagementView: async (cycle?: string): Promise<AdminProjectSummary[]> => {
    const params = cycle ? { cycle } : {};
    const res = await apiClient.get<AdminProjectSummary[]>("/project-reviews/management", { params });
    return res.data;
  },
};