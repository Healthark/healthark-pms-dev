# F3 — Lazy-load heavy modals across the app

> First pure-FE chunk-size optimization since Phase D. Six heavy
> modals that previously rode along in their parent page's initial
> chunk now load on first click as their own Vite chunks. Biggest
> winner: AdminPanel shrinks from 14.75 kB gzip → 9.30 kB gzip
> (~37% smaller initial download).

## Context

After Phase D (TanStack cache), F1 (optimistic updates), and the
payload-reduction trio (gzip middleware + goals-team slim + mentee
detail split), the remaining low-hanging FE optimization was
**initial chunk size**. Heavy modals that only open on user click
were being eagerly imported by their parent components — every
visitor paid the download cost even if they never opened the modal.

F3 extends the `React.lazy()` pattern already used for route-level
code splitting in `App.tsx` down one level. Each modal becomes its
own chunk; the parent page initial chunk shrinks; first-open of
each modal pays a one-time ~50–150 ms chunk fetch the browser then
caches forever.

No backend changes, no consumer API changes, no behavioural changes
beyond the standard "modal unmounts on close" pattern (which already
applied to most of these via their `{showModal && <X />}` render
guard).

## Code change

Six modals across six parent files. Pattern is uniform — `lazy()` +
`Suspense` boundary. Type-only imports (e.g. `EvalModalCard`,
`ImpactModalRow` in `MenteeProjectsTab`) split out via
`import type { … }` so they don't pull the modal module into the
parent's chunk at all.

| Modal | Parent file | Render-guard pattern |
|---|---|---|
| `ProjectModal` | `components/admin/ProjectsTab.tsx` | `{showModal && <ProjectModal …/>}` |
| `UserModal` | `pages/AdminPanel.tsx` (lives in page, not UsersTab) | `{showUserModal && <UserModal …/>}` (new gate; previously always-mounted with isOpen prop) |
| `EvalModal` (project-reviews) | `components/project-reviews/PMEvaluationTab.tsx` + `components/mentees/MenteeProjectsTab.tsx` | `{evalTarget && <EvalModal …/>}` |
| `ImpactModal` | same two parents as EvalModal | `{impactTarget && <ImpactModal …/>}` |
| `BulkApproveModal` | `components/goals/TeamGoalsTab.tsx` | `{bulkOpen && <BulkApproveModal …/>}` (new gate; previously always-mounted with isOpen prop) |
| `AnnualReviewDetailModal` | `components/mentees/MenteeReviewTab.tsx` | `{viewing && <AnnualReviewDetailModal …/>}` |

Each conditional wrapped in `<Suspense fallback={null}>`. `null` is
correct because the user just clicked a button — there's no visible
empty space; the modal pops in ~50–150 ms.

## Behaviour change worth flagging

`UserModal` and `BulkApproveModal` were previously rendered
unconditionally with an internal `isOpen` prop controlling the
portal/DOM render. To make `React.lazy` work properly (the chunk
fetch only fires when the lazy component renders), both got an outer
`{open && <X .../>}` gate added.

**Impact:** the modal component now unmounts on close instead of
sitting hidden behind `isOpen=false`. If a user typed into the form,
closed the modal without saving, then reopened, their typed input is
gone. This matches the standard modal contract; the other four
modals already worked this way. No data loss path for saved data —
only ephemeral form state.

## Bundle delta

`npm run build` confirms the split. Initial-chunk sizes (gzipped):

| Asset | Pre-F3 | Post-F3 | Delta |
|---|---|---|---|
| `AdminPanel-*.js` | **14.75 kB** | **9.30 kB** | **−5.45 kB (−37%)** |
| `AnnualGoals-*.js` | 12.26 kB | 11.07 kB | −1.19 kB (−10%) |
| `ProjectReviews-*.js` | 8.48 kB | 8.90 kB | +0.42 kB (lazy machinery) |
| `MenteeDetail-*.js` | 12.86 kB | 13.36 kB | +0.50 kB (lazy machinery) |
| `TeamGoalCard-*.js` | 7.36 kB | 7.40 kB | +0.04 kB |
| `ManagementReviews-*.js` | 2.99 kB | 3.02 kB | +0.03 kB |
| Shared `index-*.js` | 68.11 kB | 68.36 kB | +0.25 kB (shared lazy refs) |

New lazy modal chunks (downloaded **only** when a user clicks the
trigger button):

| Chunk | Gzipped |
|---|---|
| `ProjectModal-*.js` | 4.03 kB |
| `EvalModal-*.js` | 3.12 kB |
| `BulkApproveModal-*.js` | 2.45 kB |
| `UserModal-*.js` | 1.86 kB |
| `ImpactModal-*.js` | 1.44 kB |
| `AnnualReviewDetailModal-*.js` | 1.04 kB |
| **Total deferred** | **13.94 kB gzip** |

**Net read:** For users who open zero modals in a session, initial
load shrinks by ~7 kB gzip total across the four impacted pages.
Most sessions land on AdminPanel and don't open the create/edit
modals on every visit, so the ~5.5 kB gzip AdminPanel reduction is
the headline win. The minor `+0.4`–`+0.5` kB increases on
ProjectReviews and MenteeDetail come from the small `React.lazy` +
`Suspense` machinery that gets compiled into the parent chunk —
acceptable given the lazy modal chunks are now ~3 kB each that the
user only fetches on first interaction.

## Test Cases (manual, pre-merge)

Run through this checklist with a user account that can trigger each
modal (Admin for ProjectModal/UserModal; mentor with mentees for the
others).

