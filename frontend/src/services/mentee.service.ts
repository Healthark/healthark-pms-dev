/**
 * mentee.service.ts — API contract for the mentor's master view.
 *
 * Endpoints:
 *   GET /mentees/summary              → Cards for /my-mentees grid
 *   GET /mentees/{id}/detail          → Slim summary for /my-mentees/:id header
 *   GET /mentees/{id}/goals           → Annual goals (PR 19 split)
 *   GET /mentees/{id}/reviews         → Annual reviews (PR 19 split)
 *   GET /mentees/{id}/projects        → Project assignments (PR 19 split)
 *
 * The `/{id}/detail` endpoint previously inlined goals/reviews/projects;
 * PR 19 split those into the three dedicated endpoints above. The detail
 * endpoint now returns only the identity + stats (MenteeSummary shape).
 *
 * Response types mirror backend/app/schemas/mentee_schemas.py exactly.
 */

import apiClient from "./api.client";
import type { TeamGoal } from "./goal.service";
import type { AnnualReview, ReviewStatus } from "./annual-review.service";
import type { ProjectReviewResponse } from "./project-review.service";

export interface MenteeGoalsStats {
  total: number;
  approved: number;
  submitted: number;
  draft: number;
  changes_requested: number;
  avg_progress_percent: number;
}

export interface MenteeReviewStatus {
  review_id: number | null;
  cycle_name: string | null;
  status: ReviewStatus | null;
  mentor_performance_rating: number | null;
  final_performance_rating: number | null;
}

export interface MenteeProjectsStats {
  active_count: number;
  pending_reviews_count: number;
  latest_performance_group: number | null;
}

export interface MenteeProjectAssignment {
  project_id: number;
  project_name: string;
  project_code: string;
  assignment_role: string | null;
  /** The MENTEE's evaluator_type on this project. */
  evaluator_type: string | null;
  /** "pending" | "reviewed" | null (placeholder row for active cycle, no review yet) */
  review_status: string | null;
  /** "1".."5" when reviewed, null otherwise. */
  performance_group: string | null;
  /** Real cycle name when a review exists; active cycle on placeholder rows. */
  cycle: string | null;
  /** Display name of the project's Primary evaluator (PM). */
  pm_name: string | null;
  /**
   * The current mentor's OWN evaluator_type on this project.
   *   "Primary"   → mentor is the PM → can Evaluate / Edit
   *   "Secondary" → mentor can write / edit an impact statement
   *   null        → mentor has no evaluator seat → read-only View
   */
  viewer_evaluator_role: string | null;
  /** Full PM evaluation; populated only when review_status === "reviewed". */
  review_detail: ProjectReviewResponse | null;
}

export interface MenteeSummary {
  user_id: number;
  full_name: string;
  email: string;
  employee_code: string;
  phone: string | null;
  department_name: string | null;
  designation_name: string | null;
  role: string;
  is_active: boolean;
  goals: MenteeGoalsStats;
  review: MenteeReviewStatus;
  projects: MenteeProjectsStats;
  /** Submitted annual goals + PENDING_MENTOR review — drives the amber strip. */
  pending_actions_count: number;
}

/**
 * Pre-PR-19 the detail endpoint inlined three arrays
 * (goals_list, reviews_list, project_assignments). Those moved to
 * dedicated sub-resource endpoints; the detail endpoint now returns the
 * `MenteeSummary` shape directly.
 *
 * The type alias is kept so any external code still importing
 * `MenteeDetail` continues to compile. New consumers should use
 * `MenteeSummary` directly and pair it with the sub-resource hooks
 * (`useMenteeGoals`, `useMenteeReviews`, `useMenteeProjects`).
 */
export type MenteeDetail = MenteeSummary;

export const menteeService = {
  getSummaries: async (): Promise<MenteeSummary[]> => {
    const res = await apiClient.get<MenteeSummary[]>("/mentees/summary");
    return res.data;
  },

  /** Slim mentee summary (identity + stats only) for the detail page
   *  header. Pair with the sub-resource fetchers below for per-tab data. */
  getDetail: async (menteeId: number): Promise<MenteeSummary> => {
    const res = await apiClient.get<MenteeSummary>(
      `/mentees/${menteeId}/detail`,
    );
    return res.data;
  },

  /** Annual goals for a mentee (mentor-visible states only). */
  getMenteeGoals: async (menteeId: number): Promise<TeamGoal[]> => {
    const res = await apiClient.get<TeamGoal[]>(
      `/mentees/${menteeId}/goals`,
    );
    return res.data;
  },

  /** Every annual review for a mentee across all cycles, newest first. */
  getMenteeReviews: async (menteeId: number): Promise<AnnualReview[]> => {
    const res = await apiClient.get<AnnualReview[]>(
      `/mentees/${menteeId}/reviews`,
    );
    return res.data;
  },

  /** Project assignments with inline review_detail for completed
   *  evaluations. Drives the Projects tab + Annual Summary tab's
   *  project section. */
  getMenteeProjects: async (
    menteeId: number,
  ): Promise<MenteeProjectAssignment[]> => {
    const res = await apiClient.get<MenteeProjectAssignment[]>(
      `/mentees/${menteeId}/projects`,
    );
    return res.data;
  },
};
