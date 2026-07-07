/**
 * ResponsesTable — admin support queue.
 *
 * Covers: the status filter defaults to "Pending" (and is threaded into the
 * list query), rows render an editable status control, and changing it fires
 * the update-status mutation with the row id + chosen status.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const useSupportTicketsMock = vi.fn();
const mutate = vi.fn();

vi.mock("../../queries/support", () => ({
  useSupportTickets: (filters: unknown) => useSupportTicketsMock(filters),
  useUpdateSupportTicketStatus: () => ({ mutate }),
}));

vi.mock("../../hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("./SupportTicketModal", () => ({
  SupportTicketModal: () => <div data-testid="ticket-modal" />,
}));

import { ResponsesTable } from "./ResponsesTable";

void React;

const TICKETS = [
  {
    id: 1,
    submitter_name: "Riya Sharma",
    pms_page: "Annual Goals",
    tab: "Team Goals",
    description: "Approve button does nothing.",
    remarks: null,
    status: "pending" as const,
    photo_count: 0,
    created_at: "2026-07-07T09:00:00Z",
  },
];

beforeEach(() => {
  useSupportTicketsMock.mockReset();
  mutate.mockReset();
  useSupportTicketsMock.mockReturnValue({
    data: TICKETS,
    isPending: false,
    error: null,
  });
});

describe("ResponsesTable", () => {
  it("defaults the status filter to Pending and threads it into the query", () => {
    render(<ResponsesTable />);

    const statusFilter = screen.getByLabelText("Status") as HTMLSelectElement;
    expect(statusFilter.value).toBe("pending");

    const lastFilters = useSupportTicketsMock.mock.calls.at(-1)?.[0];
    expect(lastFilters.status).toBe("pending");
  });

  it("renders an editable status control per row", () => {
    render(<ResponsesTable />);
    const rowStatus = screen.getByLabelText("Ticket status") as HTMLSelectElement;
    expect(rowStatus.value).toBe("pending");
  });

  it("fires the update mutation with the row id + chosen status", async () => {
    const user = userEvent.setup();
    render(<ResponsesTable />);

    await user.selectOptions(screen.getByLabelText("Ticket status"), "completed");

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ id: 1, status: "completed" });
  });

  it("shows an empty state when there are no responses", () => {
    useSupportTicketsMock.mockReturnValue({
      data: [],
      isPending: false,
      error: null,
    });
    render(<ResponsesTable />);
    expect(screen.getByText(/no responses match your filters/i)).toBeInTheDocument();
  });
});
