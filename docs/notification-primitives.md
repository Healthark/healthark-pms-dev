# Notification Primitives — Toast, Snackbar, ConfirmDialog

_Last updated: 2026-04-22_

This document records the design, implementation, and codebase-wide rollout of three reusable feedback primitives. It covers why we built them, the semantic split between them, the API, the architectural decisions, and the files migrated across four follow-up PRs. Use it as the first read for any future work that involves user-facing feedback.

---

## Table of contents

1. [Context](#context)
2. [The three primitives at a glance](#the-three-primitives-at-a-glance)
3. [Architecture](#architecture)
4. [API reference with examples](#api-reference-with-examples)
5. [Build order across iterations](#build-order-across-iterations)
6. [Migration log](#migration-log)
7. [Design rules that emerged](#design-rules-that-emerged)
8. [Intentionally not migrated](#intentionally-not-migrated)
9. [Verification](#verification)
10. [File map appendix](#file-map-appendix)

---

## Context

Before this work the frontend had no centralized feedback system. Inventory taken at the start:

- **~18 components** managed their own `[error, setError]` / `[success, setSuccess]` state with near-identical red/green inline banners.
- **3 bespoke confirmation modals** (`DeactivateModal`, `ReactivateModal`, `ResetPasswordModal`) with ~90% duplicated structure.
- **One raw `window.confirm()`** in [ProjectsTab.tsx:71](frontend/src/components/admin/ProjectsTab.tsx#L71) — ugly native dialog.
- **Only 2 places** showed success feedback (`PasswordChangeCard`, `AdminPanel` settings save); every other action closed silently, so users had no confirmation that anything had happened.
- **Many catch blocks swallowed errors silently** — e.g. `handleApprove` in `TeamGoalsTab` had a bare `catch {}` that left the user staring at an unchanged UI on failure.

Goal: three reusable primitives that collapse the duplication, eliminate silent successes, and give destructive actions a consistent confirmation surface.

---

## The three primitives at a glance

Mental model: **top-center = good news (you did the thing)**, **top-right = bad news (something needs attention)**, **modal = blocks you until you decide**.

| Primitive | Position | Purpose | Lifetime | Stacks? | Example uses |
|-----------|----------|---------|----------|---------|--------------|
| **Toast** | top-center | `success` + `info` | ~3s auto-dismiss | No — replaces | "Goal created", "User reactivated", "Copied to clipboard" |
| **Snackbar** | top-right | `error` + `warn` | ~6s auto-dismiss, or manual via close button | Yes — queues | "Failed to save — network error", "Session expires soon" |
| **ConfirmDialog** | centered modal | destructive / irreversible action | blocks until resolved | No | "Delete project?", "Deactivate user?", "Reset password?" |

**Why toast replaces but snackbar stacks:** one success at a time is all the user needs (the latest victory overwrites the last). Errors must stack because a failed save plus a failed background refresh are both important — you don't want the second to hide the first.

---

## Architecture

Three independent Context providers, mounted in [main.tsx](frontend/src/main.tsx) innermost-to-outermost so every component in the app can reach them via hooks without prop drilling:

```tsx
<StrictMode>
  <AuthProvider>
    <SystemSettingsProvider>
      <ToastProvider>
        <SnackbarProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </SnackbarProvider>
      </ToastProvider>
    </SystemSettingsProvider>
  </AuthProvider>
</StrictMode>
```

Each provider:

- Owns its own state (toast queue / snackbar stack / pending confirm promise).
- Renders its UI via `createPortal(document.body)` so z-index is decoupled from the component tree.
- Exposes a memoized context value with stable callbacks (`useCallback`), so consumer re-renders are minimal.
- Has a single-responsibility hook: `useToast()`, `useSnackbar()`, `useConfirm()`. Each throws a clear dev-time error if used outside its provider.

**Z-index order** (deliberately chosen):

| Layer | z-index class |
|-------|---------------|
| Existing modals (`DeactivateModal`-era styling, `TempPasswordRevealModal`) | `z-50` |
| Toast + Snackbar host | `z-[60]` |
| ConfirmDialog | `z-70` |

ConfirmDialog sits above Toast/Snackbar because confirmations must always be visible over passive notifications — you should never be forced to read a snackbar before you can see what you're about to confirm.

**Accessibility:**

- `Toast` uses `role="status"` + `aria-live="polite"` — announced but doesn't interrupt.
- `Snackbar` uses `role="alert"` + `aria-live="assertive"` — interrupts screen reader speech for errors.
- `ConfirmDialog` uses `role="dialog"` + `aria-modal="true"`, auto-focuses the confirm button on mount, binds Esc to cancel and Enter to confirm, and backdrop-click cancels.

---

## API reference with examples

### `useToast()` — top-center success/info

```ts
const toast = useToast();

toast.success("Goal created.");
toast.info("Link copied to clipboard.");
toast.dismiss();            // clear the current toast manually
```

Replace policy: a new call cancels the pending auto-dismiss timer and replaces the visible toast. So if a user triggers several quick actions, they only ever see the most recent.

### `useSnackbar()` — top-right errors/warnings

```ts
const snackbar = useSnackbar();

snackbar.error("Couldn't save — network error.");
snackbar.warn("Your session expires in 5 minutes.");
snackbar.dismiss(id);       // accepts the id returned when the entry was created
                            //   (rarely needed — the close button handles it)
```

Each entry has its own auto-dismiss timer (6s default). Users can manually dismiss via the X button. Stacking is newest-at-bottom so each failure is visible in arrival order.

### `useConfirm()` — promise-returning destructive confirm

```ts
const confirm = useConfirm();

const ok = await confirm({
  title: "Delete project?",
  message: `Delete "${project.name}"? This is a soft delete — the project is hidden but can be restored later.`,
  variant: "danger",         // "default" | "danger" | "warning"
  confirmText: "Delete",     // optional (default: "Confirm")
  cancelText: "Cancel",      // optional (default: "Cancel")
});

if (ok) {
  await service.delete(project.id);
  toast.success(`"${project.name}" deleted.`);
}
```

The promise-returning API avoids the standard "open-state + onConfirm callback + isPending prop" soup at every call site. A second `confirm()` call while a previous one is still open auto-cancels the earlier promise with `false`, preventing hung promises.

### Typical full flow (reactivate example)

```ts
const handleReactivate = async (user: UserResponse) => {
  const ok = await confirm({
    title: "Reactivate user?",
    message: `Reactivate ${user.full_name}? They will regain access immediately.`,
    variant: "default",
    confirmText: "Reactivate",
  });
  if (!ok) return;

  try {
    const updated = await adminService.reactivateUser(user.id);
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    toast.success(`${updated.full_name} reactivated.`);
  } catch (err) {
    snackbar.error(getErrorMessage(err));
  }
};
```

This is the shape every lifecycle action in the app now follows.

---

## Build order across iterations

The work was split into one foundation PR + three migration PRs, each independently reviewable:

1. **Primitives PR** — built all three providers + hooks + components. Demo-migrated `ReactivateModal` to prove end-to-end wiring. Every other inline banner or bespoke modal stayed untouched.
2. **Follow-up 1 — Phase 1 polish** — migrated the three most visible "low-hanging" sites: `ProjectsTab`'s `window.confirm()`, `PasswordChangeCard`'s green success banner, `AdminPanel`'s "Configuration saved" banner.
3. **Follow-up 2 — Retire remaining lifecycle modals** — deleted `DeactivateModal`, simplified `ResetPasswordModal` into `TempPasswordRevealModal` (reveal-only), moved both confirmations into `useConfirm()`.
4. **Follow-up 3 — Codebase-wide sweep** — added `toast.success()` on 15+ previously-silent success paths, migrated `snackbar.error()` on ~6 previously-silent catch blocks, and dropped the last few inline `error` states that weren't modal-adjacent.

Each PR passed `npx tsc --noEmit` and was reviewable as a self-contained unit. No big-bang migration.

---

## Migration log

### Primitives PR

- Created all three providers + hooks + components.
- Demo migration: deleted `ReactivateModal.tsx`; `AdminPanel.handleReactivate` now uses `confirm()` + `toast.success()` + `snackbar.error()`.

### Follow-up 1 — Phase 1 polish

- [ProjectsTab.tsx](frontend/src/components/admin/ProjectsTab.tsx) — `window.confirm()` → `useConfirm({ variant: "danger" })`; success → `toast.success`; API error → `snackbar.error`; dropped the `deleteError` state + inline red banner.
- [PasswordChangeCard.tsx](frontend/src/components/profile/PasswordChangeCard.tsx) — dropped `error` + `success` state, the red and green banners, the `CheckCircle` import, and the stale `setError/setSuccess` calls scattered through 3 onChange handlers. Success → `toast.success("Password updated.")`; API failure → `snackbar.error(...)`.
- [AdminPanel.tsx](frontend/src/pages/AdminPanel.tsx) — dropped `settingsSaved` + `settingsSaveError` state + the `setTimeout` wrapper. Success → toast; failure → snackbar.
- [SystemSettingsTab.tsx](frontend/src/components/admin/SystemSettingsTab.tsx) — narrowed its prop interface (`settingsSaved`, `saveError` removed); the inline red/green banner block replaced with a plain right-aligned save button.

### Follow-up 2 — Retire lifecycle modals

- **Deleted** `DeactivateModal.tsx`. [AdminPanel.tsx](frontend/src/pages/AdminPanel.tsx)'s `handleDeactivate` now takes a user directly, calls `confirm({ variant: "danger" })`, fires `toast.success` on success, `snackbar.error` on failure — no more swallowed `catch {}`.
- **Renamed + simplified**: `ResetPasswordModal.tsx` → [TempPasswordRevealModal.tsx](frontend/src/components/admin/TempPasswordRevealModal.tsx) via `git mv` (history preserved). The confirmation half moved to `useConfirm({ variant: "warning" })` in AdminPanel; the modal itself is now pure presentation — shown only after the reset API call resolves.
- [AdminPanel.tsx](frontend/src/pages/AdminPanel.tsx) — dropped `deactivateTarget`, `resetTarget`, `resetError` state and the `openResetModal` / `closeResetModal` helpers. `handleResetPassword(user)` and `handleDeactivate(user)` are now single functions passed directly to `UsersTab` as props.

### Follow-up 3 — Codebase sweep

**Pages (added `toast.success` on action flows; kept modal-scoped errors inline):**
- [AnnualReviews.tsx](frontend/src/pages/AnnualReviews.tsx) — self-review submit.
- [YearlyGoals.tsx](frontend/src/pages/YearlyGoals.tsx) — goal create, goal update, mentor-submit, self-review submit. Previously-silent submit failure now `snackbar.error`.

**Goal flows:**
- [TeamGoalsTab.tsx](frontend/src/components/goals/TeamGoalsTab.tsx) — approve, feedback, notify → toast; silent-swallow approve failure → snackbar.
- [MenteeGoalsTab.tsx](frontend/src/components/mentees/MenteeGoalsTab.tsx) — approve + feedback → toast; silent-swallow approve failure → snackbar.
- [CriteriaChecklist.tsx](frontend/src/components/goals/CriteriaChecklist.tsx) — dropped the shared `error` state + inline red text (was visually misplaced anyway); toggle failure → snackbar; proof save success → toast.

**Project-review flows:**
- [PMEvaluationTab.tsx](frontend/src/components/project-reviews/PMEvaluationTab.tsx) — PM eval submit/update, impact statement save → toast.
- [SecondaryEvalTab.tsx](frontend/src/components/project-reviews/SecondaryEvalTab.tsx) — impact submit + update → toast.
- [EvaluationsTab.tsx](frontend/src/components/project-reviews/EvaluationsTab.tsx) — primary eval + secondary impact submit → toast.
- [SelfReviewForm.tsx](frontend/src/components/project-reviews/SelfReviewForm.tsx) — self-review submit → toast.
- [MenteeProjectsTab.tsx](frontend/src/components/mentees/MenteeProjectsTab.tsx) — PM eval + impact statement submit/update → toast.

**Admin forms:**
- [ProjectModal.tsx](frontend/src/components/admin/ProjectModal.tsx) — `removeExisting` assignment failure → snackbar (it's an inline side-action, not form validation); save success → toast. Form-level submit error kept inline (adjacent to submit button is correct UX).
- [AdminPanel.tsx](frontend/src/pages/AdminPanel.tsx) — `handleSaveUser` success → toast. UserModal's inline `error` prop kept — it lives right next to the submit button.

---

## Design rules that emerged

The single most useful artifact of this work is the decision table below. Anywhere in the app that a future action might need feedback, consult this:

| Situation | Decision |
|-----------|----------|
| Action-triggered API error in a **page** or **tab** (no modal open) | `snackbar.error(getErrorMessage(err))` |
| Action-triggered API error **inside a modal**, near the submit button | Keep inline — adjacent to submit is correct UX. Still fire `toast.success` on success. |
| Silent success path (modal closes / `onReload()` fires with no feedback) | Add `toast.success("…")` before the close call |
| Destructive action (`delete`, `deactivate`, `reset password`) | `useConfirm({ variant: "danger" })` |
| Warning action (generates a temp password, revokes something but recoverable) | `useConfirm({ variant: "warning" })` |
| Raw `window.confirm()` | Replace with `useConfirm()` unconditionally |
| Page-load failure that leaves the view unusable | Keep inline / render a fallback UI. Persistent UI beats transient snackbar. |
| Field-level synchronous validation ("password too short", "passwords don't match") | Keep inline — belongs next to the input |
| Provider-internal load state | Leave alone — not a user-facing notification |

**Rule of thumb:** if the user *did something* and wants to know whether it worked, that's the primitives' job. If the user *arrived somewhere* and the page can't render, that's a fallback UI's job.

---

## Intentionally not migrated

Documented here so future readers don't re-file issues against these:

| File | Reason |
|------|--------|
| [Login.tsx](frontend/src/pages/Login.tsx) | Runs outside the provider tree (pre-auth route). |
| [Dashboard.tsx](frontend/src/pages/Dashboard.tsx) | Page-load fallback. Swapping to snackbar would leave perpetual skeleton widgets after the 6s dismiss. |
| [MyMentees.tsx](frontend/src/pages/MyMentees.tsx) | Same — page-load fallback with empty-state confusion if the snackbar dismisses. |
| [MenteeDetail.tsx](frontend/src/pages/MenteeDetail.tsx) | Same — 404 vs generic fallback is persistent UI by design. |
| [ManagementTab.tsx](frontend/src/components/project-reviews/ManagementTab.tsx) | Read-only view — inline error is the only fallback available. |
| [ReviewDetailView.tsx](frontend/src/components/project-reviews/ReviewDetailView.tsx) | Read-only detail view — same reason. |
| [SystemSettingsProvider.tsx](frontend/src/contexts/SystemSettingsProvider.tsx) | Provider-internal `error` field, no consumer reads it. Removing it is scope creep. |
| [utils/errors.ts](frontend/src/utils/errors.ts) | Helper function, not UI state. |
| Modal-scoped `modalError` / `formError` / `notifyError` in `UserModal`, `GoalFormModal`, `GoalSelfReviewModal`, `GoalMentorReviewModal`, `SelfReviewFormModal`, `EvalModal`, `ImpactModal`, `FeedbackModal`, `NotifyModal` | Inline errors next to submit buttons are correct UX. Caller now fires `toast.success` on success; the error stays where it belongs. |

---

## Verification

### Typecheck (must be clean on every iteration)

```
cd frontend && npx tsc --noEmit
```

Zero output expected.

### Manual smoke test

Do each of these in order — every flow exercises at least one primitive.

| # | Action | Expected |
|---|--------|----------|
| T1 | Admin Panel → Users → KeyRound on any non-admin | Warning confirm dialog; on confirm, reveal modal shows temp password; close → no trailing banner anywhere |
| T2 | Admin Panel → Users → UserX on any user | Danger confirm dialog; on confirm, toast "X deactivated" top-center; row dims |
| T3 | Admin Panel → Users → UserCheck on a deactivated user | Default confirm dialog; on confirm, toast "X reactivated"; row un-dims |
| T4 | Admin Panel → Projects → Trash2 on any project | Danger confirm dialog; on confirm, toast "\"Name\" deleted" |
| T5 | Admin Panel → Settings → change any toggle → Save | Toast "Configuration saved" top-center; no inline banner |
| T6 | Profile → Change Password → submit | Toast "Password updated"; form clears; no inline green banner |
| T7 | Annual Reviews → Start Self-Review → submit | Toast "Self-review submitted" |
| T8 | Yearly Goals → Create → submit | Toast "Goal created" |
| T9 | Yearly Goals (as mentor) → approve team goal | Toast "X's goal approved"; row status updates |
| T10 | Project Reviews → submit PM evaluation | Toast "Evaluation submitted" |
| T11 | Block network, then trigger any of T5–T10 | Red snackbar top-right with API error message; stacks if you trigger multiple |
| T12 | Open a ConfirmDialog → press Esc | Dialog closes, action cancels |
| T13 | Open a ConfirmDialog → press Enter | Confirms (same as clicking the confirm button) |
| T14 | Open a ConfirmDialog → click the backdrop | Dialog closes, action cancels |
| T15 | Fire 3 toasts in rapid succession | Only the most recent is visible (replace policy) |
| T16 | Fire 3 snackbars in rapid succession | All 3 stack top-right, each with its own 6s timer |

### Regression watch

- `DeactivateModal.tsx` and `ReactivateModal.tsx` no longer exist — any import of them will fail the build, which is the correct regression signal.
- `ResetPasswordModal.tsx` was renamed to `TempPasswordRevealModal.tsx`; the import in `AdminPanel.tsx` was updated. History was preserved via `git mv`.
- `SystemSettingsTab`'s prop interface is narrower (`settingsSaved`, `saveError` removed). Any caller still passing them would fail the build.

---

## File map appendix

### Created

- [frontend/src/contexts/ToastContext.ts](frontend/src/contexts/ToastContext.ts)
- [frontend/src/contexts/ToastProvider.tsx](frontend/src/contexts/ToastProvider.tsx)
- [frontend/src/contexts/SnackbarContext.ts](frontend/src/contexts/SnackbarContext.ts)
- [frontend/src/contexts/SnackbarProvider.tsx](frontend/src/contexts/SnackbarProvider.tsx)
- [frontend/src/contexts/ConfirmContext.ts](frontend/src/contexts/ConfirmContext.ts)
- [frontend/src/contexts/ConfirmProvider.tsx](frontend/src/contexts/ConfirmProvider.tsx)
- [frontend/src/hooks/useToast.ts](frontend/src/hooks/useToast.ts)
- [frontend/src/hooks/useSnackbar.ts](frontend/src/hooks/useSnackbar.ts)
- [frontend/src/hooks/useConfirm.ts](frontend/src/hooks/useConfirm.ts)
- [frontend/src/components/feedback/Toast.tsx](frontend/src/components/feedback/Toast.tsx)
- [frontend/src/components/feedback/Snackbar.tsx](frontend/src/components/feedback/Snackbar.tsx)
- [frontend/src/components/feedback/ConfirmDialog.tsx](frontend/src/components/feedback/ConfirmDialog.tsx)

### Deleted

- `frontend/src/components/admin/DeactivateModal.tsx`
- `frontend/src/components/admin/ReactivateModal.tsx`

### Renamed

- `frontend/src/components/admin/ResetPasswordModal.tsx` → [TempPasswordRevealModal.tsx](frontend/src/components/admin/TempPasswordRevealModal.tsx) (via `git mv`)

### Modified

**Infrastructure:**
- [frontend/src/main.tsx](frontend/src/main.tsx) — provider mount order

**Admin:**
- [frontend/src/pages/AdminPanel.tsx](frontend/src/pages/AdminPanel.tsx)
- [frontend/src/components/admin/ProjectsTab.tsx](frontend/src/components/admin/ProjectsTab.tsx)
- [frontend/src/components/admin/ProjectModal.tsx](frontend/src/components/admin/ProjectModal.tsx)
- [frontend/src/components/admin/SystemSettingsTab.tsx](frontend/src/components/admin/SystemSettingsTab.tsx)
- [frontend/src/components/admin/UsersTab.tsx](frontend/src/components/admin/UsersTab.tsx)

**Profile:**
- [frontend/src/components/profile/PasswordChangeCard.tsx](frontend/src/components/profile/PasswordChangeCard.tsx)

**Goals:**
- [frontend/src/pages/YearlyGoals.tsx](frontend/src/pages/YearlyGoals.tsx)
- [frontend/src/components/goals/TeamGoalsTab.tsx](frontend/src/components/goals/TeamGoalsTab.tsx)
- [frontend/src/components/goals/CriteriaChecklist.tsx](frontend/src/components/goals/CriteriaChecklist.tsx)
- [frontend/src/components/mentees/MenteeGoalsTab.tsx](frontend/src/components/mentees/MenteeGoalsTab.tsx)

**Project reviews:**
- [frontend/src/components/project-reviews/PMEvaluationTab.tsx](frontend/src/components/project-reviews/PMEvaluationTab.tsx)
- [frontend/src/components/project-reviews/SecondaryEvalTab.tsx](frontend/src/components/project-reviews/SecondaryEvalTab.tsx)
- [frontend/src/components/project-reviews/EvaluationsTab.tsx](frontend/src/components/project-reviews/EvaluationsTab.tsx)
- [frontend/src/components/project-reviews/SelfReviewForm.tsx](frontend/src/components/project-reviews/SelfReviewForm.tsx)
- [frontend/src/components/mentees/MenteeProjectsTab.tsx](frontend/src/components/mentees/MenteeProjectsTab.tsx)

**Annual reviews:**
- [frontend/src/pages/AnnualReviews.tsx](frontend/src/pages/AnnualReviews.tsx)
