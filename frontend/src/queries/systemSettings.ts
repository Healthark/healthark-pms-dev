import { useQuery } from "@tanstack/react-query";
import {
  systemSettingsService,
  type SystemSettingsResponse,
} from "../services/system-settings.service";

/**
 * Strict, shared query key for the org-wide system settings. Read by the
 * SystemSettingsProvider; written (indirectly) by AdminPanel's
 * handleSaveSettings via the context's refreshSettings → refetch path.
 */
export const systemSettingsQueryKey = ["system-settings"] as const;

/**
 * Read-only query hook for the public `GET /settings/` endpoint.
 *
 * Gated by `enabled` so we don't fire before the user is authenticated
 * (matches the prior "only fetch when user is truthy" effect behavior).
 */
export function useSystemSettingsQuery(enabled: boolean) {
  return useQuery<SystemSettingsResponse>({
    queryKey: systemSettingsQueryKey,
    queryFn: () => systemSettingsService.getSettings(),
    enabled,
  });
}
