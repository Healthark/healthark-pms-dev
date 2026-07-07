/**
 * support.service.ts — API contract for the Support ("Report an Issue")
 * module.
 *
 * Endpoints:
 *   POST /support/tickets          → submit a ticket (any authenticated user)
 *   GET  /support/tickets          → Responses queue (Admin only)
 *   GET  /support/tickets/{id}     → one ticket + photos (Admin only)
 *
 * Photos ride inline as base64 image data URIs (the deployment has no object
 * storage). The list endpoint returns only a `photo_count`; the detail
 * endpoint carries the actual data URIs.
 */

import apiClient from "./api.client";
import type { SupportStatus } from "../utils/supportOptions";

export type { SupportStatus } from "../utils/supportOptions";

// ── Submission ──────────────────────────────────────────────────────

export interface SupportPhotoIn {
  /** base64 image data URI: "data:image/png;base64,…" */
  data_uri: string;
  filename?: string | null;
}

export interface SupportTicketPayload {
  pms_page: string;
  tab?: string | null;
  description: string;
  remarks?: string | null;
  photos?: SupportPhotoIn[];
}

// ── Responses queue (Admin) ─────────────────────────────────────────

export interface SupportTicketRow {
  id: number;
  submitter_name: string;
  pms_page: string;
  tab: string | null;
  description: string;
  remarks: string | null;
  status: SupportStatus;
  photo_count: number;
  /** ISO timestamp. */
  created_at: string;
}

export interface SupportPhotoOut {
  id: number;
  data_uri: string;
  filename: string | null;
}

export interface SupportTicketDetail {
  id: number;
  submitter_name: string;
  pms_page: string;
  tab: string | null;
  description: string;
  remarks: string | null;
  status: SupportStatus;
  created_at: string;
  photos: SupportPhotoOut[];
}

export interface SupportTicketFilters {
  /** Exact PMS-page filter. */
  pms_page?: string;
  /** Free-text search over reporter / description / remarks / tab. */
  q?: string;
  /** Lifecycle-status filter. */
  status?: SupportStatus;
}

// ── Service ─────────────────────────────────────────────────────────

export const supportService = {
  submitTicket: async (payload: SupportTicketPayload): Promise<{ id: number }> => {
    const res = await apiClient.post<{ id: number }>("/support/tickets", payload);
    return res.data;
  },

  listTickets: async (
    filters: SupportTicketFilters = {},
  ): Promise<SupportTicketRow[]> => {
    const params: Record<string, string> = {};
    if (filters.pms_page) params.pms_page = filters.pms_page;
    if (filters.q) params.q = filters.q;
    if (filters.status) params.status = filters.status;
    const res = await apiClient.get<SupportTicketRow[]>("/support/tickets", {
      params,
    });
    return res.data;
  },

  getTicket: async (id: number): Promise<SupportTicketDetail> => {
    const res = await apiClient.get<SupportTicketDetail>(`/support/tickets/${id}`);
    return res.data;
  },

  updateStatus: async (
    id: number,
    status: SupportStatus,
  ): Promise<{ id: number; status: SupportStatus }> => {
    const res = await apiClient.patch<{ id: number; status: SupportStatus }>(
      `/support/tickets/${id}/status`,
      { status },
    );
    return res.data;
  },
};
