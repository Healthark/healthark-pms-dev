/**
 * Tests for the Admin "Notify" tab with recipient targeting.
 *
 * The composer + recipients hooks (useSendNotify, departments, designations,
 * users) and the toast/snackbar/confirm hooks need providers / a query client,
 * so each is mocked — leaving the targeting → live count → dispatch flow to
 * assert in isolation.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn();
const confirmMock = vi.fn();
const toastSuccess = vi.fn();
const snackbarError = vi.fn();

const departments = [
  { id: 1, name: "IDT" },
  { id: 2, name: "RWE" },
];
const designations = [
  { id: 10, name: "Consultant", level: 1 },
  { id: 11, name: "HR Executive", level: 1 },
];
// u1 mentors u2 & u3 → mentorIds = {1}; all active.
const users = [
  { id: 1, department_id: 1, designation_id: 10, mentor_id: null, is_deleted: false },
  { id: 2, department_id: 1, designation_id: 11, mentor_id: 1, is_deleted: false },
  { id: 3, department_id: 2, designation_id: 10, mentor_id: 1, is_deleted: false },
];

vi.mock("../../../queries/adminSettings", () => ({
  useSendNotify: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("../../../queries/adminReferenceData", () => ({
  useDepartments: () => ({ data: departments }),
  useDesignations: () => ({ data: designations }),
}));
vi.mock("../../../queries/users", () => ({
  useUsers: () => ({ data: users, isLoading: false }),
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
  mutateAsync.mockResolvedValue({ recipients: 3, emailed: false });
  confirmMock.mockResolvedValue(true);
});

async function fillMessage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /second half has started/i }));
}

describe("NotifyTab — recipient targeting", () => {
  it("disables Send until a subject and body are present", () => {
    render(<NotifyTab />);
    expect(screen.getByRole("button", { name: /send announcement/i })).toBeDisabled();
  });

  it("shows a live recipient count that defaults to everyone", () => {
    render(<NotifyTab />);
    // No filters → all 3 active users.
    expect(screen.getByText(/3 people/)).toBeInTheDocument();
    expect(screen.getByText(/everyone/)).toBeInTheDocument();
  });

  it("dispatches with empty filters (everyone) by default", async () => {
    const user = userEvent.setup();
    render(<NotifyTab />);
    await fillMessage(user);
    await user.click(screen.getByRole("button", { name: /send announcement/i }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      subject: "The second half of the year has started",
      body: expect.stringContaining("second half"),
      mentors_only: false,
      department_ids: [],
      designation_ids: [],
      send_email: true,
    });
  });

  it("narrows recipients by department and reflects it in the payload + count", async () => {
    const user = userEvent.setup();
    render(<NotifyTab />);
    await fillMessage(user);

    await user.click(screen.getByRole("button", { name: "IDT" })); // dept id 1 → u1,u2
    expect(screen.getByText(/2 people/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /send announcement/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ department_ids: [1], designation_ids: [] }),
    );
  });

  it("supports the mentors-only toggle (count drops to mentors)", async () => {
    const user = userEvent.setup();
    render(<NotifyTab />);
    await fillMessage(user);

    await user.click(screen.getByLabelText(/mentors only/i)); // only u1 mentors anyone
    expect(screen.getByText(/1 person/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /send announcement/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mentors_only: true }),
    );
  });

  it("does not dispatch when the confirm is cancelled", async () => {
    confirmMock.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<NotifyTab />);
    await fillMessage(user);
    await user.click(screen.getByRole("button", { name: /send announcement/i }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

describe("NotifyTab — message length guidance", () => {
  it("shows a word counter when email is on (the default)", () => {
    render(<NotifyTab />);
    expect(screen.getByText(/\/100 words/)).toBeInTheDocument();
  });

  it("switches to a character counter when email is off", async () => {
    const user = userEvent.setup();
    render(<NotifyTab />);
    await user.click(screen.getByLabelText(/also send email/i)); // default true → off
    expect(screen.getByText(/\/50 characters/)).toBeInTheDocument();
  });

  it("warns past the in-app limit but still allows sending (soft)", async () => {
    const user = userEvent.setup();
    render(<NotifyTab />);
    await fillMessage(user); // preset body is well over 50 chars
    await user.click(screen.getByLabelText(/also send email/i)); // → in-app, 50-char cap

    expect(screen.getByText(/over recommended length/i)).toBeInTheDocument();

    // Soft warning — Send is not disabled and still dispatches.
    const send = screen.getByRole("button", { name: /send announcement/i });
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  });
});
