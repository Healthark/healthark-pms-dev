# Auth Module — Security & UX Fixes

_Last updated: 2026-04-22_

This document records every change made to the login / authentication module across two work sessions. It captures **what was broken, why, how we fixed it, and how to verify the fix** — one-stop reference for onboarding, code review, or future audits.

---

## Table of contents

1. [Audit summary](#audit-summary)
2. [Wave 1 — Correctness bugs](#wave-1--correctness-bugs)
   - [A1 — 403 "deactivated" not handled on frontend](#a1--403-deactivated-not-handled-on-frontend)
   - [A2 — Stale JWT claims, never refreshed](#a2--stale-jwt-claims-never-refreshed)
   - [A3 — Silent yearly-goal failures when mentor vanishes](#a3--silent-yearly-goal-failures-when-mentor-vanishes)
   - [A4 — No `org_id` verification on JWT decode](#a4--no-org_id-verification-on-jwt-decode)
3. [Wave 1 — UX bugs](#wave-1--ux-bugs)
   - [B5 — `location.from` captured but ignored](#b5--locationfrom-captured-but-ignored)
   - [B6 — Multi-tab logout race](#b6--multi-tab-logout-race)
   - [B7 — `isApiError` guard too permissive](#b7--isapierror-guard-too-permissive)
   - [B8 — Email case sensitivity at login](#b8--email-case-sensitivity-at-login)
   - [B10 — Already-logged-in user sees a flash of /login](#b10--already-logged-in-user-sees-a-flash-of-login)
4. [Wave 2 — Architectural changes](#wave-2--architectural-changes)
   - [C12 — HttpOnly cookie auth + CSRF defence](#c12--httponly-cookie-auth--csrf-defence)
   - [C14 — Admin-initiated password reset](#c14--admin-initiated-password-reset)
5. [Deferred (not yet fixed)](#deferred-not-yet-fixed)
6. [Deploy / run checklist](#deploy--run-checklist)
7. [End-to-end test plan](#end-to-end-test-plan)

---

## Audit summary

| # | Area | Issue | Status |
|---|------|-------|--------|
| A1 | Frontend | Force-logout on `403 "deactivated"` | ✅ Fixed |
| A2 | Cross | Refresh role/features/mentor claims without re-login | ✅ Fixed |
| A3 | Backend | Reject goal creation when mentor is NULL or soft-deleted | ✅ Fixed |
| A4 | Backend | Verify `org_id` claim against live user row | ✅ Fixed |
| B5 | Frontend | Honour intended-destination after login | ✅ Fixed |
| B6 | Frontend | Multi-tab logout sync | ✅ Fixed |
| B7 | Frontend | Tighten `isApiError` type guard | ✅ Fixed |
| B8 | Backend | Case-insensitive email on login | ✅ Fixed |
| B9 | Frontend | Tenant tab is cosmetic — enforce or remove | ⏸️ Deferred |
| B10 | Frontend | Synchronous guard against login-page flash | ✅ Fixed |
| C11 | Backend | Rate limit `/login` | ⏸️ Deferred |
| C12 | Cross | JWT out of localStorage → HttpOnly cookie + CSRF | ✅ Fixed |
| C13 | Backend | Server-side token revocation / "log out everywhere" | ⏸️ Deferred |
| C14 | Cross | Admin-initiated password reset (forgot password) | ✅ Fixed |

---

## Wave 1 — Correctness bugs

### A1 — 403 "deactivated" not handled on frontend

**Problem.** The axios response interceptor force-logged-out only on `401`. The backend returns `403 "This account has been deactivated."` when a user's token is still valid but admin soft-deleted them. Every subsequent request showed a cryptic error and the token never cleared.

**Fix.** [frontend/src/services/api.client.ts](frontend/src/services/api.client.ts) — the interceptor now also treats `403` with a body `detail` containing the word "deactivated" as a forced logout. Extracted a single `forceLogout()` helper so both branches share one path.

```ts
const isDeactivated =
  status === 403 &&
  typeof detail === "string" &&
  detail.toLowerCase().includes("deactivated");

if (status === 401 || isDeactivated) {
  forceLogout();
}
```

**Why this shape.** We pattern-match on the `detail` string rather than blanket-treating every 403 as logout because regular "not authorized for this resource" 403s are normal and should surface as errors to callers, not evict the user.

---

### A2 — Stale JWT claims, never refreshed

**Problem.** `role`, `features`, `has_mentees`, `has_mentor` were computed once at login and cached in localStorage for 7 days. Admin promotions, feature toggles, and mentor reassignments had no effect on a user's session until they logged out and back in.

**Fix.**

1. Extracted the claim-computation into a shared helper `_build_session(user, db)` — [backend/app/api/routes/auth_routes.py](backend/app/api/routes/auth_routes.py#L23). Used both by `/auth/login` at token issue time and by the new endpoint.
2. New endpoint `GET /auth/session` returns a fresh `SessionResponse` — same shape as login minus the token.
3. Frontend `authService.getSession()` + `AuthProvider.refreshSession()` re-pull claims on app mount and merge into state + localStorage.
4. `refreshSession` also exposed on `AuthContext` so consumers (e.g. `PasswordChangeCard`) can force a refresh after an action that changed claims.

**Key files.** [backend/app/schemas/auth_schemas.py](backend/app/schemas/auth_schemas.py) (`SessionResponse`, `TokenResponse` extends it), [backend/app/api/routes/auth_routes.py](backend/app/api/routes/auth_routes.py), [frontend/src/services/auth.service.ts](frontend/src/services/auth.service.ts), [frontend/src/contexts/AuthContext.ts](frontend/src/contexts/AuthContext.ts), [frontend/src/contexts/AuthProvider.tsx](frontend/src/contexts/AuthProvider.tsx).

**Why this shape.** We deliberately did **not** reissue a new JWT on `/auth/session` — the token's TTL still controls forced re-login. We only refresh the *body-level claims* the UI uses for routing. The token itself carries `user_id`, `org_id`, `role` (for backend auth checks) and those are revalidated per-request via `get_current_user` + the new A4 check.

---

### A3 — Silent yearly-goal failures when mentor vanishes

**Problem.** The senior's invariant "every employee has a mentor" is not enforced by the schema. When admin cleared a user's `mentor_id` or soft-deleted their mentor, `has_mentor` stayed cached as `true` in the frontend. Yearly-goal creation would then fail at a lower layer with an unhelpful error.

**Fix — two layers.**

1. **Server-side guard** extended in [backend/app/api/routes/goal_routes.py](backend/app/api/routes/goal_routes.py#L172-L195). The pre-existing null-mentor check now also rejects when the mentor is soft-deleted:

   ```python
   mentor_is_live = db.query(User.id).filter(
       User.id == target_manager_id,
       User.is_deleted == False,
   ).first() is not None
   if not mentor_is_live:
       raise HTTPException(400, "The assigned mentor is no longer active. ...")
   ```

2. **`has_mentor` claim corrected** in `_build_session` ([auth_routes.py:32-38](backend/app/api/routes/auth_routes.py#L32-L38)) — it's now `True` only when `mentor_id` resolves to an *active* user. A dangling FK to a soft-deleted mentor no longer falsely gates the yearly-goal UI open.

**Why this shape.** Defense in depth: the UI hides the Create Goal button (via `has_mentor`), and even if a stale client bypasses that, the server returns a human-readable 400 instead of an opaque 500.

---

### A4 — No `org_id` verification on JWT decode

**Problem.** `get_current_user` looked up the user by `user_id` only. If a user were ever moved between orgs (or the token were forged to claim a different `org_id`), an old token would still authenticate them. Low-probability today, but zero defense in depth.

**Fix.** [backend/app/api/dependencies.py](backend/app/api/dependencies.py) — after decode, compare the token's `org_id` claim to the live `user.org_id`. Mismatch raises 401.

```python
token_org_id: int | None = payload.get("org_id")
# ... user lookup ...
if token_org_id is not None and token_org_id != user.org_id:
    raise credentials_exception
```

**Why this shape.** Tenant-boundary safety is cheap (one integer compare) and we already have the claim in the token — no reason not to validate it. The `token_org_id is not None` check keeps older tokens from before this field existed gracefully degraded, though in practice every token now includes it.

---

## Wave 1 — UX bugs

### B5 — `location.from` captured but ignored

**Problem.** `ProtectedRoute` stored the intended destination in `Navigate`'s `state.from`, but `Login.tsx` always redirected to `/dashboard` after login, losing the context.

**Fix.** [frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx) — read `location.state.from.pathname` (falling back to `/dashboard`), then pass it to `navigate()` after a successful login.

```ts
const intendedPath =
  (location.state as LocationState | null)?.from?.pathname ?? "/dashboard";
// ... after login ...
navigate(intendedPath, { replace: true });
```

---

### B6 — Multi-tab logout race

**Problem.** Logging out in one tab didn't log out any other open tabs — they kept firing API calls with the (now-removed) token until a 401 came back.

**Fix.** [frontend/src/contexts/AuthProvider.tsx](frontend/src/contexts/AuthProvider.tsx) — a `storage` event listener in the provider watches `user` key changes in localStorage. When another tab logs in/out, this tab syncs. After C12 the token is no longer in localStorage (browser cookies are shared across same-origin tabs automatically), so we only need to watch `user`.

```ts
useEffect(() => {
  const handler = (e: StorageEvent) => {
    if (e.key !== "user" && e.key !== null) return;
    const savedUser = localStorage.getItem("user");
    setUser(savedUser ? JSON.parse(savedUser) : null);
  };
  globalThis.addEventListener("storage", handler);
  return () => globalThis.removeEventListener("storage", handler);
}, []);
```

---

### B7 — `isApiError` guard too permissive

**Problem.** The guard checked `"response" in error` but didn't verify `response.data.detail` was a string. FastAPI 422 returns `detail` as an array — the login page would render "Please fill in all required fields." instead of the real cause, or worse, `[object Object]`.

**Fix.** [frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx) — narrow the guard to also verify `detail` is a string. The nested ternary at the callsite collapsed into a single branch.

```ts
function isApiError(
  error: unknown,
): error is ApiErrorResponse & { response: { data: { detail: string } } } {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return false;
  }
  const detail = (error as ApiErrorResponse).response?.data?.detail;
  return typeof detail === "string";
}
```

---

### B8 — Email case sensitivity at login

**Problem.** `db.query(User).filter(User.email == request.username)` is case-sensitive. A user stored as `David@x.com` could not log in as `david@x.com`.

**Fix.** [backend/app/api/routes/auth_routes.py:67-69](backend/app/api/routes/auth_routes.py#L67-L69) — normalize the submitted email to lowercase and use a case-insensitive DB comparison.

```python
email = (request.username or "").strip().lower()
user = db.query(User).filter(func.lower(User.email) == email).first()
```

**Data-side recommendation.** For consistency, also run `UPDATE users SET email = LOWER(email);` once, and consider enforcing lowercase at user creation time (`admin_routes.py:create_user`). Neither is strictly required because the query is now case-insensitive, but it removes an inconsistency trap.

---

### B10 — Already-logged-in user sees a flash of /login

**Problem.** Login used a `useEffect` to redirect already-authenticated users. The effect runs *after* the first paint, so there was a frame where the login form rendered before the redirect kicked in.

**Fix.** [frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx) — synchronous `<Navigate>` guard placed AFTER all hook calls (Rules of Hooks) but BEFORE the `return` of the form. The theming `useEffect` was reordered before the guard and given a `user` dependency so it no-ops when the guard will redirect.

```tsx
useEffect(() => {
  if (user) return; // no-op — the guard below will redirect
  // ... theming code ...
}, [activeTenant, user]);

if (user) {
  return <Navigate to={intendedPath} replace />;
}
```

---

## Wave 2 — Architectural changes

### C12 — HttpOnly cookie auth + CSRF defence

**Problem.** JWT stored in `localStorage` is accessible to any JavaScript running on the page, including injected third-party scripts, malicious extensions, and any future XSS. If the token leaks, an attacker has full account access for up to 7 days.

**Fix — cookie-based session, adaptable to topology.**

#### Cookies set on login

- **`access_token`** — HttpOnly, Secure in prod, SameSite per topology. The JWT itself. JS cannot read this.
- **`csrf_token`** — non-HttpOnly (JS must read it), Secure/SameSite same as above. A random per-session value.

#### CSRF defence — double-submit pattern

The browser auto-attaches `access_token` on every same-origin request (or cross-origin if SameSite=None). That alone isn't enough — an attacker page can still trigger a POST that ships the cookie. To block that:

1. On login, the backend sets `csrf_token` cookie to a random value.
2. The frontend reads `csrf_token` from `document.cookie` and copies it into an `X-CSRF-Token` header on every **mutating** request (POST/PUT/PATCH/DELETE).
3. The backend's [CSRFMiddleware](backend/app/core/csrf.py) rejects mutating requests where the header and cookie don't match.

An attacker site cannot read the victim's `csrf_token` cookie (same-origin policy protects `document.cookie`), so it cannot forge the header, so the POST 403s. Safe methods (`GET`, `HEAD`, `OPTIONS`) and auth endpoints (`/auth/login`, `/auth/logout`, `/docs`) are exempt.

#### Topology — same-origin vs cross-origin

The cookie attributes differ by deployment topology. Driven by env vars in [backend/app/core/config.py](backend/app/core/config.py):

| Scenario | `SAME_ORIGIN` | `COOKIE_SECURE` | `COOKIE_DOMAIN` | SameSite | Notes |
|----------|---------------|------------------|------------------|----------|-------|
| Dev (vite:5173 ↔ fastapi:8000) | `false` | `false` | unset | `None` | localhost-only loophole lets SameSite=None work without HTTPS |
| Prod behind reverse proxy (default) | `true` | `true` | unset | `Lax` | Simplest + most secure |
| Prod separate domains | `false` | `true` | `.example.com` | `None` | HTTPS required |

The helper [`settings.cookie_kwargs()`](backend/app/core/config.py) centralises this so `set_cookie` / `delete_cookie` stay consistent between login + logout.

#### Backend dependency rewrite

[backend/app/api/dependencies.py](backend/app/api/dependencies.py) used to depend on `OAuth2PasswordBearer`, which reads `Authorization: Bearer …`. Replaced with:

```python
def get_current_user(
    db: DbSession,
    cookie_token: Annotated[str | None, Cookie(alias=settings.ACCESS_COOKIE_NAME)] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    token = _extract_token(cookie_token, authorization)
    # ... decode, org_id check, is_deleted check (all unchanged) ...
```

`_extract_token` prefers the cookie (production path) and falls back to the `Authorization` header so **Swagger UI's Authorize button still works** for manual API exploration. Real browser clients always use the cookie.

#### Middleware order

In [backend/main.py](backend/main.py), order matters. Starlette runs middleware in *reverse* add-order (last-added is outermost). CORS must be outermost so preflight `OPTIONS` is handled before CSRF — a preflight without `X-CSRF-Token` would otherwise 403:

```python
app.add_middleware(CSRFMiddleware)      # registered first → runs INNER
app.add_middleware(CORSMiddleware, …)   # registered last  → runs OUTER
```

#### Frontend changes

[frontend/src/services/api.client.ts](frontend/src/services/api.client.ts):

- `withCredentials: true` so cookies ride on every call.
- Deleted the `Authorization: Bearer` request interceptor.
- New interceptor reads `csrf_token` from `document.cookie` and sets `X-CSRF-Token` on mutating methods.
- `forceLogout()` now fires `POST /auth/logout` (best-effort via `fetch` to avoid re-intercepting) so the HttpOnly cookie is actually cleared server-side.

[frontend/src/services/auth.service.ts](frontend/src/services/auth.service.ts):

- `AuthResponse = SessionClaims` — the login body no longer carries `access_token`/`token_type`.
- `logout()` is now async and calls `/auth/logout`.

[frontend/src/contexts/AuthProvider.tsx](frontend/src/contexts/AuthProvider.tsx):

- Stopped reading/writing `localStorage.token` everywhere.
- Bootstrap: call `authService.getSession()` on mount unconditionally. A 401 from the server is handled by the interceptor's `forceLogout()`. This replaces the old "token exists in localStorage → assume logged in" heuristic, which can't work when JS can't read the cookie.
- `logout()` calls `authService.logout()` before clearing local state.

#### Why this shape

- **Defence in depth.** HttpOnly cookie blocks XSS token theft. CSRF middleware blocks cross-site request forgery, which cookie-auth alone exposes.
- **Adaptable.** The env-driven `SAME_ORIGIN` flag means the same code ships for dev, nginx-proxied prod, and multi-domain prod. No code forks.
- **Graceful Swagger fallback.** Keeping the `Authorization` header path preserves API documentation workflows without compromising browsers.

---

### C14 — Admin-initiated password reset

**Problem.** If a user forgot their password, they had no recovery path. The existing self-service change-password endpoint required the *current* password. Admins couldn't bail anyone out.

**Fix — admin-triggered reset that forces a change on next login.**

#### DB schema

New column `users.must_change_password BOOLEAN NOT NULL DEFAULT FALSE` via Alembic migration [e1f7a9b3d5c2_add_must_change_password.py](backend/alembic/versions/e1f7a9b3d5c2_add_must_change_password.py). Applied with `alembic upgrade head`.

#### Backend — reset endpoint

[backend/app/api/routes/admin_routes.py](backend/app/api/routes/admin_routes.py) — `POST /admin/users/{id}/reset-password`:

1. Admin-only (same `_require_admin` guard as every other admin endpoint).
2. Generates a 12-character random password using `secrets.choice(string.ascii_letters + string.digits)` — unambiguous alphabet (no `$`, `/`, etc.) so admins can read it aloud without shell-escape surprises.
3. Writes its bcrypt hash to `user.password_hash`, sets `must_change_password = True`, commits.
4. Returns the **plaintext** temp password exactly once in `PasswordResetResponse`. It is never persisted anywhere.
5. Refuses self-reset (admin must use the profile page's change-password form to avoid session invalidation quirks) and refuses resets on soft-deleted users.

#### Backend — flag plumbing

- `must_change_password` added to `SessionResponse` ([auth_schemas.py](backend/app/schemas/auth_schemas.py)) so every `/auth/login` and `/auth/session` returns the live value.
- Self-service change-password endpoint ([user_routes.py:84-89](backend/app/api/routes/user_routes.py#L84-L89)) clears the flag on success:

  ```python
  current_user.password_hash = get_password_hash(request.new_password)
  current_user.must_change_password = False
  db.commit()
  ```

#### Frontend — admin UI

- New action on the Users table ([UsersTab.tsx](frontend/src/components/admin/UsersTab.tsx)) — a `KeyRound` icon next to Edit/Deactivate, hidden on soft-deleted users.
- [ResetPasswordModal.tsx](frontend/src/components/admin/ResetPasswordModal.tsx) — two-state modal:
  1. **Confirmation** — "generating will invalidate their current password"
  2. **Reveal** — shows the temp password with Copy button, warning "won't be shown again", and a `<code>` with `select-all` so admins can triple-click copy.
- [AdminPanel.tsx](frontend/src/pages/AdminPanel.tsx) wires the action → `adminService.resetUserPassword(id)` → modal state transition.

#### Frontend — force-change guard

- [ChangePassword.tsx](frontend/src/pages/ChangePassword.tsx) — a dedicated page rendered **outside** the `AppShell`, so there's no sidebar, no topbar, no nav links. Just the existing `PasswordChangeCard`.
- [ProtectedRoute.tsx](frontend/src/components/ProtectedRoute.tsx) — new guard stage: if `user.must_change_password === true`, redirect to `/change-password`. The `/change-password` route itself is registered *outside* `ProtectedRoute` (it uses a lightweight `RequireAuth` wrapper in [App.tsx](frontend/src/App.tsx)) so it doesn't redirect-loop.
- [PasswordChangeCard.tsx](frontend/src/components/profile/PasswordChangeCard.tsx) — after a successful change, calls `refreshSession()` so `must_change_password` flips to `false` immediately and the gate lifts without a page reload.

#### End-to-end flow

```
Admin clicks KeyRound
  → POST /admin/users/{id}/reset-password
  → backend sets new hash + must_change_password=True
  → response shows temp password in modal (once)
  → admin copies + tells the user

User logs in with temp password
  → /auth/login returns must_change_password=true in claims
  → AuthProvider stores in user state
  → next ProtectedRoute render redirects to /change-password
  → PasswordChangeCard: user enters old (temp) + new password
  → POST /users/me/password clears must_change_password
  → PasswordChangeCard calls refreshSession()
  → user state updates, ChangePassword page's <Navigate> kicks in
  → user lands on /dashboard
```

#### Why this shape

- **No email infrastructure needed** — self-service email reset would add SMTP or a transactional service; the admin-path covers the "forgot password" case for an internal enterprise app without that investment.
- **Temp password shown once, never stored** — the plaintext exists only in the admin's browser tab until they close it. If they lose it before telling the user, they just click Reset again (idempotent).
- **Force-change guard can't be bypassed** — the gate is in `ProtectedRoute`, which wraps every authenticated page. Even typing a URL manually hits the guard on the next render.
- **No reuse of PasswordChangeCard for login-time forced change** — we reuse the same component inside a different shell (no sidebar) instead of building a parallel form.

---

## Deferred (not yet fixed)

Each is called out here because someone reading this doc next quarter will want to know what's still open.

### B9 — Tenant tab is cosmetic

The HealthArk/Miltenyi toggle on the login page only changes `data-theme` and the placeholder. A user from either tenant can log in under either tab — nothing enforces the pairing. Two defensible options:

- **Enforce** — on submit, check the email domain and reject mismatches ("This email belongs to HealthArk, please switch tabs"). Acts as mild anti-phishing.
- **Remove** — derive the tenant from the email domain after login and drop the tab. Less UI, same outcome.

**Recommendation.** Pick a direction with product before touching this. No security harm from leaving it as-is.

### C11 — No rate limiting on `/login`

Nothing stops 100 parallel password guesses. bcrypt slows each attempt, so brute-forcing a strong password is infeasible, but weak passwords are vulnerable.

**Needs:** a middleware like `slowapi` (adds Redis dep) or in-process `limits` (no extra infra). Pick one, then add a decorator to `/auth/login`:

```python
@limiter.limit("5/minute")
def login(...):
```

### C13 — No server-side token revocation

Logout clears the cookies but the JWT itself remains valid until expiry (7 days). If a laptop is stolen, changing the password doesn't invalidate existing sessions. "Log out of all devices" is not possible.

**Needs:** either a denylist (Redis with key = jti, value = expiry) or a per-user token version counter in the DB that's checked in `get_current_user`. Pick a store first, then wire it into `auth_routes.logout` (add to denylist) + `get_current_user` (reject if denylisted).

---

## Deploy / run checklist

1. **Run Alembic migration** to add `must_change_password`:
   ```
   cd backend && alembic upgrade head
   ```
2. **Normalise email case** in the DB once (safe even though the query is now case-insensitive):
   ```sql
   UPDATE users SET email = LOWER(email);
   ```
3. **Set env vars** per topology (see the [C12 table](#c12--httponly-cookie-auth--csrf-defence)):
   - Dev: `SAME_ORIGIN=false`, `COOKIE_SECURE=false`
   - Prod behind nginx: `SAME_ORIGIN=true`, `COOKIE_SECURE=true`
   - Prod separate domains: `SAME_ORIGIN=false`, `COOKIE_SECURE=true`, `COOKIE_DOMAIN=.example.com`
4. **Clear stale localStorage** in any already-logged-in dev browsers (the old `token` key is obsolete). The app handles this gracefully by bouncing stale sessions to `/login`, but clearing saves one roundtrip.
5. **Restart the backend** so the CSRF middleware and cookie config take effect.
6. **Hard-reload the frontend** so the new `AuthProvider` effects kick in.

---

## End-to-end test plan

Run these in order. Each uses a fresh incognito tab unless stated.

### Auth correctness

| # | Scenario | Expected |
|---|----------|----------|
| T1 | Log in; in another tab (as admin) soft-delete the same user; click anything in the first tab | Token cleared, redirect to `/login`, no cryptic 403 spam |
| T2 | Log in as a Staff user. Admin promotes them to Manager. Refresh. | Sidebar shows mentor menus — `/auth/session` merged fresh claims |
| T3 | Log in as a user with `mentor_id = NULL` (e.g. CEO) and try to create a yearly goal | 400 with "no mentor assigned" message |
| T4 | Admin soft-deletes user X's mentor. User X tries to create a yearly goal. | 400 with "mentor no longer active" message |
| T5 | Paste `/mentees/42` in an incognito tab, get bounced to `/login`, sign in | Lands on `/mentees/42`, not `/dashboard` |
| T6 | Log in, open a second tab on `/dashboard`, logout in tab 1 | Tab 2 re-syncs to logged-out state |
| T7 | Seed a user with `Mixed.Case@x.com`, log in as `mixed.case@x.com` | Succeeds |

### Cookie auth + CSRF (C12)

| # | Scenario | Expected |
|---|----------|----------|
| T8 | After login: DevTools → Application → Cookies | `access_token` HttpOnly=true, `csrf_token` HttpOnly=false |
| T9 | After login: DevTools → Application → Local Storage | Only `user` key, no `token` key |
| T10 | Strip `X-CSRF-Token` header in a mutating request via DevTools | 403 "CSRF token missing or invalid." |
| T11 | Click Logout | Both cookies gone, `user` key gone, redirect to `/login` |
| T12 | In Swagger UI click Authorize, paste Bearer JWT, call a protected endpoint | Works — header fallback preserved |

### Admin-initiated reset (C14)

| # | Scenario | Expected |
|---|----------|----------|
| T13 | Log in as Admin → Admin Panel → Users → KeyRound on a non-admin → Reset | Temp password shown in modal; Copy button works |
| T14 | Close modal without copying → click Reset again | New different temp password generated, previous invalidated |
| T15 | Log out, log in as target user with the temp password | Redirects to `/change-password`; sidebar/topbar hidden |
| T16 | On `/change-password`, type an arbitrary URL (e.g. `/dashboard`) in the address bar | Bounces back to `/change-password` |
| T17 | Submit a new password | Redirects to `/dashboard`, sidebar appears, `must_change_password` now `false` |
| T18 | Admin tries the KeyRound on their own row | 400 "use the profile page to change your own password" |
| T19 | Admin tries the KeyRound on a deactivated user | Button isn't rendered (deactivated users have no actions) |

### CI-friendly sanity

```
cd frontend && npx tsc --noEmit           # expect: no output
cd backend && python -c "from main import app; print(len(app.routes))"
```

---

## Appendix — File map

Backend:

- [`backend/alembic/versions/e1f7a9b3d5c2_add_must_change_password.py`](backend/alembic/versions/e1f7a9b3d5c2_add_must_change_password.py)
- [`backend/app/core/config.py`](backend/app/core/config.py) — cookie settings
- [`backend/app/core/csrf.py`](backend/app/core/csrf.py) — new middleware
- [`backend/app/api/dependencies.py`](backend/app/api/dependencies.py) — cookie-based `get_current_user`
- [`backend/app/api/routes/auth_routes.py`](backend/app/api/routes/auth_routes.py) — login/logout/session
- [`backend/app/api/routes/admin_routes.py`](backend/app/api/routes/admin_routes.py) — reset-password
- [`backend/app/api/routes/user_routes.py`](backend/app/api/routes/user_routes.py) — clears flag on self-change
- [`backend/app/api/routes/goal_routes.py`](backend/app/api/routes/goal_routes.py) — mentor-liveness check
- [`backend/app/schemas/auth_schemas.py`](backend/app/schemas/auth_schemas.py)
- [`backend/app/schemas/admin_schemas.py`](backend/app/schemas/admin_schemas.py)
- [`backend/app/models/user_models.py`](backend/app/models/user_models.py) — `must_change_password` column
- [`backend/main.py`](backend/main.py) — middleware registration order

Frontend:

- [`frontend/src/services/api.client.ts`](frontend/src/services/api.client.ts)
- [`frontend/src/services/auth.service.ts`](frontend/src/services/auth.service.ts)
- [`frontend/src/services/admin.service.ts`](frontend/src/services/admin.service.ts)
- [`frontend/src/contexts/AuthContext.ts`](frontend/src/contexts/AuthContext.ts)
- [`frontend/src/contexts/AuthProvider.tsx`](frontend/src/contexts/AuthProvider.tsx)
- [`frontend/src/components/ProtectedRoute.tsx`](frontend/src/components/ProtectedRoute.tsx)
- [`frontend/src/components/admin/UsersTab.tsx`](frontend/src/components/admin/UsersTab.tsx)
- [`frontend/src/components/admin/ResetPasswordModal.tsx`](frontend/src/components/admin/ResetPasswordModal.tsx)
- [`frontend/src/components/profile/PasswordChangeCard.tsx`](frontend/src/components/profile/PasswordChangeCard.tsx)
- [`frontend/src/pages/Login.tsx`](frontend/src/pages/Login.tsx)
- [`frontend/src/pages/ChangePassword.tsx`](frontend/src/pages/ChangePassword.tsx)
- [`frontend/src/pages/AdminPanel.tsx`](frontend/src/pages/AdminPanel.tsx)
- [`frontend/src/App.tsx`](frontend/src/App.tsx)
