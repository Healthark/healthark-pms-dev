/**
 * Tests for the anonymous remark cards rendered below the 360 matrix.
 * The matrix itself is covered implicitly; these focus on the remarks
 * strip: it shows only when `showRemarks` is set, labels every author
 * "Anonymous user", and applies the worked-with (blue) / not-worked-with
 * (amber) treatment via the cohort label.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { FeedbackAggregate } from "../../../services/feedback360.service";

// AggregateView pulls its data from the query hook — stub it.
const mockUseFeedbackAggregate = vi.fn();
vi.mock("../../../queries/feedback360", () => ({
  useFeedbackAggregate: (id: number) => mockUseFeedbackAggregate(id),
}));

import { AggregateView } from "../AggregateView";

void React;

function makeAggregate(
  remarks: FeedbackAggregate["remarks"],
): FeedbackAggregate {
  return {
    target_user_id: 1,
    fy_year: 2026,
    total_reviews: 6,
    min_reviewers_threshold: 3,
    questions: [],
    remarks,
  };
}

function stubData(agg: FeedbackAggregate) {
  mockUseFeedbackAggregate.mockReturnValue({
    data: agg,
    isPending: false,
    error: null,
  });
}

describe("AggregateView — anonymous remark cards", () => {
  it("renders a card per remark with Anonymous user + cohort label when showRemarks is set", () => {
    stubData(
      makeAggregate([
        { worked_with: true, text: "Great collaborator." },
        { worked_with: false, text: "Could communicate more." },
      ]),
    );

    render(<AggregateView targetUserId={1} showRemarks />);

    expect(screen.getAllByText("Anonymous user")).toHaveLength(2);
    // Header shows the count.
    expect(screen.getByText(/2 anonymous/)).toBeInTheDocument();

    // Each card carries its remark text + the matching cohort label.
    // (The matrix legend also uses these labels, so scope to the card.)
    const workedCard = screen
      .getByText("Great collaborator.")
      .closest("div") as HTMLElement;
    expect(within(workedCard).getByText("Worked with")).toBeInTheDocument();

    const notWorkedCard = screen
      .getByText("Could communicate more.")
      .closest("div") as HTMLElement;
    expect(
      within(notWorkedCard).getByText("Not worked with"),
    ).toBeInTheDocument();
  });

  it("hides remark cards when showRemarks is not set, even if data carries remarks", () => {
    stubData(
      makeAggregate([{ worked_with: true, text: "Hidden remark." }]),
    );

    render(<AggregateView targetUserId={1} />);

    expect(screen.queryByText("Hidden remark.")).not.toBeInTheDocument();
    expect(screen.queryByText("Anonymous user")).not.toBeInTheDocument();
  });

  it("renders no remarks section when the list is empty", () => {
    stubData(makeAggregate([]));

    render(<AggregateView targetUserId={1} showRemarks />);

    expect(screen.queryByText("Anonymous user")).not.toBeInTheDocument();
    expect(screen.queryByText(/anonymous/)).not.toBeInTheDocument();
  });
});
