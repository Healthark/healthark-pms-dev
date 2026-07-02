/**
 * ProjectReviewDetailModal placeholder mode: when `review` is null and a
 * `pendingContext` is supplied (a pending cycle with no DB row on the All
 * Reviews tab), it renders the header context plus a read-only
 * "not yet evaluated" empty state instead of the ratings / feedback sections.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ProjectReviewDetailModal,
  type PendingReviewContext,
} from "../ProjectReviewDetailModal";

void React;

const ctx: PendingReviewContext = {
  project_name: "Apollo",
  project_code: "APL-01",
  employee_name: "Sam Doe",
  cycle: "H1 FY26-27",
  reviewer_name: "Jane PM",
};

describe("ProjectReviewDetailModal — pending placeholder", () => {
  it("shows the not-yet-evaluated state with the header context", () => {
    render(
      <ProjectReviewDetailModal
        review={null}
        pendingContext={ctx}
        onClose={vi.fn()}
        projectRatingsVisible={true}
      />,
    );
    expect(screen.getByText("Not yet evaluated")).toBeInTheDocument();
    expect(screen.getByText(/Apollo/)).toBeInTheDocument();
    expect(screen.getByText(/Sam Doe/)).toBeInTheDocument();
    // The rating / competency sections are suppressed in placeholder mode.
    expect(screen.queryByText("Project Rating:")).not.toBeInTheDocument();
  });
});
