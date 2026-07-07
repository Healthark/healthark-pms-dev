/**
 * ImpactModal is the Secondary evaluator's write surface. Its field label was
 * renamed "Impact Statement" → "Overall Review". The prefill + submit wiring is
 * asserted alongside so the rename didn't disturb behavior.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ImpactModal, type ImpactModalRow } from "../ImpactModal";
import type { ProjectReviewResponse } from "../../../services/project-review.service";

void React;

const row: ImpactModalRow = {
  employee_name: "Sam Doe",
  project_name: "Apollo",
  review_status: "pending",
  project_id: 3,
  user_id: 2,
  existingImpact: "prior draft text",
};

// A finalized PM review the parent hands to the modal once the PM has
// submitted. Only the fields the reference block renders are meaningful.
const pmReview: ProjectReviewResponse = {
  id: 99,
  org_id: 1,
  user_id: 2,
  project_id: 3,
  reviewer_id: 7,
  cycle: "H1 FY26-27",
  status: "reviewed",
  employee_name: "Sam Doe",
  reviewer_name: "Pat Manager",
  project_name: "Apollo",
  project_code: "APL-1",
  comment_task_execution: "Shipped the parser ahead of schedule.",
  comment_ownership: null,
  comment_project_management: null,
  comment_client_deliverables: null,
  comment_communication: null,
  comment_mentoring: null,
  comment_competency_skills: null,
  performance_group: "4",
  impact_statement: "Strong quarter — owned the migration end to end.",
  secondary_evaluations: [],
  created_at: "2026-07-01T00:00:00Z",
  updated_at: null,
};

function renderModal(overrides: Partial<React.ComponentProps<typeof ImpactModal>> = {}) {
  render(
    <ImpactModal
      row={row}
      readOnly={false}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      onSaveDraft={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
      isSaving={false}
      isDraftSaving={false}
      error=""
      {...overrides}
    />,
  );
}

describe("ImpactModal — Overall Review rename", () => {
  it("labels the field 'Overall Review' (not 'Impact Statement')", () => {
    renderModal();
    expect(screen.getByText(/Overall Review/)).toBeInTheDocument();
    expect(screen.queryByText(/Impact Statement/)).not.toBeInTheDocument();
  });

  it("still prefills the existing text into the textarea", () => {
    renderModal();
    expect(screen.getByDisplayValue("prior draft text")).toBeInTheDocument();
  });
});

describe("ImpactModal — PM-first submit gate", () => {
  it("blocks Submit and shows a note while the PM hasn't submitted", () => {
    renderModal({ pmSubmitted: false });
    // The explanatory note appears…
    expect(
      screen.getByText(/only submit your review once the Project Manager/i),
    ).toBeInTheDocument();
    // …Submit is disabled even though there's prefilled text…
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    // …but Save Draft stays available.
    expect(screen.getByRole("button", { name: /Save Draft/ })).toBeEnabled();
  });

  it("enables Submit once the PM has submitted", () => {
    renderModal({ pmSubmitted: true });
    expect(
      screen.queryByText(/only submit your review once the Project Manager/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("keeps an already-submitted row editable regardless of the flag", () => {
    // review_status "submitted" ⇒ the PM already finalized (submit is only
    // reachable post-PM), so editing must never be blocked.
    renderModal({ row: { ...row, review_status: "submitted" }, pmSubmitted: false });
    expect(
      screen.queryByText(/only submit your review once the Project Manager/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  });
});

describe("ImpactModal — PM review reference block", () => {
  it("shows the PM's competency comments, overall review, and rating once submitted", () => {
    renderModal({ pmSubmitted: true, pmReview, pmRating: "4" });
    // Section header + the reviewer's name.
    expect(screen.getByText(/Project Manager’s Review/)).toBeInTheDocument();
    expect(screen.getByText(/Pat Manager/)).toBeInTheDocument();
    // A filled competency comment surfaces; the PM's overall review too.
    expect(
      screen.getByText(/Shipped the parser ahead of schedule\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/owned the migration end to end\./),
    ).toBeInTheDocument();
    // The rating comes from the card (reviewer-visible), rendered as a badge.
    expect(screen.getByTitle(/Performance rating: 4/)).toBeInTheDocument();
  });

  it("renders a loading line while the PM review is being fetched", () => {
    renderModal({ pmSubmitted: true, pmReview: null, pmReviewLoading: true });
    expect(
      screen.getByText(/Loading the Project Manager’s review/i),
    ).toBeInTheDocument();
  });

  it("omits the PM review block entirely before the PM submits", () => {
    renderModal({ pmSubmitted: false, pmReview: null });
    expect(
      screen.queryByText(/Project Manager’s Review/),
    ).not.toBeInTheDocument();
    // The Secondary's own field is still there.
    expect(screen.getByText(/Overall Review/)).toBeInTheDocument();
  });

  it("still shows the PM review in read-only (view) mode", () => {
    renderModal({ readOnly: true, pmSubmitted: true, pmReview, pmRating: "4" });
    expect(screen.getByText(/Project Manager’s Review/)).toBeInTheDocument();
    expect(
      screen.getByText(/Shipped the parser ahead of schedule\./),
    ).toBeInTheDocument();
    // No "use as reference" helper in read-only mode.
    expect(
      screen.queryByText(/use the Project Manager’s evaluation as/i),
    ).not.toBeInTheDocument();
  });
});
