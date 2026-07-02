import { describe, it, expect } from "vitest";
import type { SecondaryEvalResponse } from "../../services/project-review.service";
import { resolveSecondaryRowStatus } from "../secondaryReviewStatus";

const ME = 7;

function ev(
  status: "draft" | "submitted",
  overrides: Partial<SecondaryEvalResponse> = {},
): SecondaryEvalResponse {
  return {
    id: 1,
    evaluator_id: ME,
    evaluator_name: "Me",
    impact_statement: "great work",
    status,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("resolveSecondaryRowStatus", () => {
  it("treats a saved DRAFT as pending (not submitted) with draft content", () => {
    const r = resolveSecondaryRowStatus([ev("draft")], ME);
    expect(r.review_status).toBe("pending"); // regression: was "submitted"
    expect(r.has_draft_content).toBe(true);
    expect(r.existing_impact).toBe("great work");
  });

  it("treats a submitted evaluation as submitted, no draft flag", () => {
    const r = resolveSecondaryRowStatus([ev("submitted")], ME);
    expect(r.review_status).toBe("submitted");
    expect(r.has_draft_content).toBe(false);
    expect(r.existing_impact).toBe("great work");
  });

  it("is pending with no draft when the current user has no evaluation", () => {
    const r = resolveSecondaryRowStatus([], ME);
    expect(r.review_status).toBe("pending");
    expect(r.has_draft_content).toBe(false);
    expect(r.existing_impact).toBe("");
  });

  it("ignores OTHER evaluators' rows when classifying for the current user", () => {
    const someoneElse = ev("submitted", { id: 2, evaluator_id: 99 });
    const r = resolveSecondaryRowStatus([someoneElse], ME);
    expect(r.review_status).toBe("pending");
    expect(r.has_draft_content).toBe(false);
  });

  it("handles a null impact_statement on a draft", () => {
    const r = resolveSecondaryRowStatus([ev("draft", { impact_statement: null })], ME);
    expect(r.review_status).toBe("pending");
    expect(r.has_draft_content).toBe(true);
    expect(r.existing_impact).toBe("");
  });

  it("returns pending when the evaluations array is undefined", () => {
    const r = resolveSecondaryRowStatus(undefined, ME);
    expect(r.review_status).toBe("pending");
    expect(r.has_draft_content).toBe(false);
  });
});
