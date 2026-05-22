/**
 * SystemSettingsProvider.tsx — State Logic & Data Fetching.
 *
 * Phase C migration note:
 *   The provider used to own its own useState + useEffect + service call.
 *   It now delegates fetching to TanStack Query (see
 *   src/queries/systemSettings.ts) so concurrent mounts dedup to a single
 *   network request and React StrictMode no longer fires the GET twice.
 *
 * The public context shape (settings / isLoading / error / refreshSettings)
 * is preserved unchanged — the ~18 consumers across the app keep working
 * without modification.
 *
 * Performance:
 *   - useMemo on the context value object so consumers don't re-render
 *     unnecessarily when the provider re-renders.
 *   - refetch is stable across renders (TanStack guarantee).
 */

import { useCallback, useMemo, type ReactNode } from "react";
import {
  SystemSettingsContext,
  type SystemSettingsContextType,
} from "./SystemSettingsContext";
import { useSystemSettingsQuery } from "../queries/systemSettings";
import { useAuth } from "../hooks/useAuth";

/**
 * Map the query's Error object back to the user-facing string copy that
 * the previous provider exposed. Keeps the 404 ("not configured yet")
 * vs generic-failure split intact so the Topbar / banners read the same.
 */
function mapQueryError(err: unknown): string | null {
  if (!err) return null;
  if (
    err !== null &&
    typeof err === "object" &&
    "response" in err &&
    typeof (err as Record<string, unknown>).response === "object"
  ) {
    const response = (err as { response: { status: number } }).response;
    if (response.status === 404) {
      return "System settings have not been configured for this organization.";
    }
    return "Failed to load system settings. Please try again.";
  }
  return "An unexpected error occurred while loading settings.";
}

export function SystemSettingsProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { user } = useAuth();

  const { data, isLoading, error, refetch } = useSystemSettingsQuery(!!user);

  const refreshSettings = useCallback(async (): Promise<void> => {
    await refetch();
  }, [refetch]);

  const contextValue: SystemSettingsContextType = useMemo(
    () => ({
      settings: data ?? null,
      isLoading,
      error: mapQueryError(error),
      refreshSettings,
    }),
    [data, isLoading, error, refreshSettings],
  );

  return (
    <SystemSettingsContext.Provider value={contextValue}>
      {children}
    </SystemSettingsContext.Provider>
  );
}
