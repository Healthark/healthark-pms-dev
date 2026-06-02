/**
 * Tests for the My-Review draft flow: the active-cycle draft shows an Edit
 * action (opens the form), everything else shows View.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnnualReview } from "../../../services/annual-review.service";

// SelfReviewTab reads useSystemSettings (needs a provider) — stub it.
vi.mock("../../../hooks/useSystemSettings", () => ({
  useSystemSettings: () => ({
    settings: { annual_review_final_rating_visible: false },
  }),
}));

import { SelfReviewTab } from "../SelfReviewTab";

void React;

const draft = {
  id: 1,
  cycle_name: "FY26-27",
  status: "draft",
  self_performance_rating: null,
  final_performance_rating: null,
} as unknown as AnnualReview;

const completed = {
  id: 2,
  cycle_name: "FY25-26",
  status: "completed",
  self_performance_rating: 2,
  final_performance_rating: 2,
} as unknown as AnnualReview;

describe("SelfReviewTab — draft Edit vs View", () => {
  it("shows Edit for the active-cycle draft and View for others; Edit fires onEditDraft", async () => {
    const user = userEvent.setup();
    const onEditDraft = vi.fn();
    render(
      <SelfReviewTab
        reviews={[draft, completed]}
        isLoading={false}
        activeCycle="FY26-27"
        onEditDraft={onEditDraft}
      />,
    );
    const editBtns = screen.getAllByRole("button", { name: /^Edit/ });
    const viewBtns = screen.getAllByRole("button", { name: /^View/ });
    expect(editBtns).toHaveLength(1);
    expect(viewBtns).toHaveLength(1);

    await user.click(editBtns[0]);
    expect(onEditDraft).toHaveBeenCalledWith(draft);
  });

  it("treats a draft from a non-active cycle as view-only", () => {
    const staleDraft = { ...draft, id: 3, cycle_name: "FY24-25" } as AnnualReview;
    render(
      <SelfReviewTab
        reviews={[staleDraft]}
        isLoading={false}
        activeCycle="FY26-27"
        onEditDraft={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^View/ })).toBeInTheDocument();
  });
});
