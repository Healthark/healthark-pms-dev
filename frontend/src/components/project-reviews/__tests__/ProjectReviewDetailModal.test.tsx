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
import type { ProjectReviewResponse } from "../../../services/project-review.service";

void React;

const reviewedReview = {
  id: 1,
  org_id: 1,
  user_id: 2,
  project_id: 3,
  reviewer_id: 4,
  cycle: "H1 FY26-27",
  status: "reviewed",
  employee_name: "Sam Doe",
  reviewer_name: "Jane PM",
  project_name: "Apollo",
  project_code: "APL-01",
  comment_task_execution: "Solid execution.",
  comment_ownership: null,
  comment_project_management: null,
  comment_client_deliverables: null,
  comment_communication: null,
  comment_mentoring: null,
  comment_competency_skills: null,
  performance_group: "Meeting Expectations",
  impact_statement: "Drove the launch end to end.",
  secondary_evaluations: [
    {
      id: 10,
      evaluator_id: 5,
      evaluator_name: "Priya Secondary",
      impact_statement: "Strong cross-team collaboration.",
      status: "submitted",
      created_at: "2026-01-01T00:00:00Z",
    },
  ],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: null,
} as unknown as ProjectReviewResponse;

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

describe("ProjectReviewDetailModal — renders by embedded competencies", () => {
  it("renders competency comments from the review's own framework, not the fixed labels", () => {
    const dynamicReview = {
      ...reviewedReview,
      comment_task_execution: null, // legacy fields empty — must not be used
      comments: { "50": "Feedback on custom competency" },
      competencies: [
        {
          id: 50,
          key: "custom_x",
          label: "Custom Competency X",
          display_order: 1,
          is_reviewable: true,
        },
      ],
    } as unknown as ProjectReviewResponse;

    render(
      <ProjectReviewDetailModal
        review={dynamicReview}
        onClose={vi.fn()}
        projectRatingsVisible={true}
      />,
    );

    expect(screen.getByText("Custom Competency X")).toBeInTheDocument();
    expect(screen.getByText("Feedback on custom competency")).toBeInTheDocument();
    // The hardcoded legacy label is NOT rendered — the review's own set drives it.
    expect(
      screen.queryByText("Task Execution & Problem Solving"),
    ).not.toBeInTheDocument();
  });
});

describe("ProjectReviewDetailModal — reviewed content labels", () => {
  it("labels the PM and secondary sections 'Overall Review' (renamed from 'Impact Statement')", () => {
    render(
      <ProjectReviewDetailModal
        review={reviewedReview}
        onClose={vi.fn()}
        projectRatingsVisible={true}
      />,
    );
    // PM's block: "Manager's Overall Review" (apostrophe is a curly &rsquo;).
    expect(screen.getByText(/Manager.s Overall Review/)).toBeInTheDocument();
    expect(screen.getByText("Drove the launch end to end.")).toBeInTheDocument();
    // Secondary block header + old wording gone.
    expect(screen.getByText("Secondary Overall Reviews")).toBeInTheDocument();
    expect(screen.queryByText(/Impact Statement/)).not.toBeInTheDocument();
  });
});
