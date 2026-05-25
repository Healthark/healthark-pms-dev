import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  profileService,
  type PasswordChangePayload,
  type UserProfile,
  type UserRoleExpectation,
} from "../services/profile.service";

/**
 * Strict, shared query keys for the profile domain.
 *
 * `profileQueryKey` is the broadcast — `useChangePassword` invalidates
 * it on success (cheap; it just refreshes the profile card if it's
 * mounted). The session-claims refresh that flips
 * `must_change_password` to false lives on `AuthProvider.refreshSession`
 * and is still triggered by the PasswordChangeCard component itself —
 * that's a different cache (auth/session, not TanStack-managed) so
 * keeping the call there is correct.
 */
export const profileQueryKey = ["profile"] as const;
export const myProfileQueryKey = ["profile", "me"] as const;
export const myExpectationsQueryKey = [
  "profile",
  "me",
  "expectations",
] as const;

// Profile + role expectations are effectively static per session —
// the profile only changes when HR edits the user record (rare during
// a single session), and role expectations are quarterly at most.
// Long staleTime keeps both warm across the whole session.
const PROFILE_STALE_TIME = 10 * 60_000;
const EXPECTATIONS_STALE_TIME = 15 * 60_000;

// ── Reads ─────────────────────────────────────────────────────────────

export function useProfile() {
  return useQuery<UserProfile>({
    queryKey: myProfileQueryKey,
    queryFn: () => profileService.getProfile(),
    staleTime: PROFILE_STALE_TIME,
  });
}

/**
 * Current user's role expectations — used by the My Goals tab to
 * surface Firm Growth + Competency & Skills text above the goal list.
 * Failure is non-fatal in the only consumer (the panel just doesn't
 * render), so callers can ignore the error variable.
 */
export function useMyExpectations() {
  return useQuery<UserRoleExpectation>({
    queryKey: myExpectationsQueryKey,
    queryFn: () => profileService.getMyExpectations(),
    staleTime: EXPECTATIONS_STALE_TIME,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PasswordChangePayload) =>
      profileService.changePassword(payload),
    onSuccess: () => {
      // Profile row itself doesn't carry the password, but invalidating
      // the broadcast key keeps the pattern consistent and is essentially
      // free (one active query at most). The session-claims refresh
      // (`refreshSession()` for `must_change_password`) is triggered by
      // the consumer (PasswordChangeCard) — that's not a TanStack-managed
      // cache, so it stays out of this hook.
      qc.invalidateQueries({ queryKey: profileQueryKey });
    },
  });
}
