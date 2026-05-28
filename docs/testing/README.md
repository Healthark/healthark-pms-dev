# Testing — Foundation Only

This is the **placeholder pillar** for tests + CI. Intentionally minimal — just enough harness and a handful of pure-function tests so that adding more later is a matter of writing tests, not setting up tooling.

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
