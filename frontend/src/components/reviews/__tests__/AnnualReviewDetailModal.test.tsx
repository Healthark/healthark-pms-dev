/**
 * AnnualReviewDetailModal — mentee-facing visibility of the mentor's review.
 *
 * The mentor's WRITTEN review must surface as soon as it exists
 * (`mentor_overall_review` is sent from the pending_management stage onward),
 * independent of the numeric mentor RATING, which stays gated by the
 * `annual_review_mentor_rating_visible` admin toggle (the backend nulls the
 * rating while the gate is closed). So:
 *   - review text present + rating null  → text shown, rating reads "Hidden"
 *   - both present                        → text shown, rating badge shown
 *   - neither (mentor hasn't submitted)   → no mentor section at all
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnnualReviewDetailModal } from "../AnnualReviewDetailModal";
import type { AnnualReview } from "../../../services/annual-review.service";

void React;

function makeReview(over: Partial<AnnualReview> = {}): AnnualReview {
  return {
    id: 1,
    org_id: 1,
    user_id: 10,
    mentor_id: 2,
    cycle_name: "FY26-27",
    status: "pending_management",
    self_overall_review: "My honest self reflection.",
    self_performance_rating: 2,
    mentor_overall_review: null,
    mentor_performance_rating: null,
    mentor_overall_review_draft: null,
    mentor_performance_rating_draft: null,
    management_performance_rating: null,
    final_performance_rating: null,
    final_rating_enabled: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    ...over,
  } as AnnualReview;
}

function renderModal(over: Partial<AnnualReview> = {}) {
  return render(
    <AnnualReviewDetailModal
      review={makeReview(over)}
      title="Self Annual Review"
      onClose={vi.fn()}
    />,
  );
}

describe("AnnualReviewDetailModal — mentor review visibility", () => {
  it("shows the mentor's written review as soon as it exists, even when the rating is gated off", () => {
    renderModal({
      mentor_overall_review: "You owned the migration end-to-end. Grow your delegation.",
      mentor_performance_rating: null, // gated — backend nulled it
    });

    // Written review section + body are visible.
    expect(screen.getByText("Mentor Review")).toBeInTheDocument();
    expect(
      screen.getByText(/you owned the migration end-to-end/i),
    ).toBeInTheDocument();

    // The rating slot renders, but as the explicit "Hidden" withheld state —
    // not a missing/absent rating.
    expect(screen.getByText("Mentor Rating")).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("shows the mentor rating badge (not Hidden) once the rating is unblocked", () => {
    renderModal({
      mentor_overall_review: "Consistent, high-quality delivery.",
      mentor_performance_rating: 3,
    });

    expect(screen.getByText(/consistent, high-quality delivery/i)).toBeInTheDocument();
    expect(screen.getByText("Mentor Rating")).toBeInTheDocument();
    // Rating badge rendered → the withheld state is gone.
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    expect(screen.getByTitle("Performance rating: 3")).toBeInTheDocument();
  });

  it("hides the mentor section entirely before the mentor submits", () => {
    renderModal({
      status: "pending_mentor",
      mentor_overall_review: null,
      mentor_performance_rating: null,
    });

    expect(screen.queryByText("Mentor Review")).not.toBeInTheDocument();
    expect(screen.queryByText("Mentor Rating")).not.toBeInTheDocument();
    // The self-review is always visible.
    expect(screen.getByText("Overall Self Review")).toBeInTheDocument();
    expect(screen.getByText(/my honest self reflection/i)).toBeInTheDocument();
  });
});
