# Dark Mode

> User-toggleable light/dark theme with OS-preference default and per-user persistence.

## What shipped

A complete dark-mode implementation across the entire app. Toggle lives in the Topbar (immediately to the left of the notification bell) and swaps a `Sun` icon ↔ `Moon` icon to mirror the active mode.

### Default behavior
- **First load:** reads `window.matchMedia('(prefers-color-scheme: dark)')` and matches the user's OS preference.
- **OS preference changes** (e.g. macOS auto-dark schedule): propagate live, **until** the user explicitly toggles. After that the user's choice persists.
- **Persistence:** `localStorage['ui_theme']` = `'light' | 'dark'`. Once set, it overrides OS preference until the user clears it.

### Surface
Every page is dark-mode-aware:
- Dashboard + all six widgets
- Annual Goals (My Goals + Team Goals)
- Annual Reviews (Self / Mentor / Management tabs + EvalForm + drawer)
- Project Reviews (PM + Secondary + Management tabs + EvalModal + ImpactModal)
- MyMentees + MenteeDetail (Goals / Reviews / Projects / Annual Summary tabs)
- Admin Panel (Users / Projects / Exports / System Settings)
- Profile + ChangePassword + ResetPassword
- Login + Unauthorized
- Topbar, Sidebar, NotificationDropdown
- Every modal (UserModal, ProjectModal, GoalFormModal, EvalModal × 2, ImpactModal, BulkApproveModal, ConfirmDialog, etc.)
- Snackbar / Toast feedback surfaces

## Architecture

### CSS layer
**Tailwind v4 with `@variant dark (&:where(.dark, .dark *))`** in [src/index.css](../../frontend/src/index.css). The `.dark` class on `<html>` activates both the `dark:` utility prefix AND swaps the CSS variable values defined in the `.dark { ... }` block.

The existing `data-theme="healthark"` attribute (set by `AuthProvider` for org branding) stays orthogonal: the same `<html>` element carries both `data-theme="healthark"` and `class="dark"` independently.

### CSS variables (extended)
Every color token consumed by Tailwind utilities resolves through a CSS variable. New variables added:
- `--color-surface-muted` — secondary tinted surface (was hard-coded `bg-slate-50`)
- `--color-surface-hover` — tertiary surface for badges/progress tracks (was `bg-slate-100`)
- `--color-border-strong` — emphasized border

The light palette stays under `:root, [data-theme="healthark"]`. The dark palette overrides via `.dark { ... }`.

### React layer
Three-file pattern matching `SystemSettingsContext`:
- [src/contexts/ThemeContext.ts](../../frontend/src/contexts/ThemeContext.ts) — `Theme = 'light' | 'dark'`, context type with `theme` + `setTheme` + `toggleTheme`.
- [src/contexts/ThemeProvider.tsx](../../frontend/src/contexts/ThemeProvider.tsx) — state + side effects (localStorage read/write, `prefers-color-scheme` default, `matchMedia('change')` listener, DOM `dark` class toggle).
- [src/hooks/useTheme.ts](../../frontend/src/hooks/useTheme.ts) — consumer hook.
- [src/components/layout/ThemeToggle.tsx](../../frontend/src/components/layout/ThemeToggle.tsx) — Sun ↔ Moon button. Convention: **show current mode** (Sun when light, Moon when dark).

### Provider mounting
Wrapped inside `<AuthProvider>` (so theme has access to user-driven state if ever needed) and outside `<SystemSettingsProvider>`. See [src/main.tsx](../../frontend/src/main.tsx).

## Migration strategy

The migration was done in waves to keep change reviewable:

### Wave 1 — Infrastructure + Dashboard only
Built the entire CSS variable extension, ThemeProvider, toggle, and migrated just `/dashboard` + its six widgets. Validated the approach end-to-end before broadening.

### Wave 2 — Mechanical mass-replace across all 6 target pages
A single `sed` pass converted hard-coded Tailwind color classes to CSS-variable equivalents across **78 source files**:

