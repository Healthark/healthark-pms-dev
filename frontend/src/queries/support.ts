import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  supportService,
  type SupportTicketDetail,
  type SupportTicketFilters,
  type SupportTicketPayload,
  type SupportTicketRow,
} from "../services/support.service";

/**
 * Query keys for the Support domain.
 *
 * `supportQueryKey` is the broadcast — `useSubmitSupportTicket` invalidates
 * it after a POST so the admin Responses list (and any open detail) refetch.
 * Filters are folded into the list key so switching page/search is its own
 * cache entry.
 */
export const supportQueryKey = ["support"] as const;
export const supportTicketsQueryKey = (filters: SupportTicketFilters = {}) =>
  ["support", "tickets", filters.pms_page ?? "", filters.q ?? ""] as const;
export const supportTicketQueryKey = (id: number) =>
  ["support", "ticket", id] as const;

// ── Reads (Admin) ──────────────────────────────────────────────────────

export function useSupportTickets(filters: SupportTicketFilters = {}) {
  return useQuery<SupportTicketRow[]>({
    queryKey: supportTicketsQueryKey(filters),
    queryFn: () => supportService.listTickets(filters),
  });
}

/** Full detail (incl. photo data URIs) for one ticket. Only fetched when
 *  `enabled` — the Responses table expands a row lazily so the list stays
 *  light. */
export function useSupportTicket(id: number | null, enabled = true) {
  const ticketId = id ?? -1;
  return useQuery<SupportTicketDetail>({
    queryKey: supportTicketQueryKey(ticketId),
    queryFn: () => supportService.getTicket(ticketId),
    enabled: enabled && id !== null && Number.isFinite(id),
  });
}

// ── Mutations ──────────────────────────────────────────────────────────

export function useSubmitSupportTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SupportTicketPayload) =>
      supportService.submitTicket(payload),
    onSuccess: () => {
      // Broadcast — refreshes the admin Responses list so a newly filed
      // ticket shows up without a manual reload.
      qc.invalidateQueries({ queryKey: supportQueryKey });
    },
  });
}
