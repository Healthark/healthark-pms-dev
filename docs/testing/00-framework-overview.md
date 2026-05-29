# 00 — PMS Testing Framework: Overview & Tooling

> **Audience:** QA lead, test engineers, developers writing tests.
> **Purpose:** Define the layered testing framework that complements the seven existing [QA-Test-Cases-NN](../) manual checklists. Establishes how every module is verified individually AND how cross-module sync + multi-cycle behaviour gets exercised.

This document is the **entry point** for the structured test programme. Files **00 → 06** in this folder form a sequential path:

| # | File | Audience | What it gives you |
|---|------|----------|-------------------|
| 00 | [this file](00-framework-overview.md) | Everyone | Framework, tooling, principles |
| 01 | [01-traceability-matrix.csv](01-traceability-matrix.csv) | QA lead | One row per TC across all seven modules — Excel-importable |
| 02 | [02-cross-module-sync-tests.md](02-cross-module-sync-tests.md) | QA + dev | TCs that prove mentor / mentee / goal / review / 360 / settings stay in sync |
| 03 | [03-cycle-simulation-playbook.md](03-cycle-simulation-playbook.md) | QA lead | Multi-year date-travel scripts using `simulated_today` |
| 04 | [04-project-lifecycle-tests.md](04-project-lifecycle-tests.md) | QA + PM | Project create → execute → review → complete → archive across cycles |
| 05 | [05-edge-cases-and-validation-gaps.md](05-edge-cases-and-validation-gaps.md) | QA + dev | TCs the existing QA docs miss; flags suspected validation holes |
| 06 | [06-execution-runbook.md](06-execution-runbook.md) | Tester | Day-of-test procedure: env reset, evidence capture, defect flow |

---

## 1. Why a framework on top of the existing QA docs

The seven existing manual checklists in [docs/](../) (~443 TCs) verify **each module in isolation, in a single cycle, on the current date**. That's necessary but not sufficient. The PMS is a *connected* system:

- A change to **System Settings** (e.g. `cycle_type` flips from `half_yearly` → `quarterly`) must propagate to Goals, Annual Reviews, Project Reviews and the dashboard widget at the same time.
- A **mentor reassignment** must update Team Goals views, Mentee Feedback tabs, sidebar items, and notification routing for both old + new mentor.
- **Project completion** mid-cycle must close pending Project Reviews and stop generating new ones for that PM, while preserving historical reviews.
- The system carries data across **fiscal years** (FY26 → FY27 → FY28). Behaviour at the boundary — what locks, what carries over, what re-creates — is the densest source of latent bugs.

The framework adds three coverage layers the existing docs lack:

1. **Cross-module sync** (file 02) — assertions that span ≥ 2 modules per test.
2. **Multi-cycle / multi-year simulation** (files 03, 04) — uses the `simulated_today` time-travel hook to fast-forward across H1, H2, Q1–Q4, and FY rollovers.
3. **Edge-case + validation-gap register** (file 05) — bugs the current docs would not catch.

---

## 2. Preferred framework: **Pytest + Playwright + Cycle-Sim Harness**

### 2.1 Stack

| Layer | Tool | Status | Lives in |
|-------|------|--------|----------|
| Backend unit | **pytest** + ruff | ✅ Exists | [backend/tests/](../../backend/tests/) |
| Backend API integration | **pytest + httpx + Postgres service container** | ⏳ To build (Phase 2) | `backend/tests/integration/` |
| Frontend unit | **Vitest + React Testing Library** | ✅ Exists | [frontend/src/__tests__/](../../frontend/src/__tests__/) |
| Frontend component | **Vitest + RTL + renderWithProviders helper** | ⏳ To build (Phase 2) | `frontend/src/__tests__/components/` |
| E2E + browser | **Playwright (Chromium + Firefox + WebKit)** | ⏳ To build (Phase 3) | `e2e/` (new) |
| Manual exploratory | **Markdown checklists + CSV matrix** | ✅ Exists ([01-07](../)) | `docs/QA-Test-Cases-*.md` |
| Multi-cycle simulation | **Cycle-Sim Harness** (Python helper) | ⏳ To build (Phase 2) | `backend/tests/integration/cycle_sim.py` |

### 2.2 Why this stack (vs. alternatives)