| Old | New |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-slate-50`, `bg-gray-50` | `bg-surface-muted` |
| `bg-slate-100`, `bg-gray-100` | `bg-surface-hover` |
| `hover:bg-slate-50`, `hover:bg-gray-50` | `hover:bg-surface-muted` |
| `hover:bg-slate-100`, `hover:bg-gray-100` | `hover:bg-surface-hover` |
| `border-slate-100/200`, `border-gray-100/200` | `border-border` |
| `divide-slate-100/200` | `divide-border` |
| `text-slate-400/500/600`, `text-gray-400/500/600` | `text-text-muted` |
| `text-slate-700/800/900`, `text-gray-700/800/900` | `text-text-main` |

### Wave 3 — Status color dark: overrides
A second `sed` pass appended `dark:` variants to semantic status-color usages across 18 color families (red / amber / green / blue / violet / emerald / sky / orange / rose / pink / indigo / cyan / teal / fuchsia / purple / yellow / lime):
- `bg-X-50` → `+ dark:bg-X-950/40`
- `bg-X-100` → `+ dark:bg-X-900/40`
- `text-X-600/700/800` → `+ dark:text-X-300`
- `text-X-500` → `+ dark:text-X-400`
- `border-X-200` → `+ dark:border-X-800`

### Wave 4 — Solid slate fills
`bg-slate-200` and `bg-slate-300` (used for toggle off-states, progress tracks, tooltip body) got `dark:bg-slate-700` / `dark:bg-slate-600` overrides.

### Wave 5 — Bug fixes during manual review
Spotted by manual testing:

1. **Sidebar + Notification hover** — hard-coded `bg-slate-50` swapped to `bg-surface-muted` ([Sidebar.tsx:64](../../frontend/src/layouts/Sidebar.tsx#L64), [NotificationDropdown.tsx](../../frontend/src/components/layout/NotificationDropdown.tsx)).
2. **Browser autofill white background** — Chrome's `:-webkit-autofill` pseudo-class forces a yellow/white background ignoring our `bg-surface` class. Fixed in [index.css](../../frontend/src/index.css) at the end of `@layer base` with a `-webkit-box-shadow: 0 0 0 1000px var(--surface) inset` override + `9999s` transition trick.
3. **Mentor Review header inconsistent with Self Review** — [AnnualReviewDetailModal.tsx](../../frontend/src/components/reviews/AnnualReviewDetailModal.tsx) had a custom blue treatment with unreadable `text-blue-900` on `dark:bg-blue-950/40`. Unified with Self Review styling (`bg-surface-muted` shell).
4. **Broken opacity modifiers** — my Wave 2 sed accidentally broke 11 spots where `bg-X-50/N` (Tailwind opacity modifier) was a single class. The `/N` got attached to the new `dark:bg-X-950/40` producing invalid Tailwind. Repaired with a corrective sed: `bg-X-50/N dark:bg-X-950/N`.
5. **Missing `dark:hover:` prefix on 16 hover buttons** — `hover:bg-red-50 dark:bg-red-950/40` doesn't scope the dark variant to hover. Without the `hover:` prefix on the `dark:` variant, the dark utility applies always (not only on hover), and in hover state the light `hover:bg-red-50` actually wins on specificity (`:hover` adds spec, `:where()` contributes 0). Result: hover became pale-pink-on-dark. Fixed with sed across all 16 occurrences (Logout button, admin action buttons in UsersTab/ProjectsTab, ProjectModal member remove, TeamGoals approval buttons, Edit/View buttons in PMEvaluationTab/SecondaryEvalTab/MenteeProjectsTab).
6. **Status badges with `bg-X-100`** — my Wave 3 sed only handled `bg-X-50`. Added a fourth sed pass for the `bg-X-100` shade so [ApprovalStatusBadge](../../frontend/src/components/goals/ApprovalStatusBadge.tsx) and similar surfaces stay legible.

## Bundle delta

Cumulative cost of the entire dark-mode arc vs the pre-feat-dark-mode `master` baseline:

| Asset | Pre | Post |
|---|---|---|
| Shared `index-*.js` | 214.54 kB / 67.33 kB gzip | **217.46 kB / 68.09 kB gzip** |
| `index-*.css` | 55.43 kB / 10.29 kB gzip | **~63 kB / ~11 kB gzip** |
| `AdminPanel-*.js` | 63.35 kB / 14.68 kB gzip | 64.11 kB / 14.79 kB gzip |
| `AnnualGoals-*.js` | 57.27 kB / 12.39 kB gzip | 58.34 kB / 12.51 kB gzip |
| `Dashboard-*.js` | 15.49 kB / 3.60 kB gzip | 15.90 kB / 3.68 kB gzip |
| Per-route chunks | various | +50–100 bytes gzip each |

**Total app-wide cost: ~+1.5 kB gzip** for the entire dark mode infrastructure + comprehensive migration. Effectively free.

## Files touched

- **New (4):** `src/contexts/ThemeContext.ts`, `src/contexts/ThemeProvider.tsx`, `src/hooks/useTheme.ts`, `src/components/layout/ThemeToggle.tsx`.
- **Modified:** ~141 source files (every `.tsx`/`.ts` under `src/` that used hard-coded Tailwind colors, plus `index.css`, `main.tsx`, `Topbar.tsx`).

## Manual test surface

The PR description includes the full test list, but at a minimum:

1. Hard reload `/dashboard` with OS in light/dark → app respects OS.
2. Toggle Sun/Moon → instant swap, no flash.
3. Reload → preference persists.
4. Open Admin → Users → Add User → form fields stay dark (autofill case).
5. Open Annual Reviews → Management Review modal → Mentor Review block legible.
6. Annual Goals → My Goals → Role Expectations panel expands cleanly.
7. Annual Goals → Team Goals → status badges visible on every row.
8. Hover the Sidebar Logout button → stays dark red, doesn't go pale.
9. Walk every page; status badges/pills legible everywhere; no white surfaces leaking through.

## What is intentionally NOT included

- **Per-org dark palette tuning.** Currently the `.dark` block defines one dark palette for the Healthark org. If a second org is onboarded later, multi-org dark variants are a follow-up.
- **High-contrast / a11y mode.** Standard light + dark only.
- **Backend-stored theme preference.** Theme persists in `localStorage` only — no API or DB columns. If cross-device persistence is wanted, a future PR can sync via the user settings endpoint.
- **The `bg-slate-800` tooltip body and solid `bg-slate-600/700` action buttons** are intentionally left as-is for now — they're solid colored elements that read OK in both modes, and tuning them would be opinion-driven rather than mechanical.

## Pattern note

Established mappings worth bookmarking:

| Concept | Class (works in both modes) |
|---|---|
| Primary surface | `bg-surface` (white in light, slate-800 in dark) |
| Tinted surface | `bg-surface-muted` (slate-50 in light, slate-700-ish in dark) |
| Hovered surface / progress track | `bg-surface-hover` |
| Body text | `text-text-main` |
| Muted text | `text-text-muted` |
| Default border | `border-border` |
| Status pill bg | `bg-X-50 dark:bg-X-950/40` or `bg-X-100 dark:bg-X-900/40` |
| Status pill text | `text-X-700 dark:text-X-300` |
| Hover state bg | `hover:bg-surface-muted` (or `hover:bg-X-100 dark:hover:bg-X-900/40` for tinted) |

Future migrations should reach for these tokens by default and only add `dark:` overrides for genuinely status-semantic colors.
