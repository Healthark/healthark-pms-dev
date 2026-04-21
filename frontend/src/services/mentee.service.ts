/**
 * mentee.service.ts — API contract for the mentor's master view.
 *
 * Endpoints:
 *   GET /mentees/summary              → Cards for /my-mentees grid
 *   GET /mentees/{id}/detail          → Full payload for /my-mentees/:id
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
  mentor_stars: number | null;
  final_stars: number | null;
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
  evaluator_type: string | null;
  /** "pending" | "reviewed" | null (no review exists yet) */
  review_status: string | null;
  /** "1".."5" when reviewed, null otherwise. */
  performance_group: string | null;
  cycle: string | null;
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
  /** Submitted yearly goals + PENDING_MENTOR review — drives the amber strip. */
  pending_actions_count: number;
}

export interface MenteeDetail extends MenteeSummary {
  goals_list: TeamGoal[];
  reviews_list: AnnualReview[];
  project_assignments: MenteeProjectAssignment[];
}

export const menteeService = {
  getSummaries: async (): Promise<MenteeSummary[]> => {
    const res = await apiClient.get<MenteeSummary[]>("/mentees/summary");
    return res.data;
  },

  getDetail: async (menteeId: number): Promise<MenteeDetail> => {
    const res = await apiClient.get<MenteeDetail>(`/mentees/${menteeId}/detail`);
    return res.data;
  },
};