### Initial chunk size (build artefact)
1. `cd frontend && npm run build`
2. List `dist/assets/`. Confirm six new chunks exist:
   - `ProjectModal-*.js` (~4 kB gzip)
   - `UserModal-*.js` (~1.9 kB gzip)
   - `EvalModal-*.js` (~3.1 kB gzip)
   - `ImpactModal-*.js` (~1.4 kB gzip)
   - `BulkApproveModal-*.js` (~2.5 kB gzip)
   - `AnnualReviewDetailModal-*.js` (~1 kB gzip)
3. Confirm `AdminPanel-*.js` is ~5 kB gzip smaller than the prior baseline.

### Network checks — each modal opens its own chunk on first click
4. Sign in. Open DevTools → Network. Filter `js` and clear after page settles.
5. Navigate to `/admin` → Projects tab. **No** `ProjectModal-*.js` chunk loads yet.
6. Click "Create Project". Network shows **1× `ProjectModal-*.js`** fetch (~4 kB gzip) → modal renders.
7. Cancel the modal. Click "Create" again → **0 new requests** (chunk cached).
8. Repeat per modal:
   - `/admin` → Users tab → "Add User" → `UserModal-*.js` loads once.
   - `/project-reviews` → Evaluate Team tab → click an "Evaluate" row → `EvalModal-*.js` loads once.
   - `/project-reviews` → Evaluate Team tab → click "Write Impact" on a row → `ImpactModal-*.js` loads once.
   - `/annual-goals` → Team Goals tab → click "Bulk Approve" → `BulkApproveModal-*.js` loads once.
   - `/my-mentees/{id}` → Annual Review tab → click "View" on a submitted review → `AnnualReviewDetailModal-*.js` loads once.
   - `/my-mentees/{id}` → Projects tab → click "Evaluate" / "Write Impact" → EvalModal/ImpactModal chunk (same chunks as PMEvaluationTab — shared cache).

### Functional / regression checks
9. Each modal renders **identically** to pre-F3 — same fields, same layout, same focus, no Suspense flicker (since `fallback={null}`).
10. **EvalModal autosave (post-D3 fix safety):** Type into one comment field. Network shows exactly **1× PATCH** ~1.5 s after the last keystroke. No autosave loop. Close + reopen → still works.
11. **EvalModal in MenteeProjectsTab:** open from `/my-mentees/{id}` → Projects tab. Same autosave behaviour.
12. **ImpactModal:** open from PMEvaluationTab AND from MenteeProjectsTab. Same chunk loads once across both parents (single browser cache).
13. **BulkApproveModal + F1 optimistic update:** select 3 goals → "Bulk Approve" → modal opens → submit → modal closes → all 3 rows flip to approved status **instantly** (F1 optimistic update intact).
14. **UserModal:** open with "Add User" → fill form → save → modal closes, list refetches with new user.
15. **AnnualReviewDetailModal:** open with "View" on a submitted review → renders all sections → close.

### Behaviour change check
16. `UserModal` and `BulkApproveModal` now unmount on close (gated by the new outer `&&`). Open the modal, type something, close without saving, reopen → form is empty (re-seeded). Confirm this matches the existing contract — for both modals, that's the expected behaviour since neither carries unsaved-draft semantics.

### Cache + first-open latency
17. Hard-refresh (Ctrl+Shift+R) to clear browser cache. Open a modal → chunk fetches in ~50–300 ms depending on network. Modal appears with no spinner — just a brief moment of nothing, then the modal pops in.
18. On a slow network (Throttle: Slow 3G), the gap is more noticeable on first open. Acceptable for the size win.

### Build
19. `npm run build` passes clean. No new TS errors.

## Risks

- **First-open latency** — ~50–150 ms on a fast connection, longer on slow. Mitigated by `fallback={null}` (no spinner; the user sees a brief no-op between click and modal appearance). If anyone complains, swap to a skeleton fallback.
- **EvalModal autosave** — the modal's mount-time `useEffect` for autosave initialization still runs unchanged. Lazy-loading doesn't change mount semantics. The post-D3 fix's `lastSavedSerializedRef` baseline check + `onSaveDraftRef` still prevent the autosave loop.
- **UserModal + BulkApproveModal form state** — now resets on close (was previously preserved across close+reopen via always-mounted-with-isOpen pattern). Matches the standard modal contract; documented above. No data-loss path for saved data.
- **No prefetch hints** — Vite handles chunk prefetching via `<link rel="modulepreload">` for route chunks, but not for on-click chunks. Users who immediately click "Create Project" on landing pay the chunk-fetch latency once. Acceptable; manual prefetch on link hover is a separate follow-up.

## Pattern reinforced

Same `React.lazy` + `Suspense` pattern already used for route-level
code splitting in `App.tsx`. Extending it to modals is the natural
next step — modals are by definition off the critical render path.

If a future modal grows past ~100 LOC and opens on user click,
apply the same pattern: `const X = lazy(() => import("./X").then(m => ({ default: m.X })))` + `<Suspense fallback={null}>` around the conditional.

## Related artifacts

- Plan source: `C:\Users\Dell\.claude\plans\phase-a-optimization-melodic-sketch.md`
- PR A (gzip): `docs/optimizations/17-gzip-compression.md`
- PR B (goals-team slim): `docs/optimizations/18-team-goals-slim.md`
- PR C (mentee-detail split, E1): `docs/optimizations/19-mentee-detail-split.md`
- F1 (optimistic updates): `docs/optimizations/16-optimistic-updates.md`
- Phase D close-out: `docs/optimizations/15-tanstack-profile.md`
