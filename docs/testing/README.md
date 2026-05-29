# Testing — Index

This folder has **two layers**:

1. **Foundation (existing)** — pytest + Vitest harness running in CI for pure-function coverage. Described below.
2. **PMS Test Framework (new — files 00..06)** — the full manual + simulated test programme that complements the seven `docs/QA-Test-Cases-NN-*.md` checklists. Adds cross-module sync, multi-year cycle simulation, project-lifecycle coverage, and an edge-case + validation-gap register.

---

## The PMS Test Framework — sequential path

Read these in order. The CSV is the master traceability log; the markdown files contain the actual test cases.

| # | File | Purpose |
|---|------|---------|
| 00 | [00-framework-overview.md](00-framework-overview.md) | Framework choice (pytest + Playwright + Cycle-Sim Harness), tooling, coverage goals |
| 01 | [01-traceability-matrix.csv](01-traceability-matrix.csv) | Master Excel/Sheets-importable inventory of all TCs across all modules |
| 02 | [02-cross-module-sync-tests.md](02-cross-module-sync-tests.md) | TC-SYNC-001..020 — mentor↔mentee↔goal↔review↔360↔settings sync |
| 03 | [03-cycle-simulation-playbook.md](03-cycle-simulation-playbook.md) | TC-CYCLE-001..022 — H1/H2/Q1..Q4/FY rollover via `simulated_today` |
| 04 | [04-project-lifecycle-tests.md](04-project-lifecycle-tests.md) | TC-PROJLC-001..020 — project create → execute → complete → archive |
| 05 | [05-edge-cases-and-validation-gaps.md](05-edge-cases-and-validation-gaps.md) | TC-GAP-001..040 — validation, security, concurrency, anonymity |
| 06 | [06-execution-runbook.md](06-execution-runbook.md) | How to actually run a full test pass + defect filing template |

Inputs feeding the framework (the existing manual QA checklists):

- [QA-Test-Cases-01-Foundational.md](../QA-Test-Cases-01-Foundational.md) — TC-AUTH, TC-RBAC, TC-PROFILE, TC-NOTIF, TC-CHROME
- [QA-Test-Cases-02-AnnualGoals.md](../QA-Test-Cases-02-AnnualGoals.md) — TC-GOAL, TC-SELFREV, TC-MENT-GOAL
- [QA-Test-Cases-03-AnnualReviews.md](../QA-Test-Cases-03-AnnualReviews.md) — TC-AREV, TC-MREV, TC-MGMTREV
- [QA-Test-Cases-04-ProjectReviews.md](../QA-Test-Cases-04-ProjectReviews.md) — TC-PR-MY, TC-PMR, TC-SEC, TC-ALLPR
- [QA-Test-Cases-05-Feedback360.md](../QA-Test-Cases-05-Feedback360.md) — TC-FB360
- [QA-Test-Cases-06-Mentoring.md](../QA-Test-Cases-06-Mentoring.md) — TC-MENT
- [QA-Test-Cases-07-AdminAndCrossCutting.md](../QA-Test-Cases-07-AdminAndCrossCutting.md) — TC-DASH, TC-ADMIN-*, TC-EXP, TC-RESP, TC-A11Y...

Total coverage: **~519 TCs** = 443 existing + 76 new (cross-module, cycle simulation, project lifecycle, edge cases).

---

## Foundation (pre-existing pytest + Vitest harness)

This was the **placeholder pillar** for tests + CI. Intentionally minimal — just enough harness and a handful of pure-function tests so that adding more later is a matter of writing tests, not setting up tooling.

Real test coverage (integration tests, E2E, coverage thresholds, gates that block merges) lands **after** the development + bug-fix phase is done. Until then this layer exists to:
- Catch obvious regressions in the small set of pure helper functions covered.
- Verify lint + type-check don't silently rot.
- Keep the CI muscle warm.

## Layout

```
backend/
  pytest.ini                              # markers + addopts
  ruff.toml                               # lint config (tests/ only)
  requirements-dev.txt                    # pytest, httpx, pytest-cov, ruff
  tests/
    conftest.py                           # placeholder
    test_cycle_utils.py                   # fiscal year math, review windows
    test_security.py                      # bcrypt + JWT

frontend/
  vitest.config.ts
  vitest.setup.ts
  src/
    __tests__/rtl-smoke.test.tsx          # proves RTL pipeline works
    utils/__tests__/
      fy.test.ts                          # FY label parsing
      errors.test.ts                      # axios error guard
      sort.test.ts                        # column sort comparators

.github/workflows/ci.yml                  # backend + frontend, parallel
```

## Running locally

```pwsh
# Backend
cd backend
pip install -r requirements-dev.txt
pytest tests/ -v
ruff check .

# Frontend
cd frontend
npm install
npm run test:ci
npm run lint
npm run typecheck
```

## CI gates

[.github/workflows/ci.yml](../../.github/workflows/ci.yml) runs two parallel jobs on every push and PR:

| Job | Steps |
|---|---|
| **Backend** | `ruff check .` → `pytest tests/ -v` |
| **Frontend** | `npm run lint` → `npm run typecheck` → `npm run test:ci` |

Backend job sets dummy `SECRET_KEY` / `DATABASE_URL` / `FEEDBACK_HASH_SECRET` env vars so `Settings()` instantiates without `.env`. No DB is required for any test in this foundation.

## Tests assume no real users

Tests **do not depend on any seeded user data**. They cover pure functions only. When you reset the DB via `seed-production.py`, no test cases break — the suite has no opinion on what rows exist.

## What's intentionally out for now

- **Integration / route tests.** They need a seeded DB + auth fixtures; that requires test users which you'll create yourself once the system is stable.
- **E2E** (Playwright / Cypress).
- **Coverage thresholds.** Add `--cov-fail-under=N` once the suite is bigger.
- **Frontend component tests beyond the RTL smoke.** Real components depend on auth / theme / query-client / router contexts; a `renderWithProviders()` helper is the prerequisite.
- **Backend lint on `app/`.** Legacy tree, separate cleanup pass.

## Upgrade path

Once development is stable enough to invest in real testing:

1. Add `backend/tests/integration/` for DB-backed tests. Use whatever users you've created via `seed-production.py`; parametrise the test user emails so they're easy to update.
2. Add a Postgres service container to `.github/workflows/ci.yml` so integration tests run in CI.
3. Build a `renderWithProviders()` helper in frontend so component tests can use real contexts.
4. Ratchet on `--cov-fail-under=50` (backend) and Vitest coverage (frontend).
5. Expand `ruff.toml` include to `app/**/*.py` and clean up violations in a dedicated PR.
6. Add Playwright for thin E2E (login → critical user journey).
