/**
 * Tests for the Self Annual Review form modal — focused on the "Save Draft"
 * gate: the action stays disabled until the user types the first character
 * in the overall-review field, then becomes clickable and fires onSaveDraft.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnnualReview } from "../../../services/annual-review.service";
import { SelfReviewFormModal } from "../SelfReviewFormModal";

void React;

function renderModal(overrides: Partial<React.ComponentProps<typeof SelfReviewFormModal>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onSaveDraft = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <SelfReviewFormModal
      cycleName="FY26-27"
      onSubmit={onSubmit}
      onSaveDraft={onSaveDraft}
      onClose={onClose}
      isSaving={false}
      isDraftSaving={false}
      error=""
      {...overrides}
    />,
  );
  return { onSubmit, onSaveDraft, onClose };
}

const draftBtn = () => screen.getByRole("button", { name: /save draft/i });
const reviewField = () =>
  screen.getByPlaceholderText(/reflect on your performance/i);

describe("SelfReviewFormModal — Save Draft gate", () => {
  it("disables Save Draft on open when the review is empty", () => {
    renderModal();
    expect(draftBtn()).toBeDisabled();
  });

  it("keeps Save Draft disabled for whitespace-only input", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(reviewField(), "   ");
    expect(draftBtn()).toBeDisabled();
  });

  it("enables Save Draft once the first character is typed", async () => {
    const user = userEvent.setup();
    renderModal();
    expect(draftBtn()).toBeDisabled();
    await user.type(reviewField(), "P");
    expect(draftBtn()).toBeEnabled();
  });

  it("fires onSaveDraft with the typed content when clicked", async () => {
    const user = userEvent.setup();
    const { onSaveDraft } = renderModal();
    await user.type(reviewField(), "Solid year overall.");
    await user.click(draftBtn());
    expect(onSaveDraft).toHaveBeenCalledWith({
      self_overall_review: "Solid year overall.",
    });
  });

  it("enables Save Draft immediately when an existing draft has content", () => {
    const draft = {
      id: 1,
      cycle_name: "FY26-27",
      status: "draft",
      self_overall_review: "Prior draft text",
      self_performance_rating: null,
    } as unknown as AnnualReview;
    renderModal({ draft });
    expect(draftBtn()).toBeEnabled();
  });
});