- **Pytest over unittest** — already the project standard; rich fixtures, parametrize for cycle-permutation tests, plays well with httpx.
- **Playwright over Cypress/Selenium** — multi-browser; can run the *real* React build hitting a *real* FastAPI server with seeded Postgres; first-class trace viewer for flaky E2E.
- **Vitest over Jest** — already the project standard; native ESM, faster, matches Vite build.
- **CSV traceability matrix over Jira test plugin** — auditable in git, no licence, importable to Excel/Google Sheets/Jira CSV import.
- **Cycle-Sim Harness in Python (not bash)** — the time-travel API is already at PATCH `/admin/settings`; a Python helper composes seed-data calls with `simulated_today` jumps in one expressive block.

### 2.3 What we deliberately do **not** include

- **No mocks of the database.** Integration tests hit real Postgres via the test container; mock divergence has burned us before. Pure-function unit tests stay mock-free too.
- **No BDD/Gherkin layer.** The seven QA-Test-Cases docs are already the human-readable specs. Duplicating them in `.feature` files adds maintenance without adding clarity.
- **No flaky retry-on-failure plugin.** Flaky tests get fixed, not retried.

---

## 3. The cycle-simulation harness — core primitive

All multi-cycle TCs (files 03, 04, parts of 02 and 05) rely on one server-side capability: the `SystemSettings.simulated_today` column, resolved by [`resolve_today()`](../../backend/app/core/cycle_utils.py) ([cycle_utils.py:26-39](../../backend/app/core/cycle_utils.py#L26-L39)).

```text
ALLOW_DATE_SIMULATION=true  (env flag — staging/test only, NEVER production)
        │
        ▼
PATCH /admin/settings  { simulated_today: "2027-04-02" }
        │
        ▼
SystemSettings.simulated_today = 2027-04-02
        │
        ▼
resolve_today(settings) → 2027-04-02   (instead of real UTC)
        │
        ├──► get_current_cycle_info()       → "H1 FY27-28"
        ├──► get_goal_cycle_name()          → "H1 2027"
        ├──► is_review_window_open(...)     → gating decision
        └──► /admin/settings GET            → active_cycle recomputes
```

### Harness contract (Phase 2 deliverable)

```python
# backend/tests/integration/cycle_sim.py
class CycleSim:
    def jump_to(self, date_str: str) -> None: ...
    def advance_to_h2(self) -> None: ...
    def advance_to_next_fy(self) -> None: ...
    def set_cycle_type(self, kind: Literal["annual","half_yearly","quarterly"]) -> None: ...
    def clear_simulation(self) -> None: ...
    @property
    def active_cycle(self) -> str: ...
```

Until the Python harness exists, manual testers use the equivalent **curl recipe** documented in [03-cycle-simulation-playbook.md](03-cycle-simulation-playbook.md).

### Safety rails

- The `ALLOW_DATE_SIMULATION` env flag MUST default false. Production deploys MUST omit it (see [admin_routes.py:589-593](../../backend/app/api/routes/admin_routes.py#L589)).
- `simulated_today` writes are restricted to `is_management=true` admins (server-side check).
- Every cycle-sim TC ends with an explicit "clear simulation" step. The harness will assert clear on `tearDown`.

---

## 4. Test taxonomy — what kind of TC goes where

Every TC in this programme is one of:

| Type | Marker / suffix | Lives in | Runs in CI |
|------|-----------------|----------|------------|
| **UNIT** | `pytest unit`, `vitest unit` | `backend/tests/` , `frontend/src/**/__tests__/` | Yes, every push |
| **API** | `pytest -m api` | `backend/tests/integration/` | Yes, every push (uses Postgres container) |
| **COMP** | `vitest comp` | `frontend/src/__tests__/components/` | Yes, every push |
| **E2E** | Playwright `@e2e` | `e2e/` | Nightly + pre-release |
| **MANUAL** | TC-* in markdown docs | `docs/QA-Test-Cases-*.md` and this folder | On each release candidate |
| **SIM** | TC-SIM-* in this folder | [02](02-cross-module-sync-tests.md), [03](03-cycle-simulation-playbook.md), [04](04-project-lifecycle-tests.md), [05](05-edge-cases-and-validation-gaps.md) | Pre-release on staging with `ALLOW_DATE_SIMULATION=true` |

Each TC in the traceability matrix carries its `Type` column so QA leads can filter "only MANUAL on release", "only SIM on cycle-rollover", etc.

---

## 5. Test ID convention

Existing prefixes from [QA-Test-Cases-01..07](../) are preserved verbatim and reused in the traceability matrix. New TCs introduced by this framework use the following extensions, chosen to never collide:

| New prefix | Owner doc | Theme |
|------------|-----------|-------|
| **TC-SYNC-***  | [02](02-cross-module-sync-tests.md) | Cross-module sync (mentor↔mentee↔goal↔review↔360) |
| **TC-CYCLE-*** | [03](03-cycle-simulation-playbook.md) | Cycle-type swap, FY rollover, multi-year |
| **TC-PROJLC-*** | [04](04-project-lifecycle-tests.md) | Project lifecycle (create → review → complete → archive) |
| **TC-GAP-*** | [05](05-edge-cases-and-validation-gaps.md) | Edge cases / suspected validation gaps |

Numbering inside each prefix is zero-padded three digits: `TC-SYNC-001`, `TC-CYCLE-012`, etc.

---

## 6. Coverage goals

The matrix in [01-traceability-matrix.csv](01-traceability-matrix.csv) tracks coverage per module. We target:

| Module | Existing TCs | New TCs added by this framework | Coverage target |
|--------|--------------|----------------------------------|-----------------|
| 1. Foundational | 65 (QA-01) | +5 (SYNC, GAP) | Branch paths in [auth_routes.py](../../backend/app/api/routes/auth_routes.py) |
| 2. Annual Goals | 75 (QA-02) | +12 (SYNC, CYCLE, GAP) | Every ApprovalStatus transition + every cycle window |
| 3. Annual Reviews | 50 (QA-03) | +10 (SYNC, CYCLE, GAP) | All four ReviewStatus stages × cycle-type permutations |
| 4. Project Reviews | 55 (QA-04) | +15 (SYNC, PROJLC, GAP) | PM and Secondary paths × project state transitions |
| 5. 360 Feedback | 32 (QA-05) | +6 (SYNC, CYCLE, GAP) | Anonymity invariant + FY rollover + hash uniqueness |
| 6. Mentoring | 26 (QA-06) | +8 (SYNC, GAP) | Mentor reassignment + cascading effects |
| 7. Admin & Cross-cutting | 140 (QA-07) | +20 (SYNC, CYCLE, GAP) | Settings → downstream propagation |
| **TOTAL** | **~443** | **+76** | **~519 TCs** |

---

## 7. Test environments

| Env | URL pattern | Purpose | Data | `ALLOW_DATE_SIMULATION` |
|-----|-------------|---------|------|--------------------------|
| **local-dev** | `http://localhost:8000` | Developer smoke | Seeded by `seed.py` | `true` |
| **ci-test** | ephemeral container | Pytest + Playwright in CI | Seeded by `seed-test.py` | `true` |
| **staging** | `https://pms-staging.healthark...` | QA execution (this framework) | Seeded by `seed-production.py` (sanitized) | `true` |
| **production** | `https://pms.healthark...` | Live users | Real | **`false` — enforced** |

Cycle-simulation TCs (file 03, 04 and any TC tagged `Type=SIM`) MUST run on staging or local, NEVER on production. The runbook (file 06) makes that explicit on the cover page.

---

## 8. Where to go next

Open files in order:

1. [01-traceability-matrix.csv](01-traceability-matrix.csv) — see the full TC inventory.
2. [02-cross-module-sync-tests.md](02-cross-module-sync-tests.md) — the integration TCs.
3. [03-cycle-simulation-playbook.md](03-cycle-simulation-playbook.md) — time-travel scenarios.
4. [04-project-lifecycle-tests.md](04-project-lifecycle-tests.md) — project completion across cycles.
5. [05-edge-cases-and-validation-gaps.md](05-edge-cases-and-validation-gaps.md) — gaps and suspected bugs.
6. [06-execution-runbook.md](06-execution-runbook.md) — how to actually run a test pass.

---

**Owner:** QA lead. **Last reviewed:** 2026-05-28.
