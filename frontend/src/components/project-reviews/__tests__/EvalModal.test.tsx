/**
 * EvalModal — dynamic competency rendering (PR 4, migrate).
 *
 * The eval form now renders one comment box per REVIEWABLE competency in the
 * fetched (department, level) set, keyed by competency id, and reverse-maps to
 * the still-fixed comment_* write payload on submit. These tests pin:
 *   - boxes render from the fetched set (not a hardcoded list);
 *   - submit reverse-maps the id-keyed comments onto comment_<key>;
 *   - an existing review prefills boxes from its `comments` id-map.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../../services/project-review.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../services/project-review.service")>();
  return {
    ...actual,
    projectReviewService: {
      ...actual.projectReviewService,
      getCompetencies: vi.fn(),
      getReview: vi.fn(),
    },
  };
});

import { EvalModal, type EvalModalCard } from "../EvalModal";
import { projectReviewService } from "../../../services/project-review.service";

void React;

const COMP_SET = {
  is_default: true,
  competencies: [
    { id: 10, key: "task_execution", label: "Task Execution", display_order: 1, is_reviewable: true },
    { id: 11, key: "ownership", label: "Ownership", display_order: 2, is_reviewable: true },
    { id: 12, key: "firm_growth", label: "Firm Growth", display_order: 3, is_reviewable: false },
  ],
};

const card: EvalModalCard = {
  employee_name: "Sam Doe",
  project_name: "Apollo",
  project_code: "AP-1",
  department_name: "Strategy",
  review_id: null,
  department_id: 5,
  level: 2,
};

function renderModal(
  overrides: Partial<React.ComponentProps<typeof EvalModal>> = {},
  onSubmit = vi.fn().mockResolvedValue(undefined),
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EvalModal
        card={card}
        expectation={null}
        isEditMode={false}
        readOnly={false}
        onSubmit={onSubmit}
        onSaveDraft={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        isSaving={false}
        isDraftSaving={false}
        error=""
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onSubmit };
}

beforeEach(() => {
  vi.mocked(projectReviewService.getCompetencies).mockResolvedValue(COMP_SET);
  vi.mocked(projectReviewService.getReview).mockReset();
});

describe("EvalModal — dynamic competency rendering", () => {
  it("renders a box per reviewable competency from the fetched set (skips non-reviewable)", async () => {
    renderModal();
    expect(await screen.findByLabelText(/Task Execution/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ownership/)).toBeInTheDocument();
    // firm_growth is not reviewable → no comment box.
    expect(screen.queryByLabelText(/Firm Growth/)).not.toBeInTheDocument();
  });

  it("reverse-maps id-keyed comments onto the fixed comment_* payload on submit", async () => {
    const { onSubmit } = renderModal();
    fireEvent.change(await screen.findByLabelText(/Task Execution/), {
      target: { value: "did the work" },
    });
    fireEvent.change(screen.getByLabelText(/Ownership/), {
      target: { value: "owned it" },
    });
    fireEvent.change(screen.getByLabelText(/Overall Performance Rating/), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/Overall Review/), {
      target: { value: "solid overall" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Submit Evaluation/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      performance_group: "3",
      impact_statement: "solid overall",
      comment_task_execution: "did the work",
      comment_ownership: "owned it",
      comment_project_management: "",
      comment_client_deliverables: "",
      comment_communication: "",
      comment_mentoring: "",
      comment_competency_skills: "",
    });
  });

  it("shows an error and blocks saving when the competency fetch fails", async () => {
    vi.mocked(projectReviewService.getCompetencies).mockRejectedValue(
      new Error("network"),
    );
    renderModal();
    // A blocking error is surfaced (not a silent empty form)…
    expect(
      await screen.findByText(/Couldn't load the evaluation form/),
    ).toBeInTheDocument();
    // …no competency boxes, and Save Draft is disabled so nothing can wipe
    // existing comments with an all-empty payload.
    expect(screen.queryByLabelText(/Task Execution/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save Draft/ })).toBeDisabled();
  });

  it("renders an existing review by its STORED competencies, not the current set", async () => {
    // The review was written against a competency the current default set
    // doesn't contain; it must still render by its own stored framework.
    vi.mocked(projectReviewService.getReview).mockResolvedValue({
      id: 77,
      comments: { "50": "stored text" },
      competencies: [
        { id: 50, key: "custom_x", label: "Custom X", display_order: 1, is_reviewable: true },
      ],
      performance_group: "2",
      impact_statement: "impact",
      secondary_evaluations: [],
    } as never);

    renderModal({ card: { ...card, review_id: 77 }, isEditMode: true });

    // Renders the review's OWN competency, prefilled by stored id…
    expect(await screen.findByLabelText(/Custom X/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("stored text")).toBeInTheDocument();
    // …and NOT the current (fetched) default set.
    expect(screen.queryByLabelText(/Task Execution/)).not.toBeInTheDocument();
  });

  it("prefills boxes from an existing review's comments id-map", async () => {
    vi.mocked(projectReviewService.getReview).mockResolvedValue({
      id: 99,
      comments: { "10": "prior TE", "11": "prior OWN" },
      performance_group: "2",
      impact_statement: "prior impact",
      secondary_evaluations: [],
    } as never);

    renderModal({ card: { ...card, review_id: 99 }, isEditMode: true });

    expect(await screen.findByDisplayValue("prior TE")).toBeInTheDocument();
    expect(screen.getByDisplayValue("prior OWN")).toBeInTheDocument();
    expect(screen.getByDisplayValue("prior impact")).toBeInTheDocument();
  });
});
