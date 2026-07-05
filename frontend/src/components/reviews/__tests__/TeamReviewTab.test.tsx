/**
 * Team Review tab — a mentee's self rating must stay private while their
 * self-review is still a draft. Once they submit (status → pending_mentor),
 * the mentor sees it. Guards the fix for the draft-rating leak from mentee to
 * mentor. The badge is identified by its title ("Performance rating: N").
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MenteeAnnualReview } from "../../../services/annual-review.service";

const reviewsRef: { current: MenteeAnnualReview[] } = { current: [] };
vi.mock("../../../queries/annualReviews", () => ({
  useMenteeAnnualReviews: () => ({
    data: reviewsRef.current,
    isLoading: false,
    error: null,
  }),
}));

import { TeamReviewTab } from "../TeamReviewTab";

void React;

const row = (over: Partial<MenteeAnnualReview>): MenteeAnnualReview =>
  ({
    id: 1,
    user_id: 10,
    employee_name: "Mentee One",
    cycle_name: "FY26-27",
    status: "draft",
    self_performance_rating: 2,
    mentor_performance_rating: null,
    management_performance_rating: null,
    department: null,
    ...over,
  }) as unknown as MenteeAnnualReview;

function renderTab() {
  render(
    <MemoryRouter>
      <TeamReviewTab />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  reviewsRef.current = [];
});

describe("TeamReviewTab — draft self-rating privacy", () => {
  it("hides a mentee's self rating while the review is a draft", () => {
    reviewsRef.current = [row({ status: "draft", self_performance_rating: 2 })];
    renderTab();

    // The draft row renders (mentor sees "awaiting self-review")…
    expect(screen.getByText("Awaiting self-review")).toBeInTheDocument();
    // …but the mentee's draft self rating never surfaces as a badge.
    expect(
      screen.queryByTitle("Performance rating: 2"),
    ).not.toBeInTheDocument();
  });

  it("shows the self rating once the mentee has submitted", () => {
    reviewsRef.current = [
      row({ status: "pending_mentor", self_performance_rating: 2 }),
    ];
    renderTab();

    expect(screen.getByTitle("Performance rating: 2")).toBeInTheDocument();
  });
});
