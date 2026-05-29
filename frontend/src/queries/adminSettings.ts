import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminService,
  type AdminSettingsUpdatePayload,
  type SystemSettings,
  type YearOptionsResponse,
  type YearSettingsResponse,
  type YearSettingsUpdatePayload,
  type YearPreflightResponse,
} from "../services/admin.service";
import { systemSettingsQueryKey } from "./systemSettings";

/**
 * Strict, shared query key for the admin-side settings view
 * (`GET /admin/settings`). This is a *different* endpoint from the public
 * `GET /settings/` read consumed across the rest of the app — see
 * [systemSettings.ts](./systemSettings.ts) — but the two share the same
 * underlying data. Mutations here therefore invalidate both keys so the
 * Topbar / cycle banners / form fields all reflect the saved value.
 */
export const adminSettingsQueryKey = ["admin-settings"] as const;

export function useAdminSettings() {
  return useQuery<SystemSettings>({
    queryKey: adminSettingsQueryKey,
    queryFn: () => adminService.getSettings(),
  });
}

export function useUpdateAdminSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminSettingsUpdatePayload) =>
      adminService.updateSettings(payload),
    onSuccess: () => {
      // Invalidate both: the admin form re-hydrates from /admin/settings,
      // and every page consuming useSystemSettings() picks up the new
      // /settings/ payload on its next render.
      qc.invalidateQueries({ queryKey: adminSettingsQueryKey });
      qc.invalidateQueries({ queryKey: systemSettingsQueryKey });
    },
  });
}

// ---------------------------------------------------------------------------
// Per-fiscal-year access configuration
// ---------------------------------------------------------------------------
// Flat query keys (healthark has no queryKeys factory):
//   ["admin-settings","years"]                  → year dropdown options
//   ["admin-settings","year", fy]               → one FY's saved toggles
//   ["admin-settings","year", fy, "preflight"]  → in-flight impact check
// The update mutation writes the fresh row back into its cache and
// invalidates the years list, the admin-settings root, and the public
// system-settings key so banners / feature pages refresh.

/** Year dropdown options (sorted desc) for the System Settings tab. */
export function useSettingsYears() {
  return useQuery<YearOptionsResponse>({
    queryKey: ["admin-settings", "years"],
    queryFn: () => adminService.listSettingsYears(),
  });
}

/** The selected FY's saved access toggles. Disabled until `fy` is set. */
export function useYearSettings(fy: string) {
  return useQuery<YearSettingsResponse>({
    queryKey: ["admin-settings", "year", fy],
    queryFn: () => adminService.getYearSettings(fy),
    enabled: !!fy,
  });
}

/** In-flight impact preflight for the selected FY. Disabled until `fy`
 *  is set; pass `enabled=false` to defer the fetch until it's needed
 *  (e.g. only while the save-confirmation modal is open). */
export function useYearPreflight(fy: string, enabled = true) {
  return useQuery<YearPreflightResponse>({
    queryKey: ["admin-settings", "year", fy, "preflight"],
    queryFn: () => adminService.getYearPreflight(fy),
    enabled: !!fy && enabled,
  });
}

/** PATCH a single FY's four toggles. On success, seeds the fresh row into
 *  its own cache and invalidates the years list, the admin-settings root,
 *  and the public system-settings key. */
export function useUpdateYearSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      fy,
      payload,
    }: {
      fy: string;
      payload: YearSettingsUpdatePayload;
    }) => adminService.updateYearSettings(fy, payload),
    onSuccess: (fresh) => {
      qc.setQueryData(["admin-settings", "year", fresh.fy_label], fresh);
      qc.invalidateQueries({ queryKey: ["admin-settings", "years"] });
      qc.invalidateQueries({ queryKey: adminSettingsQueryKey });
      qc.invalidateQueries({ queryKey: systemSettingsQueryKey });
    },
  });
}
