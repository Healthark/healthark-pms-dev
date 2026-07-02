/**
 * MenteeAnnualSummaryTab — draft self-review visibility.
 *
 * While a mentee's annual self-review is still a `draft`, the mentor must not
 * see the self rating/text on the Annual Summary tab (this mirrors the Reviews
 * tab, which filters drafts out). Once the mentee submits (status →
 * pending_mentor), the self-review card appears.
 *
 * The three per-tab data hooks and useSystemSettings are mocked so we can
 * drive the review status in isolation.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnnualReview } from "../../../services/annual-review.service";
import { MenteeAnnualSummaryTab } from "../MenteeAnnualSummaryTab";

const ACTIVE_CYCLE = "FY26-27";

let reviewsData: AnnualReview[] = [];

vi.mock("../../../queries/mentees", () => ({
  useMenteeGoals: () => ({ data: [], isPending: false, error: null }),
  useMenteeReviews: () => ({ data: reviewsData, isPending: false, error: null }),
  useMenteeProjects: () => ({ data: [], isPending: false, error: null }),
}));

vi.mock("../../../hooks/useSystemSettings", () => ({
  useSystemSettings: () => ({
    settings: { active_cycle_name: ACTIVE_CYCLE },
    isLoading: false,
  }),
}));

function makeReview(overrides: Partial<AnnualReview> = {}): AnnualReview {
  return {
    id: 1,
    org_id: 1,
    user_id: 2,
    mentor_id: 1,
    cycle_name: ACTIVE_CYCLE,
    status: "draft",
    self_overall_review: "My own take on the year.",
    self_performance_rating: 2,
    mentor_overall_review: null,
    mentor_performance_rating: null,
    mentor_overall_review_draft: null,
    mentor_performance_rating_draft: null,
    management_performance_rating: null,
    final_performance_rating: null,
    final_rating_enabled: false,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

function renderTab() {
  return render(<MenteeAnnualSummaryTab menteeId={2} onOpenEval={vi.fn()} />);
}

describe("MenteeAnnualSummaryTab draft self-review visibility", () => {
  it("hides the self-review card while the review is a draft", () => {
    reviewsData = [makeReview({ status: "draft" })];
    renderTab();
    expect(screen.queryByText("Mentee's self review")).toBeNull();
    // The "Mentee drafting" status still surfaces so the mentor has context.
    expect(screen.getByText("Mentee drafting")).toBeInTheDocument();
  });

  it("shows the self-review card once the mentee has submitted", () => {
    reviewsData = [makeReview({ status: "pending_mentor" })];
    renderTab();
    expect(screen.getByText("Mentee's self review")).toBeInTheDocument();
  });
});
