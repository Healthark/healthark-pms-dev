import type {
  ProjectReviewResponse,
  RoleExpectation,
} from "../../services/project-review.service";

/**
 * Shared competency-rendering helpers for the read-only review surfaces
 * (CompetencyBlock, ProjectReviewDetailModal). Kept in a plain module (not a
 * component file) so React Fast Refresh stays happy.
 *
 * A review renders by its OWN framework — the competencies embedded on the
 * review payload (resolved by the ids in its comments) — so historical reviews
 * are unaffected by later framework changes. A payload without embedded
 * competencies (legacy/transition) falls back to the fixed
 * comment_* / exp_* fields via PROJECT_COMPETENCIES.
 */

// Static metadata for the legacy 7 competencies — the fallback framework when
// a review payload has no embedded `competencies`. `commentKey` / `expKey` are
// narrowed to the `comment_*` / `exp_*` template-literal keys of the underlying
// types, so `review[commentKey]` resolves to `string | null`.
type CommentKey = Extract<keyof ProjectReviewResponse, `comment_${string}`>;
type ExpKey = Extract<keyof RoleExpectation, `exp_${string}`>;

export const PROJECT_COMPETENCIES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly commentKey: CommentKey;
  readonly expKey: ExpKey;
}> = [
  {
    key: "task_execution",
    label: "Task Execution & Problem Solving",
    commentKey: "comment_task_execution",
    expKey: "exp_task_execution",
  },
  {
    key: "ownership",
    label: "Ownership & Accountability",
    commentKey: "comment_ownership",
    expKey: "exp_ownership",
  },
  {
    key: "project_management",
    label: "Project Management and Risk Mitigation",
    commentKey: "comment_project_management",
    expKey: "exp_project_management",
  },
  {
    key: "client_deliverables",
    label: "Building Client-Ready Deliverables",
    commentKey: "comment_client_deliverables",
    expKey: "exp_client_deliverables",
  },
  {
    key: "communication",
    label: "Communication & Client/Stakeholder Management",
    commentKey: "comment_communication",
    expKey: "exp_communication",
  },
  {
    key: "mentoring",
    label: "Mentoring and Team Development",
    commentKey: "comment_mentoring",
    expKey: "exp_mentoring",
  },
  {
    key: "competency_skills",
    label: "Competency and Skills",
    commentKey: "comment_competency_skills",
    expKey: "exp_competency_skills",
  },
];

/** One rendered competency block: label + the manager's comment + the
 *  resolved role-expectation text. */
export interface ReviewCompetencyBlock {
  key: string;
  label: string;
  comment: string | null;
  expText: string | null;
}

/**
 * Build the competency blocks for a review, preferring its embedded framework
 * (`review.competencies` + `review.comments`, keyed by competency id) and
 * falling back to the fixed comment_* / exp_* fields when no framework is
 * embedded. Shared so every read surface renders a review by its own
 * competencies.
 */
export function resolveReviewBlocks(
  review: ProjectReviewResponse,
  roleExp: RoleExpectation | undefined,
): ReviewCompetencyBlock[] {
  const legacyExp = (key: string): string | null =>
    roleExp
      ? ((roleExp as unknown as Record<string, string | null>)[`exp_${key}`] ?? null)
      : null;

  if (review.competencies && review.competencies.length > 0) {
    return review.competencies.map((c) => ({
      key: String(c.id),
      label: c.label,
      comment: review.comments?.[String(c.id)] ?? null,
      // Prefer the expectation seeded on the competency (the department/level
      // framework — "Not defined" for the org default set), matching the eval
      // form; fall back to the legacy per-designation map / exp_<key>.
      expText: c.expectation ?? roleExp?.expectations?.[String(c.id)] ?? legacyExp(c.key),
    }));
  }

  return PROJECT_COMPETENCIES.map((c) => ({
    key: c.key,
    label: c.label,
    comment: review[c.commentKey] ?? null,
    expText: roleExp ? (roleExp[c.expKey] ?? null) : null,
  }));
}
