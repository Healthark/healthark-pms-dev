/**
 * Tests for the shared "Request Changes" modal (Team Goals + Mentee Goals).
 * Covers the prompt copy — it must name the *goal title*, not the mentee —
 * plus the feedback gate and send/cancel wiring.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamGoal } from "../../../services/goal.service";
import { RequestChangesModal } from "../RequestChangesModal";

void React;

const goal = {
  id: 1,
  title: "Ship the new dashboard",
  owner_name: "Asha Mentee",
} as unknown as TeamGoal;

function renderModal(overrides: Partial<React.ComponentProps<typeof RequestChangesModal>> = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <RequestChangesModal
      goal={goal}
      onSend={onSend}
      onClose={onClose}
      isSaving={false}
      error=""
      {...overrides}
    />,
  );
  return { onSend, onClose };
}

const sendBtn = () => screen.getByRole("button", { name: /send feedback/i });

describe("RequestChangesModal", () => {
  it("prompts using the goal title, not the mentee name", () => {
    renderModal();
    expect(
      screen.getByText(/explain what needs to be revised for/i),
    ).toBeInTheDocument();
    // The goal title is shown…
    expect(screen.getByText("Ship the new dashboard")).toBeInTheDocument();
    // …and the owner/mentee name is not.
    expect(screen.queryByText("Asha Mentee")).not.toBeInTheDocument();
  });

  it("disables Send until feedback is entered, then enables it", async () => {
    const user = userEvent.setup();
    renderModal();
    expect(sendBtn()).toBeDisabled();
    await user.type(screen.getByLabelText(/feedback/i), "Make it measurable.");
    expect(sendBtn()).toBeEnabled();
  });

  it("fires onSend with the typed feedback", async () => {
    const user = userEvent.setup();
    const { onSend } = renderModal();
    await user.type(screen.getByLabelText(/feedback/i), "Tighten the scope.");
    await user.click(sendBtn());
    expect(onSend).toHaveBeenCalledWith("Tighten the scope.");
  });
});
