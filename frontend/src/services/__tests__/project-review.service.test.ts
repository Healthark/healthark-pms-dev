/**
 * Reports-to endpoints now target a specific reviewee (a "root" PM) by
 * user_id, so the URL carries both projectId and userId. These guard the URL
 * shape the multi-PM routing (PR2) depends on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api.client", () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import apiClient from "../api.client";
import { projectReviewService } from "../project-review.service";

const mockClient = vi.mocked(apiClient);

const payload = {
  performance_group: "3",
  impact_statement: "x",
  comment_task_execution: "x",
  comment_ownership: "x",
  comment_project_management: "x",
  comment_client_deliverables: "x",
  comment_communication: "x",
  comment_mentoring: "x",
  comment_competency_skills: "x",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

beforeEach(() => vi.clearAllMocks());

describe("projectReviewService — reports-to targets a reviewee by id", () => {
  it("submit posts to /reports-to/{projectId}/evaluate/{userId}", async () => {
    await projectReviewService.submitReportsToEvaluation(7, 42, payload);
    expect(mockClient.post).toHaveBeenCalledWith(
      "/project-reviews/reports-to/7/evaluate/42",
      payload,
    );
  });

  it("draft patches to /reports-to/{projectId}/evaluate/{userId}/draft", async () => {
    await projectReviewService.saveReportsToDraft(7, 42, payload);
    expect(mockClient.patch).toHaveBeenCalledWith(
      "/project-reviews/reports-to/7/evaluate/42/draft",
      payload,
    );
  });
});
