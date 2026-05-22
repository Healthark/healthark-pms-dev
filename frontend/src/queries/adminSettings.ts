import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminService,
  type AdminSettingsUpdatePayload,
  type SystemSettings,
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
