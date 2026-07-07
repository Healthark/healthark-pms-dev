/**
 * Support page — role-aware shell.
 *
 * Non-admins see just the Report-an-Issue form. Admins get two tabs —
 * "Report an Issue" (the working form, shown first/by default) and
 * "Responses" (the queue) — and can switch between them.
 *
 * The form + responses table are mocked to keep this focused on the page's
 * own branching.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const auth = vi.hoisted(() => ({
  current: { user: { user_id: 1, full_name: "User", role: "Staff", org_id: 1 } },
}));

vi.mock("../hooks/useAuth", () => ({ useAuth: () => auth.current }));

vi.mock("../components/support/SupportForm", () => ({
  SupportForm: () => <div data-testid="support-form">form</div>,
}));

vi.mock("../components/support/ResponsesTable", () => ({
  ResponsesTable: () => <div data-testid="responses-table">responses</div>,
}));

import { Support } from "./Support";

void React;

beforeEach(() => {
  auth.current = {
    user: { user_id: 1, full_name: "Riya", role: "Staff", org_id: 1 },
  };
});

describe("Support page", () => {
  it("shows the form (no admin tabs) for a non-admin", () => {
    render(<Support />);
    expect(screen.getByTestId("support-form")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Responses" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("responses-table")).not.toBeInTheDocument();
  });

  it("defaults an admin to the Report an Issue form, with a Responses tab", () => {
    auth.current = {
      user: { user_id: 9, full_name: "Admin", role: "Admin", org_id: 1 },
    };
    render(<Support />);
    expect(
      screen.getByRole("button", { name: "Report an Issue" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Responses" })).toBeInTheDocument();
    // Report an Issue is first/default.
    expect(screen.getByTestId("support-form")).toBeInTheDocument();
    expect(screen.queryByTestId("responses-table")).not.toBeInTheDocument();
  });

  it("switches an admin to the Responses queue and back", async () => {
    auth.current = {
      user: { user_id: 9, full_name: "Admin", role: "Admin", org_id: 1 },
    };
    const user = userEvent.setup();
    render(<Support />);

    await user.click(screen.getByRole("button", { name: "Responses" }));
    expect(screen.getByTestId("responses-table")).toBeInTheDocument();
    expect(screen.queryByTestId("support-form")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Report an Issue" }));
    expect(screen.getByTestId("support-form")).toBeInTheDocument();
    expect(screen.queryByTestId("responses-table")).not.toBeInTheDocument();
  });
});
