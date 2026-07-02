/**
 * MyReviewRatingCell gates the employee's own project rating on TWO conditions:
 * the PM must have completed the evaluation (review_status === "reviewed") AND
 * the admin must have published ratings (projectRatingsVisible).
 *
 * The key regression this guards: a PM's *draft* rating must NOT render just
 * because the admin toggle is on — a not-yet-reviewed row shows an em dash,
 * never the rating badge.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MyReviewRatingCell } from "../MyReviewRatingCell";
import type { MyProjectCard } from "../../../services/project-review.service";

void React;

const card = (
  overrides: Partial<MyProjectCard> = {},
): MyProjectCard =>
  ({
    review_id: 1,
    project_id: 1,
    project_name: "Proj",
    project_code: "P-1",
    project_start_date: null,
    project_expected_end_date: null,
    assigned_date: null,
    assignment_role: null,
    designation_name: null,
    department_name: null,
    review_status: "reviewed",
    performance_group: "4",
    pm_name: "PM",
    cycle: "H1 FY26-27",
    ...overrides,
  }) as MyProjectCard;

describe("MyReviewRatingCell", () => {
  it("hides a DRAFT rating even when ratings are published (the leak)", () => {
    render(
      <MyReviewRatingCell
        card={card({ review_status: "draft", performance_group: "4" })}
        projectRatingsVisible
      />,
    );
    expect(screen.queryByTitle("Performance rating: 4")).toBeNull();
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it('shows an em dash (not "Hidden") for a pending row regardless of the toggle', () => {
    render(
      <MyReviewRatingCell
        card={card({ review_status: "pending", performance_group: null })}
        projectRatingsVisible={false}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).toBeNull();
  });

  it("shows the rating badge when reviewed AND published", () => {
    render(
      <MyReviewRatingCell
        card={card({ review_status: "reviewed", performance_group: "4" })}
        projectRatingsVisible
      />,
    );
    expect(screen.getByTitle("Performance rating: 4")).toBeInTheDocument();
  });

  it('shows "Hidden" when reviewed but ratings are NOT published', () => {
    render(
      <MyReviewRatingCell
        card={card({ review_status: "reviewed", performance_group: "4" })}
        projectRatingsVisible={false}
      />,
    );
    expect(screen.getByText("Hidden")).toBeInTheDocument();
    expect(screen.queryByTitle("Performance rating: 4")).toBeNull();
  });
});
