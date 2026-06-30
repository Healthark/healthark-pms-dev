/**
 * Tests for the My-Review list:
 *   - draft flow: the active-cycle draft shows an Edit action (opens the form),
 *     everything else shows View.
 *   - rating columns: independent Mentor Rating + Final (management) Rating
 *     columns, each gated by its own per-FY visibility setting.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnnualReview } from "../../../services/annual-review.service";

// SelfReviewTab reads useSystemSettings (needs a provider) — stub it with a
// mutable settings object so each test can flip the two visibility gates.
const { mockSettings } = vi.hoisted(() => ({
  mockSettings: {
    annual_review_final_rating_visible: false,
    annual_review_mentor_rating_visible: false,
  } as Record<string, boolean>,
}));
vi.mock("../../../hooks/useSystemSettings", () => ({
  useSystemSettings: () => ({ settings: mockSettings }),
}));

import { SelfReviewTab } from "../SelfReviewTab";

void React;

beforeEach(() => {
  mockSettings.annual_review_final_rating_visible = false;
  mockSettings.annual_review_mentor_rating_visible = false;
});

const draft = {
  id: 1,
  cycle_name: "FY26-27",
  status: "draft",
  self_performance_rating: null,
  mentor_performance_rating: null,
  final_performance_rating: null,
} as unknown as AnnualReview;

// Distinct ratings (self 2 / mentor 3 / final 4) so each column is identifiable
// by its PerformanceRatingBadge title ("Performance rating: N").
const completed = {
  id: 2,
  cycle_name: "FY25-26",
  status: "completed",
  self_performance_rating: 2,
  mentor_performance_rating: 3,
  final_performance_rating: 4,
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

describe("SelfReviewTab — Mentor + Final rating columns", () => {
  function renderRow() {
    render(
      <SelfReviewTab
        reviews={[completed]}
        isLoading={false}
        activeCycle="FY26-27"
        onEditDraft={vi.fn()}
      />,
    );
  }

  it("hides both ratings when neither gate is open", () => {
    renderRow();
    // Mentor (3) and Final (4) are hidden; Self (2) always shows.
    expect(screen.getByTitle("Performance rating: 2")).toBeInTheDocument();
    expect(screen.queryByTitle("Performance rating: 3")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Performance rating: 4")).not.toBeInTheDocument();
    expect(screen.getAllByText("Hidden")).toHaveLength(2); // mentor + final cells
  });

  it("reveals only the mentor rating when the mentor gate is open", () => {
    mockSettings.annual_review_mentor_rating_visible = true;
    renderRow();
    expect(screen.getByTitle("Performance rating: 3")).toBeInTheDocument(); // mentor
    expect(screen.queryByTitle("Performance rating: 4")).not.toBeInTheDocument(); // final still hidden
    expect(screen.getAllByText("Hidden")).toHaveLength(1); // only the final cell
  });

  it("reveals only the final (management) rating when the final gate is open", () => {
    mockSettings.annual_review_final_rating_visible = true;
    renderRow();
    expect(screen.getByTitle("Performance rating: 4")).toBeInTheDocument(); // final
    expect(screen.queryByTitle("Performance rating: 3")).not.toBeInTheDocument(); // mentor still hidden
    expect(screen.getAllByText("Hidden")).toHaveLength(1); // only the mentor cell
  });

  it("reveals both ratings when both gates are open", () => {
    mockSettings.annual_review_mentor_rating_visible = true;
    mockSettings.annual_review_final_rating_visible = true;
    renderRow();
    expect(screen.getByTitle("Performance rating: 3")).toBeInTheDocument();
    expect(screen.getByTitle("Performance rating: 4")).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });
});
