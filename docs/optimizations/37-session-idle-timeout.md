# 37 — 30-minute idle session timeout

> Sliding (rolling) inactivity timeout. An active user is never logged out; 30
> minutes after the last activity the session expires and the user is returned
> to the login screen with a "session expired" notice.

## Context

Before this change the auth JWT had a fixed 7-day lifetime
(`ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7`). The `exp` was stamped once at
login and never moved — so the session was neither short nor activity-aware. A
laptop left unlocked stayed authenticated for a week.

Goal: each session lasts 30 minutes of **inactivity**. Activity slides the
window forward; silence expires it and logs the user out automatically.

## Design

A **sliding window**, anchored on the JWT `exp` as the server-side source of
truth, driven by a frontend activity tracker:

1. **Token lifetime → 30 min.** `ACCESS_TOKEN_EXPIRE_MINUTES = 30`. The access
   cookie's `max_age` already follows this constant.
2. **`POST /auth/refresh`** re-mints the access cookie with a fresh 30-min
   `exp` (and bumps the CSRF cookie's `max_age` to match, reusing its value).
   Requires a still-valid session (`CurrentUser`), so it's CSRF-protected like
   every other mutating route — *not* added to the CSRF exempt list.
3. **`useIdleTimeout`** (frontend) listens to real user activity
   (`mousemove`/`mousedown`/`keydown`/`scroll`/`touchstart`), throttled to at
   most one `/auth/refresh` per minute. A 30-second watchdog compares
   `now - lastActivity` against the 30-min limit and fires `onExpire()`.
4. **Auto-logout falls out of expiry, not a server timer.** When the user goes
   idle, nothing refreshes the cookie; 30 min later the token is expired and the
   next request 401s in `get_current_user`. There is no idle bookkeeping on the
   server.

### Why activity-driven (not refresh-on-every-API-call)

A "tab open, user typing in a long form, no API calls" scenario should *not*
expire. Counting mouse/keyboard activity handles that; counting only network
requests would not. The JWT `exp` remains the hard backstop regardless.

### Cross-tab

`lastActivityAt` lives in `localStorage`, so activity in any tab keeps every tab
alive (the auth cookie is shared across same-origin tabs — one tab's refresh
slides the window for all). The "session expired" marker uses `sessionStorage`
so it can't leak into a deliberate fresh sign-in elsewhere.

## What changed

### Backend
- [config.py](../../backend/app/core/config.py) — `ACCESS_TOKEN_EXPIRE_MINUTES`
  `60*24*7` → `30`, with a comment pinning it to the frontend `IDLE_LIMIT_MS`.
- [auth_routes.py](../../backend/app/api/routes/auth_routes.py) — new
  `POST /auth/refresh` (`refresh_session`). Mirrors `login`'s cookie-setting;
  reuses the existing CSRF value, minting one only if absent.

### Frontend
- [useIdleTimeout.ts](../../frontend/src/hooks/useIdleTimeout.ts) — **new** hook;
  exports `IDLE_LIMIT_MS`, `REFRESH_THROTTLE_MS`, `LAST_ACTIVITY_KEY`,
  `SESSION_EXPIRED_KEY`.
- [auth.service.ts](../../frontend/src/services/auth.service.ts) — `refresh()`.
- [AuthProvider.tsx](../../frontend/src/contexts/AuthProvider.tsx) — arms
  `useIdleTimeout(isAuthenticated, handleIdleExpire)`; on expiry sets the
  `sessionStorage` marker then `logout()` (ProtectedRoute then soft-redirects to
  `/login`, so the marker survives the hop).
- [Login.tsx](../../frontend/src/pages/Login.tsx) — read-and-clear the marker on
  mount; renders a blue info banner: *"Your session expired due to inactivity.
  Please sign in again."*

### Tests
- [test_session_refresh.py](../../backend/tests/test_session_refresh.py) —
  refresh re-issues a ~30-min-ahead cookie + reuses CSRF; mints CSRF when
  absent; expired token → 401 (the logout trigger).
- [useIdleTimeout.test.ts](../../frontend/src/hooks/useIdleTimeout.test.ts) —
  seed refresh on mount; disabled no-op; expiry at the limit; throttle + renew;
  activity defers expiry; cleanup on unmount.
- [Login.test.tsx](../../frontend/src/pages/Login.test.tsx) — banner shows + the
  marker is cleared; absent on a normal visit.

## The shared 30-minute constant

The window lives in two places that **must** stay in sync:
`ACCESS_TOKEN_EXPIRE_MINUTES` (backend) and `IDLE_LIMIT_MS` (frontend). Each
carries a comment pointing at the other. A future improvement is to surface the
backend value to the client (e.g. on the session payload) so there is one
source of truth.

## Risks & gotchas

- **Background-tab timer throttling** delays the watchdog in hidden tabs, but
  only delays the *prompt* — the server `exp` still enforces the hard cap.
- **Laptop sleep / clock jump:** the watchdog compares wall-clock timestamps,
  so on resume it sees a stale `lastActivityAt` and expires immediately.
- **Shorter login cookie:** the 7-day → 30-min change also shortens a
  fresh-login cookie. Confirmed nothing else assumed a 7-day cookie (only
  `login`/`max_age` referenced the constant).

## Verification (manual)

| Step | Expected |
|---|---|
| Log in, stay active (move mouse/type) | Never logged out; `/auth/refresh` fires ~once/min |
| Log in, go idle 30 min | Redirected to `/login` with the "session expired" notice |
| Active in tab A, idle in tab B | Both stay alive (shared `lastActivityAt` + cookie) |
| Idle expiry while a mutation was mid-flight | Next request 401s → `forceLogout()` backstop |
| Normal logout / re-login | No stale "session expired" notice |
