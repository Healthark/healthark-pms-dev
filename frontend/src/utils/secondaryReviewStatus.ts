import type { SecondaryEvalResponse } from "../services/project-review.service";

export interface SecondaryRowStatus {
  /**
   * Table status for the row. A saved-but-unsubmitted DRAFT stays "pending"
   * (paired with `has_draft_content`), exactly like the PM draft flow — it is
   * NOT "submitted". Only a finalized evaluation is "submitted".
   */
  review_status: "pending" | "submitted";
  /** True when the current evaluator has a saved draft (not yet submitted). */
  has_draft_content: boolean;
  /** Existing impact text to prefill the modal (draft or submitted). */
  existing_impact: string;
}

/**
 * Classify a project review's secondary evaluation for the current evaluator.
 *
 * The bug this guards against: the row builder used to treat the mere presence
 * of the evaluator's secondary_evaluation as "submitted", so clicking **Save
 * Draft** — which creates a `status: "draft"` row — flipped the item to
 * "Submitted" and locked it read-only. Draft and Submitted are distinct states
 * (`SecondaryEvalResponse.status`); only "submitted" is submitted.
 */
export function resolveSecondaryRowStatus(
  secondaryEvaluations: SecondaryEvalResponse[] | undefined,
  currentUserId: number | undefined,
): SecondaryRowStatus {
  const mine = secondaryEvaluations?.find(
    (ev) => ev.evaluator_id === currentUserId,
  );
  const submitted = mine?.status === "submitted";
  return {
    review_status: submitted ? "submitted" : "pending",
    has_draft_content: !!mine && !submitted,
    existing_impact: mine?.impact_statement ?? "",
  };
}
