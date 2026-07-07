/**
 * SupportForm — the "Report an Issue" intake.
 *
 * Covers: name pre-fill from the signed-in user; the PMS Page + Tab
 * comboboxes, which suggest the app's real pages/tabs but also accept
 * free-typed custom values; Tab is always available (not gated on the page);
 * the submit payload shape; and required-field validation.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn().mockResolvedValue({ id: 1 });
const toastSuccess = vi.fn();

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: { user_id: 1, full_name: "Riya Sharma", role: "Staff", org_id: 1 },
  }),
}));

vi.mock("../../hooks/useToast", () => ({
  useToast: () => ({ success: toastSuccess, info: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("../../queries/support", () => ({
  useSubmitSupportTicket: () => ({ mutateAsync, isPending: false }),
}));

import { SupportForm } from "./SupportForm";

void React;

/** Pick a suggestion from a FreeTextCombobox (opens on click, commits on the
 *  option's mousedown). */
async function pickSuggestion(input: HTMLElement, optionName: string) {
  const user = userEvent.setup();
  await user.click(input);
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.mouseDown(option);
}

beforeEach(() => {
  mutateAsync.mockClear();
  toastSuccess.mockClear();
});

describe("SupportForm", () => {
  it("pre-fills the reporter's name as a read-only field", () => {
    render(<SupportForm />);
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("Riya Sharma");
    expect(name).toHaveAttribute("readonly");
  });

  it("always shows the Tab field, even before a page is chosen", () => {
    render(<SupportForm />);
    expect(screen.getByLabelText("Tab")).toBeInTheDocument();
  });

  it("submits page + tab picked from the suggestions", async () => {
    const user = userEvent.setup();
    render(<SupportForm />);

    await pickSuggestion(screen.getByLabelText(/PMS Page/i), "Annual Goals");
    // Tab suggestions follow the chosen page.
    await pickSuggestion(screen.getByLabelText("Tab"), "Team Goals");
    await user.type(
      screen.getByLabelText(/Issue \/ Query Description/i),
      "  Approve button does nothing  ",
    );

    await user.click(screen.getByRole("button", { name: /Submit Issue/i }));

    expect(mutateAsync).toHaveBeenCalledWith({
      pms_page: "Annual Goals",
      tab: "Team Goals",
      description: "Approve button does nothing",
      remarks: null,
      photos: [],
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("accepts custom typed page and tab values (not in the dropdown)", async () => {
    const user = userEvent.setup();
    render(<SupportForm />);

    await user.type(screen.getByLabelText(/PMS Page/i), "Mobile App");
    await user.type(screen.getByLabelText("Tab"), "Login Screen");
    await user.type(
      screen.getByLabelText(/Issue \/ Query Description/i),
      "Crash on login",
    );

    await user.click(screen.getByRole("button", { name: /Submit Issue/i }));

    expect(mutateAsync).toHaveBeenCalledWith({
      pms_page: "Mobile App",
      tab: "Login Screen",
      description: "Crash on login",
      remarks: null,
      photos: [],
    });
  });

  it("blocks submit and shows an error when the description is empty", async () => {
    const user = userEvent.setup();
    render(<SupportForm />);

    await user.type(screen.getByLabelText(/PMS Page/i), "Dashboard");
    await user.click(screen.getByRole("button", { name: /Submit Issue/i }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/please describe the issue/i)).toBeInTheDocument();
  });

  it("blocks submit when no PMS page is provided", async () => {
    const user = userEvent.setup();
    render(<SupportForm />);

    await user.type(
      screen.getByLabelText(/Issue \/ Query Description/i),
      "Something broke",
    );
    await user.click(screen.getByRole("button", { name: /Submit Issue/i }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/select the pms page/i)).toBeInTheDocument();
  });
});
