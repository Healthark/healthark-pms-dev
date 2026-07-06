/**
 * ImpactModal is the Secondary evaluator's write surface. Its field label was
 * renamed "Impact Statement" → "Overall Review". The prefill + submit wiring is
 * asserted alongside so the rename didn't disturb behavior.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ImpactModal, type ImpactModalRow } from "../ImpactModal";

void React;

const row: ImpactModalRow = {
  employee_name: "Sam Doe",
  project_name: "Apollo",
  review_status: "pending",
  project_id: 3,
  user_id: 2,
  existingImpact: "prior draft text",
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
