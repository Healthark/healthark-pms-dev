# 37 — Project reviews scoped to the fiscal year (one per project/year)

## Context

A project review row was keyed on the org's **full active cycle label**
(`"H1 FY26-27"`), so when the admin rotated the cycle from H1 → H2 within one
fiscal year, the `(org, user, project, cycle)` unique key changed and a *second*
review could be created for the same employee on the same project — effectively
two project-review cycles per FY.

Product intent is **one project review per employee per project per fiscal
year**. (Annual *goals* keep their two H1/H2 self+mentor rounds — that cadence is
unchanged; this note is only about project reviews.) The fix re-scopes project
reviews to the bare FY label so the existing unique index enforces one-per-year.

## Backend (single chokepoint)

- `project_review_routes._get_active_cycle` now returns
  `extract_fy_label(settings.active_cycle_name)` → `"FY26-27"` instead of the raw
  cadence label. Every endpoint derives its cycle from this one helper — submit,
  draft, `/mine`, `/pm-queue`, `/all`, `/management` — so all of them inherit FY
  scoping with no further change. The 409 "already evaluated this cycle" guard
  now correctly blocks an H1→H2 re-submit because both resolve to the same FY.
- No model/schema change: `ProjectReview.cycle` stays a `String`, and the
  existing `ix_project_reviews_org_user_proj_cycle` unique index now enforces
  one row per FY for free. `_visible_performance_group` already compared on the
  FY label, so re-stripping an already-bare label is idempotent.

## Migration

- `c9a2f4b81e30` (chained from `b9f3c1a7d2e8`) — **pure data migration, no DDL**.
  Rewrites each row's `cycle` `"H1 FY26-27"` → `"FY26-27"`. Where two cadence
  rows collapse onto the same `(org, user, project, FY)` key it keeps a single
  survivor — a `reviewed` row wins over a later `pending` one, else most-recent —
  and deletes the losers plus their `project_review_evaluators` children
  (FK is `ON DELETE CASCADE`, but spelled out for SQLite). Rows with no parseable
  FY token are left untouched. Irreversible (H1/H2 provenance is discarded), so
  `downgrade` is a no-op. Verified end-to-end on a scratch SQLite DB: collapse,
  reviewed-wins, distinct-FY survival, bare-FY passthrough, orphan-child cleanup.

## Frontend

The three project-review tabs defaulted their cycle filter to the raw
`active_cycle_name`. After the change the stored cycle is the bare FY token, so
the old default matched no row and the list would render empty. Each now strips
to the FY token via the existing `extractFyToken` helper:

- `pages/ProjectReviews.tsx` (My Reviews) — lazy-init + cleared-filter default.
- `components/project-reviews/PMEvaluationTab.tsx` (PM/Secondary queue).
- `components/project-reviews/ManagementTab.tsx` — the old `generateCycleOptions`
  (whose `FY(\d+)$` regex never even matched the spanning `FY26-27` form, so it
  only ever showed the active cycle) is replaced by `generateFyOptions`, which
  lists the active FY plus prior years, newest first, with clean century-boundary
  wraparound.
- The user-facing "Cycle" label / "All Cycles" option / table column header are
  relabelled **Year** across all three tabs, since the values are now fiscal years.

## Seeds

- `seed.py`: the curated narratives still author separate H1/H2 entries, so `_pr`
  is now FY-collision-aware (a `reviewed` row is never downgraded by a later
  `pending`; otherwise the later entry refreshes content) and the cycle literals
  collapse to `FY25-26` (closed) / `FY26-27` (current). `active_cycle_name` itself
  stays `"H1 FY26-27"` — the org cadence is unchanged.
- `test-seed.py`: `COMPLETED_PROJECT_CYCLE` → `"FY25-26"`.

## Tests

- `backend/tests/test_project_review_fy_scope.py` (new): `_get_active_cycle`
  strips to FY for half-yearly and quarterly orgs; a submitted review is stamped
  with the FY label; an **H1→H2 rotation in the same FY yields a single review
  (409 on re-submit)**; a new FY opens a fresh row.
- `test_test_seed_invariants.py`: `COMPLETED_PROJECT_CYCLE` invariant updated to
  `"FY25-26"`.
- `frontend/.../__tests__/ManagementTab.fyOptions.test.ts` (new): `generateFyOptions`
  ordering, default length, century wraparound, legacy bare-FY, unparseable input.
- Full backend suite (175) + frontend FY tests + `tsc --noEmit` all green.
