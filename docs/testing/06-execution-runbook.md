# 06 — Execution Runbook

> **Audience:** QA executing a full test pass.
> **Purpose:** Concrete step-by-step procedure for running the framework. Environment setup, sequencing, evidence capture, defect filing.

---

## 6.1 Before you start — environment & access checklist

| Item | How to verify |
|------|---------------|
| Staging URL reachable | `curl -I https://pms-staging.healthark...` returns 200 |
| `ALLOW_DATE_SIMULATION=true` on the server | GET `/admin/settings` response includes `date_simulation_allowed=true` |
| All 8 test accounts (per [02 §2.0](02-cross-module-sync-tests.md#20-roles--seed-data-the-suite-assumes)) seeded | Login each one once |
| Three test projects (Alpha/Beta/Gamma per [04](04-project-lifecycle-tests.md#40-pre-requisites--fixtures)) | Visible in Admin → Projects |
| Browser DevTools open (F12) | Console + Network tabs visible |
| Spreadsheet open: copy of [01-traceability-matrix.csv](01-traceability-matrix.csv) | Used as your live test log |
| Screen recorder ready | OBS / Loom / built-in screen record |

**Production check:** Confirm `ALLOW_DATE_SIMULATION=false` on production. Test the *staging* URL only.

---

## 6.2 Sequence: which file to run, in what order

Run files in this exact order. Each builds on the prior.

| Step | Doc | Estimated time | Why this order |
|------|-----|----------------|----------------|
| 1 | [QA-Test-Cases-01-Foundational.md](../QA-Test-Cases-01-Foundational.md) | 2h | Auth + chrome must work before anything else |
| 2 | [QA-Test-Cases-02-AnnualGoals.md](../QA-Test-Cases-02-AnnualGoals.md) | 3h | Goals seed the data downstream tests need |
| 3 | [QA-Test-Cases-03-AnnualReviews.md](../QA-Test-Cases-03-AnnualReviews.md) | 2h | Builds on approved goals |
| 4 | [QA-Test-Cases-04-ProjectReviews.md](../QA-Test-Cases-04-ProjectReviews.md) | 2h | Independent of goals/reviews |
| 5 | [QA-Test-Cases-05-Feedback360.md](../QA-Test-Cases-05-Feedback360.md) | 1.5h | Uses mentees from QA-01 setup |
| 6 | [QA-Test-Cases-06-Mentoring.md](../QA-Test-Cases-06-Mentoring.md) | 1.5h | Mentee detail views aggregate steps 2-5 |
| 7 | [QA-Test-Cases-07-AdminAndCrossCutting.md](../QA-Test-Cases-07-AdminAndCrossCutting.md) | 4h | Settings affect everything; run after baseline established |
| 8 | [02-cross-module-sync-tests.md](02-cross-module-sync-tests.md) | 3h | Validates ripple effects |
| 9 | [03-cycle-simulation-playbook.md](03-cycle-simulation-playbook.md) | 4h | Multi-year date sim; resets seed at end |
| 10 | [04-project-lifecycle-tests.md](04-project-lifecycle-tests.md) | 2h | Uses time-sim from step 9 |
| 11 | [05-edge-cases-and-validation-gaps.md](05-edge-cases-and-validation-gaps.md) | 4h | Validation + security boundaries |

**Total: ~30 hours** (≈ 1 week for one tester, ≈ 3 days for two parallel testers split by module).

Parallelisation guide: Tester A runs 1 → 3 → 5 → 8. Tester B runs 4 → 6 → 7 → 10. Both converge on 9 + 11 (time-sim TCs can't run in parallel because they mutate global state).

---

## 6.3 Seeding & reset between phases

Each top-level section ends with a state mutation. Before moving on:

| Boundary | Reset action |
|----------|--------------|
| End of QA-01..07 (steps 1-7) | No reset needed |
| Before step 8 (sync tests) | Re-run `seed-test.py`; verify [02 §2.0](02-cross-module-sync-tests.md#20-roles--seed-data-the-suite-assumes) fixtures |
| Before step 9 (cycle sim) | Clear `simulated_today` if set; confirm active cycle = real today |
| **After step 9** | Re-run seed; `simulated_today=null`; confirm clean state |
| Before step 10 (project lifecycle) | Re-confirm Project Alpha/Beta/Gamma fixtures |
| Before step 11 (edge cases) | No reset; each TC self-contained |

Seed reset command (developer-supplied):

```bash
# from backend/
python seed-test.py --reset --confirm
```

If the seed script does not yet support `--reset`, use these manual steps in psql:

```sql
TRUNCATE feedback_360, export_audit_log, annual_review, project_review_secondary, project_review,
         goal_self_review, goal_audit_log, goal, project_member, project, notification,
         system_settings, user_session, app_user
RESTART IDENTITY CASCADE;
```

Then re-run `python seed-test.py`.

---

## 6.4 Recording results

For each TC in the matrix, fill these columns in the CSV (open in Excel/Google Sheets):

| Column | Source |
|--------|--------|
| `TC_ID` | Pre-populated |
| `Status` (overwrite Ready) | `Pass`, `Fail`, `Blocked`, `Skipped`, `N/A` |
| `Run_Date` (add column) | YYYY-MM-DD |
| `Tester` (add column) | Your name |
| `Build_Version` (add column) | `git rev-parse --short HEAD` from staging |
| `Defect_IDs` (add column) | Jira/Linear ticket IDs |
| `Notes` (add column) | Free text; quote actual response code if Fail |
| `Evidence` (add column) | Link to screenshot / video / curl log |

Save the filled-in CSV as `01-traceability-matrix-RUN-<YYYY-MM-DD>.csv` in your run folder. Do **not** overwrite the canonical CSV in git.

---

## 6.5 Evidence capture conventions

| Evidence type | When | Stored as |
|---------------|------|-----------|
| Screenshot | Every Fail; every UI check finding | `evidence/<TC_ID>/<NN>-<short-desc>.png` |
| HAR file | Any Fail with API involvement | DevTools → Network → Right-click → Save all as HAR |
| Console log | Any JS error | DevTools → Console → Right-click → Save as... |
| curl trace | API-only TCs (TC-GAP-*, TC-CYCLE-*, etc.) | Pipe `curl -v` output to file |
| Video | Race conditions, animation bugs | OBS / Loom; ≤ 60 s clips |

Put everything in `evidence/<run-date>/<TC_ID>/`. Reference the folder from the CSV's `Evidence` column.

---

## 6.6 Defect filing template

```
Title: [PMS] <module> — <one-line behaviour summary>
Severity: Critical / High / Medium / Low
Priority: P0 / P1 / P2

Test Case: TC-<…>
Run Date: <date>
Build: <git-sha-on-staging>
Browser: Chrome 142 / Firefox 129 / Safari 18 / Edge 142
Window: 1440 × 900
Env: staging

Steps to reproduce:
1. ...
2. ...

Expected:
- ...

Actual:
- ...
- HTTP <status> with body { ... }   (if API-related)

Evidence:
- evidence/<run-date>/<TC_ID>/01-screenshot.png
- evidence/<run-date>/<TC_ID>/02-network.har
- evidence/<run-date>/<TC_ID>/03-console.txt

Cycle context (if relevant):
- simulated_today: 2027-04-01
- active_cycle_name: H1 FY27-28
- cycle_type: half_yearly
- fiscal_start_month: 4

Suspected root cause (optional):
- ...
```

---

## 6.7 Daily test-run checklist (copy this into your tracker each morning)

```
[ ] Staging URL up
[ ] Login as admin.mgmt OK
[ ] simulated_today: <value or "null">
[ ] active_cycle_name: <expected for today>
[ ] Today's TC range: ___ to ___
[ ] Evidence folder: evidence/<today>/
[ ] CSV log: 01-traceability-matrix-RUN-<today>.csv

End-of-day:
[ ] All in-progress TCs left in coherent state (no half-finished simulations)
[ ] simulated_today cleared
[ ] Defects filed for the day's Fails
[ ] CSV saved + pushed to shared drive
```

---

## 6.8 Sign-off criteria for a release

Before promoting the staging build to production:

| Gate | Threshold |
|------|-----------|
| QA-01 .. QA-07 (manual baseline) | 100% of P0, ≥ 95% of P1 pass |
| 02-cross-module-sync-tests | 100% of P0 pass |
| 03-cycle-simulation-playbook | 100% pass on dedicated time-sim env |
| 04-project-lifecycle-tests | 100% of P0 pass |
| 05-edge-cases-and-validation-gaps | All P0 either Pass or have a *triaged* defect with a release-decision (deferred / blocked / fixed) |
| All `CONFIRMED BUG` (P0) | Fixed and re-tested |
| `simulated_today` on production | Confirmed **null** |
| `ALLOW_DATE_SIMULATION` on production | Confirmed **false** |

Sign-off captured in `evidence/<run-date>/SIGNOFF.md` referencing the matrix CSV.

---

## 6.9 Where to escalate

| Issue | Escalate to |
|-------|-------------|
| Test account credentials lost | Backend dev lead |
| `seed-test.py` errors | Backend dev lead |
| Email reset link not arriving | DevOps / SES credentials |
| Cycle sim returns 403 unexpectedly | Backend dev lead — check `ALLOW_DATE_SIMULATION` + `is_management` |
| Permission prompt blocks normal flow | QA lead — review staging account permissions |
| Production found with `ALLOW_DATE_SIMULATION=true` | **Halt release**; escalate to security + DevOps immediately |

---

## 6.10 Companion docs

- [00-framework-overview.md](00-framework-overview.md) — framework + tooling.
- [01-traceability-matrix.csv](01-traceability-matrix.csv) — TC inventory.
- [02-cross-module-sync-tests.md](02-cross-module-sync-tests.md) — sync suite.
- [03-cycle-simulation-playbook.md](03-cycle-simulation-playbook.md) — date-sim suite.
- [04-project-lifecycle-tests.md](04-project-lifecycle-tests.md) — project lifecycle.
- [05-edge-cases-and-validation-gaps.md](05-edge-cases-and-validation-gaps.md) — edge cases.
