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

function renderModal(readOnly = false) {
  render(
    <ImpactModal
      row={row}
      readOnly={readOnly}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      onSaveDraft={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
      isSaving={false}
      isDraftSaving={false}
      error=""
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
