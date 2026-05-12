/**
 * Export service — Excel downloads gated to HR / management on the backend.
 *
 * The blob download helper is net-new for the codebase; it handles three
 * gotchas:
 *   1. The Content-Disposition header is parsed to recover the server-
 *      generated filename (else axios doesn't expose it to us).
 *   2. If the server returns a JSON error instead of xlsx (e.g. 403),
 *      axios still hands back a Blob — we sniff Content-Type and re-throw
 *      the parsed `{detail}` as a regular Error so callers can use
 *      getErrorMessage(...) consistently.
 *   3. URL.createObjectURL leaks if not revoked — we revoke in a finally.
 */

import type { AxiosResponse } from "axios";
import apiClient from "./api.client";

export interface EmployeeSlim {
  id: number;
  full_name: string;
  employee_code: string;
  email: string;
  is_deleted: boolean;
}

export interface ExportEligibility {
  can_export: boolean;
  reason: string;
}

type Params = Record<string, string | number | undefined | null>;

function cleanParams(params?: Params): Record<string, string | number> {
  if (!params) return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      out[k] = v;
    }
  }
  return out;
}

function parseFilename(disposition: string | undefined, fallback: string): string {
  if (!disposition) return fallback;
  // Naive but sufficient for our Content-Disposition shape:
  //   attachment; filename="pms-users-FY26-27-20260512-1430.xlsx"
  const quoted = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return quoted?.[1] ?? fallback;
}

async function blobToError(response: AxiosResponse<Blob>): Promise<Error> {
  // Best-effort: read the blob as text and try to pull the {detail} field.
  try {
    const text = await response.data.text();
    try {
      const json = JSON.parse(text);
      if (json && typeof json.detail === "string") {
        return new Error(json.detail);
      }
    } catch {
      /* not JSON, fall through */
    }
    if (text) return new Error(text);
  } catch {
    /* swallow */
  }
  return new Error("Export failed.");
}

async function downloadBlob(
  url: string,
  params: Params,
  fallbackName: string,
): Promise<void> {
  const response = await apiClient.get<Blob>(url, {
    params: cleanParams(params),
    responseType: "blob",
  });

  // If the server slipped in a JSON error (rare since axios would have
  // rejected on non-2xx, but defensive) — surface as a real error.
  const contentType = (response.headers["content-type"] ?? "").toString();
  if (contentType.includes("application/json")) {
    throw await blobToError(response);
  }

  const disposition = (response.headers["content-disposition"] ?? "").toString();
  const filename = parseFilename(disposition, fallbackName);

  const objectUrl = URL.createObjectURL(response.data);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const exportService = {
  getEligibility: async (): Promise<ExportEligibility> => {
    const r = await apiClient.get<ExportEligibility>("/exports/eligibility");
    return r.data;
  },

  listEmployees: async (q?: string): Promise<EmployeeSlim[]> => {
    const r = await apiClient.get<EmployeeSlim[]>("/exports/employees", {
      params: cleanParams({ q }),
    });
    return r.data;
  },

  downloadUsers: (fy?: string, scope: "inline" | "central" = "inline") =>
    downloadBlob("/exports/users", { fy, scope }, "pms-users.xlsx"),

  downloadProjects: (fy?: string, scope: "inline" | "central" = "inline") =>
    downloadBlob("/exports/projects", { fy, scope }, "pms-projects.xlsx"),

  downloadGoals: (
    params: { fy?: string; user_id?: number },
    scope: "inline" | "central" = "inline",
  ) =>
    downloadBlob(
      "/exports/goals",
      { ...params, scope },
      "pms-annual-goals.xlsx",
    ),

  downloadAnnualReviews: (
    params: { fy?: string; user_id?: number },
    scope: "inline" | "central" = "inline",
  ) =>
    downloadBlob(
      "/exports/annual-reviews",
      { ...params, scope },
      "pms-annual-reviews.xlsx",
    ),

  downloadProjectReviews: (
    params: { fy?: string; user_id?: number },
    scope: "inline" | "central" = "inline",
  ) =>
    downloadBlob(
      "/exports/project-reviews",
      { ...params, scope },
      "pms-project-reviews.xlsx",
    ),

  downloadCombined: (fy?: string) =>
    downloadBlob(
      "/exports/combined",
      { fy, scope: "central" },
      "pms-combined.xlsx",
    ),

  downloadEmployee: (userId: number, fy?: string) =>
    downloadBlob(
      `/exports/employee/${userId}`,
      { fy, scope: "central" },
      `pms-employee-${userId}.xlsx`,
    ),
};
