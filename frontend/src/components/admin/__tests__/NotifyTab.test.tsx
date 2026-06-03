/**
 * Tests for the PR 5 Admin "Notify" tab.
 *
 * NotifyTab leans on four hooks (useSendNotify mutation, useToast, useSnackbar,
 * useConfirm) that need providers / a query client. They're irrelevant to the
 * form logic under test, so each is mocked — leaving the preset → confirm →
 * dispatch flow to assert in isolation.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn();
const confirmMock = vi.fn();
const toastSuccess = vi.fn();
const snackbarError = vi.fn();

vi.mock("../../../queries/adminSettings", () => ({
  useSendNotify: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("../../../hooks/useToast", () => ({
  useToast: () => ({ success: toastSuccess, info: vi.fn() }),
}));
vi.mock("../../../hooks/useSnackbar", () => ({
  useSnackbar: () => ({ error: snackbarError }),
}));
vi.mock("../../../hooks/useConfirm", () => ({
  useConfirm: () => confirmMock,
}));

import { NotifyTab } from "../NotifyTab";

void React;

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ recipients: 5, emailed: false });
  confirmMock.mockResolvedValue(true);
});

describe("NotifyTab", () => {
  it("disables Send until a subject and body are present", () => {
    render(<NotifyTab />);
    expect(screen.getByRole("button", { name: /send announcement/i })).toBeDisabled();
  });

  it("a preset fills the form and Send dispatches the broadcast", async () => {
    const user = userEvent.setup();
    render(<NotifyTab />);

    await user.click(screen.getByRole("button", { name: /second half has started/i }));

    const send = screen.getByRole("button", { name: /send announcement/i });
    expect(send).toBeEnabled();
    await user.click(send);

    expect(confirmMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      subject: "The second half of the year has started",
      body: expect.stringContaining("second half"),
      audience: "all",
      send_email: true,
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("does not dispatch when the confirm is cancelled", async () => {
    confirmMock.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<NotifyTab />);

    await user.click(screen.getByRole("button", { name: /new financial year/i }));
    await user.click(screen.getByRole("button", { name: /send announcement/i }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("sends a custom message to mentors with email disabled", async () => {
    const user = userEvent.setup();
    render(<NotifyTab />);

    await user.type(screen.getByLabelText(/subject/i), "Custom subject");
    await user.type(screen.getByLabelText(/message/i), "Custom body");
    await user.selectOptions(screen.getByLabelText(/audience/i), "mentors");
    await user.click(screen.getByLabelText(/also send email/i)); // default true → off

    await user.click(screen.getByRole("button", { name: /send announcement/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      subject: "Custom subject",
      body: "Custom body",
      audience: "mentors",
      send_email: false,
    });
  });
});
