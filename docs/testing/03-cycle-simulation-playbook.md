# 03 — Cycle Simulation Playbook (Multi-Cycle & Multi-Year)

> **Audience:** QA executing on staging; backend devs writing the harness.
> **Purpose:** Verify the PMS behaves correctly across **H1 → H2 → next FY**, **Q1 → Q2 → Q3 → Q4 → next FY**, **cycle_type swaps**, and **fiscal_start_month** changes — by **simulating dates server-side** instead of waiting six months.
> **Required env flag:** `ALLOW_DATE_SIMULATION=true` (staging or local only — production is hard-blocked at [admin_routes.py:589-593](../../backend/app/api/routes/admin_routes.py#L589)).
> **Time-travel hook:** `SystemSettings.simulated_today` resolved by [`resolve_today()`](../../backend/app/core/cycle_utils.py#L26-L39).

---

## 3.0 How the time-travel hook works

A single nullable date column on `SystemSettings` overrides "today" everywhere cycle logic runs. Set it via:

```bash
# Set simulated date
curl -X PATCH https://staging/admin/settings \
  -H "Authorization: Bearer $MGMT_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"simulated_today": "2027-04-02"}'

# Clear it back to real wall clock
curl -X PATCH https://staging/admin/settings \
  -H "Authorization: Bearer $MGMT_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"clear_simulated_today": true}'
```

**What this affects** (verbatim from [cycle_utils.py](../../backend/app/core/cycle_utils.py)):

| Function | Used for |
|----------|---------|
| `resolve_today()` | Every other function below |
| `current_half_and_fy()` | H1/H2 + FY for half_yearly orgs |
| `current_quarter_and_fy()` | Q1..Q4 + FY for quarterly orgs |
| `current_cycle_and_fy()` | Dispatch by `cycle_type` |
| `get_current_cycle_info()` | Topbar / dashboard active-cycle label |
| `get_goal_cycle_name()` | Stamping `Goal.cycle_name` on create |
| `is_review_window_open()` | Gating self-review and mentor-review submissions |
| `extract_fy_label()` | Annual review FY stamp (strips half/quarter prefix) |

**What this does NOT affect** — these always use real `datetime.utcnow()`:
- `created_at`, `updated_at` columns
- `approved_at` audit stamp
- Notification timestamps
- Export filenames

That separation is by design: simulated time governs business rules; wall time governs audit.

---

## 3.1 Suite-level pre-conditions

| Before each TC | Action |
|----------------|--------|
| Login as `admin.mgmt` (Admin + `is_management=true`) | Required to set `simulated_today` |
| Confirm env flag | `GET /admin/settings` → response includes `date_simulation_allowed=true` |
| Clear stale sim | Send `{"clear_simulated_today": true}` |
| Reset cycle_type | Restore to `half_yearly` unless TC explicitly tests another cadence |
| Seed | `seed-test.py` should leave H1 FY26-27 active at `2026-04-15` |

| After each TC | Action |
|---------------|--------|
| Clear simulation | Send `{"clear_simulated_today": true}` |
| Verify active_cycle | `GET /admin/settings`.`active_cycle_name` reflects real wall date |

---

## 3.2 The reference calendar

For half-yearly cadence with `fiscal_start_month=4` (April):

| Wall date range | active_cycle_name | Notes |
|-----------------|--------------------|-------|
| 2026-04-01 → 2026-09-30 | `H1 FY26-27` | H1 self-review opens late H1 |
| 2026-10-01 → 2027-03-31 | `H2 FY26-27` | H2 self-review opens late H2 |
| 2027-04-01 → 2027-09-30 | `H1 FY27-28` | New FY |
| 2027-10-01 → 2028-03-31 | `H2 FY27-28` | |

For quarterly cadence:

| Wall date range | active_cycle_name |
|-----------------|-------------------|
| 2026-04-01 → 2026-06-30 | `Q1 FY26-27` |
| 2026-07-01 → 2026-09-30 | `Q2 FY26-27` |
| 2026-10-01 → 2026-12-31 | `Q3 FY26-27` |
| 2027-01-01 → 2027-03-31 | `Q4 FY26-27` |

For annual cadence: just `FY26-27` etc.

Each TC below uses dates from this reference.

---

## TC-CYCLE-001 — simulated_today set/clear changes active_cycle

**Type:** SIM **Priority:** P0

**Steps**
1. PATCH `/admin/settings` `{"simulated_today": "2026-09-30"}`.
2. GET `/admin/settings` → expect `active_cycle_name = "H1 FY26-27"`.
3. PATCH `{"simulated_today": "2026-10-01"}`.
4. GET → expect `active_cycle_name = "H2 FY26-27"`.
5. PATCH `{"simulated_today": "2027-04-01"}`.
6. GET → expect `active_cycle_name = "H1 FY27-28"`.
7. PATCH `{"clear_simulated_today": true}`.
8. GET → expect `active_cycle_name` reflects real wall date.

---

## TC-CYCLE-002 — Cleared simulation restores wall-clock behaviour

**Type:** SIM **Priority:** P0

**Steps**
1. Set `simulated_today=2099-01-01` (far future).
2. Confirm `active_cycle_name = "H2 FY98-99"`.
3. Clear simulation.
4. Confirm `active_cycle_name` reflects today's real cycle.
5. Confirm `simulated_today` column reads as `null` after clear.

---

## TC-CYCLE-003 — Non-management admin cannot set simulated_today

**Type:** API **Priority:** P0

**Steps**
1. Authenticate as `admin.std` (Admin, `is_management=false`).
2. PATCH `/admin/settings` `{"simulated_today": "2027-01-01"}`.

**Expected**
- 403 Forbidden with reason `requires_management_admin`.
- Other settings fields on the same PATCH should also be rejected (don't partially apply).

---

## TC-CYCLE-004 — Production env rejects writes

**Type:** API **Priority:** P0

**Pre-condition:** Backend started with `ALLOW_DATE_SIMULATION=false` (or unset).

**Steps**
1. PATCH `/admin/settings` `{"simulated_today": "2027-01-01"}`.

**Expected**
- 403 with `date_simulation_disabled`.
- GET `/admin/settings` → response includes `date_simulation_allowed=false`.
- Frontend Settings page hides the date-sim section entirely (defense in depth — UI control + server check + env flag).

---

## TC-CYCLE-005 — H1 → H2 transition locks H1 reviews

**Type:** SIM **Priority:** P0

**Steps**
1. `simulated_today=2026-09-15`. Active = `H1 FY26-27`.
2. As `mentee.one`, submit H1 self-review on Goal A. Status becomes `H1_SELF_REVIEWED`.
3. As `mentor.alpha`, submit H1 mentor review. Status becomes `H1_MENTOR_REVIEWED`.
4. Advance: `simulated_today=2026-10-01`. Active = `H2 FY26-27`.
5. As `mentee.one`, attempt to edit the H1 self-review.
6. As `mentor.alpha`, attempt to edit the H1 mentor review.

**Expected**
- Steps 5, 6 return 400 with `review_window_closed` (the `is_review_window_open()` gate rejects backfills past the cycle end — but within FY).
- The H1 review content remains visible read-only.
- A new H2 self-review form opens for Goal A (status next allowed: `H2_SELF_REVIEWED`).

---

## TC-CYCLE-006 — H2 self-review window opens; H1 stays closed

**Type:** SIM **Priority:** P0

**Steps**
1. Continue from TC-CYCLE-005.
2. `simulated_today=2026-10-15`. Active = `H2 FY26-27`.
3. POST `/goals/<A>/self_review` for H2 → expect 200.
4. POST `/goals/<A>/self_review` for H1 → expect 400.

**Expected**
- H2 path open; H1 backfill blocked even within the same FY. This is the asymmetric behaviour of `is_review_window_open()` ([cycle_utils.py:138-169](../../backend/app/core/cycle_utils.py#L138-L169)) — backfills allowed for past cycles WITHIN the same FY when the target ≤ current cycle in order? **Verify this branch carefully** — the function returns True iff `target_fy == current_fy AND target_cycle ≤ current_cycle`. So **H1 within FY26 IS allowed when current=H2 FY26**.
- **Open question:** Does the UI hide the H1 form even though API allows it? If yes, that's a UX gap. If no and API allows, expected behaviour is: H1 self-review backfill in H2 succeeds. Verify and capture.

---

## TC-CYCLE-007 — Quarterly Q1→Q2→Q3→Q4 windows

**Type:** SIM **Priority:** P0

**Steps**
1. Set `cycle_type=quarterly`. Set `simulated_today=2026-05-15`. Active = `Q1 FY26-27`.
2. As `mentee.one`, submit Q1 self-review → `Q1_SELF_REVIEWED`.
3. As `mentor.alpha`, submit Q1 mentor review → `Q1_MENTOR_REVIEWED`.
4. Advance to `2026-08-15`. Active = `Q2`. Submit Q2 self+mentor. Status = `Q2_MENTOR_REVIEWED`.
5. Advance to `2026-11-15`. Active = `Q3`. Submit Q3 chain.
6. Advance to `2027-02-15`. Active = `Q4`. Submit Q4 chain.

**Expected**
- Each cycle's review form appears at the correct simulated date.
- ApprovalStatus advances `Q1_MENTOR_REVIEWED → Q2_MENTOR_REVIEWED → Q3_MENTOR_REVIEWED → Q4_MENTOR_REVIEWED`.
- Within FY, **historical** Q reviews remain editable per the `target_cycle ≤ current_cycle` rule.

---

## TC-CYCLE-008 — Single approved goal supports full Q1..Q4 chain

**Type:** SIM **Priority:** P0

**Steps**
- Continue from TC-CYCLE-007.

**Expected**
- One goal record carries all four quarterly self+mentor reviews via the `GoalSelfReview` child rows (one per cycle code per goal).
- `cycle_code` enum values used in order: `Q1`, `Q2`, `Q3`, `Q4`.
- No duplicate cycle_code rows for the same goal.
- After Q4 mentor review, status reaches `Q4_MENTOR_REVIEWED` and the goal is read-only for the rest of FY.

---

## TC-CYCLE-009 — FY26 → FY27 rollover: H2 reviews locked

**Type:** SIM **Priority:** P0

**Steps**
1. `simulated_today=2027-03-31`. Active = `H2 FY26-27`. Submit all H2 chains.
2. `simulated_today=2027-04-01`. Active = `H1 FY27-28`.
3. Attempt to edit any FY26-stamped H1 or H2 review.

**Expected**
- All FY26 reviews → 400 `review_window_closed` (different FY → backfill blocked).
- UI shows reviews from FY26 in read-only mode with a "Locked — past fiscal year" badge.
- `is_review_window_open()` returns False because `target_fy=2026 != current_fy=2027`.

---

## TC-CYCLE-010 — FY27 annual review row creates on first save

**Type:** SIM **Priority:** P0

**Steps**
1. After rollover (continuing TC-CYCLE-009).
2. As `mentee.one`, save Annual Review draft for FY27.
3. DB check: exactly ONE `AnnualReview` row with `cycle_name='FY27-28'` (or equivalent FY27 label).
4. Existing FY26 AnnualReview row untouched.
5. `unique(org_id, user_id, cycle_name)` should permit FY27 alongside FY26.

**Expected**
- Two AnnualReview rows for `mentee.one`: one per FY.
- Each is independently editable per its window state.

---

## TC-CYCLE-011 — Dashboard active-cycle widget swaps on rollover

**Type:** SIM **Priority:** P0

**Steps**
1. Login `mentee.one`. Dashboard open.
2. As `admin.mgmt` in another session, set `simulated_today=2027-04-01`.
3. `mentee.one` refreshes Dashboard.

**Expected**
- Active cycle widget reads `H1 FY27-28`.
- "Pending H1 self-reviews" widget resets to the new cycle (likely shows 0 until new submissions begin).
- FY26 completed counts are *retained* in any "historical" panel (if exists).

---

## TC-CYCLE-012 — Pending mentor review at FY end — grace?

**Type:** SIM **Priority:** P1

**Steps**
1. `simulated_today=2027-03-30`. Goal has `H2_SELF_REVIEWED` (mentor review pending).
2. `simulated_today=2027-04-01`. FY rolled.
3. As `mentor.alpha`, attempt to submit H2 mentor review.

**Expected (capture actual behaviour as policy)**
- Either:
  - (a) **No grace**: 400 `review_window_closed`. Goal stuck at `H2_SELF_REVIEWED` permanently for that FY.
  - (b) **Grace window**: a configurable N-day grace allows post-FY submission.

The current code reads as **(a)** because `is_review_window_open()` strictly compares FYs. Confirm and document as policy.

---

## TC-CYCLE-013 — Backfill H1 self-review post-FY-rollover blocked

**Type:** API **Priority:** P0

**Steps**
1. After rollover to FY27.
2. POST `/goals/<old_FY26_goal>/self_review` for H1.

**Expected**
- 400 with `review_window_closed`.
- DB unaffected.
- Audit log records the rejected attempt (if audit exists).

---

## TC-CYCLE-014 — annual → half_yearly mid-FY

**Type:** SIM **Priority:** P0

**Steps**
1. Org starts with `cycle_type=annual`. `simulated_today=2026-07-01`. Active=`FY26-27`.
2. `mentee.one` has an Annual Review row stamped `cycle_name=FY26-27`.
3. PATCH `/admin/settings` `{"cycle_type": "half_yearly"}`.
4. GET `/admin/settings` → active recomputes to `H1 FY26-27` (July falls in H1).
5. As `mentee.one`, create a new goal.
6. Self-review forms appear?

**Expected**
- New goal's `cycle_name` = `H1 2026`.
- Existing annual review row unchanged.
- H1 self-review form appears for goals once mentor approves them.
- Goals **created before** the swap: their `cycle_name` is annual-style (FY26 only) — they can still receive H1 self-reviews (rule: `cycle_name` is informational; `cycle_code` of self-review row carries H1/H2/Q1..Q4).

---

## TC-CYCLE-015 — half_yearly → quarterly mid-FY: orphan H1 self-reviews

**Type:** SIM **Priority:** P0

**Steps**
1. `cycle_type=half_yearly`. `simulated_today=2026-07-01`. Active=`H1 FY26-27`.
2. `mentee.one` submits Goal A H1 self-review.
3. PATCH `{"cycle_type": "quarterly"}`.
4. GET → active recomputes to `Q2 FY26-27`.
5. As `mentee.one`, open Goal A.

**Expected**
- H1 self-review row still visible read-only (orphaned but not deleted).
- Q2 self-review form available (next allowed cycle_code).
- No Q1 self-review form (Q1 already passed in calendar terms).
- Editing the orphaned H1 self-review: 400 (no H1 cycle when org is quarterly).

**Defect candidate:** If the UI hides the orphan H1 entirely, capture as defect — historical data should always be visible.

---

## TC-CYCLE-016 — quarterly → annual mid-FY

**Type:** SIM **Priority:** P1

**Steps**
1. Start `cycle_type=quarterly`. Submit Q1 review on Goal A.
2. Swap to `cycle_type=annual`.
3. Inspect Goal A.

**Expected**
- Q1 review row preserved read-only.
- No Q2/Q3/Q4 form offered.
- An annual review form for the FY appears (if the annual cadence has a single FY-level self-review form).

---

## TC-CYCLE-017 — Three-year simulation: per-FY annual reviews

**Type:** SIM **Priority:** P0

**Steps**
1. Reset env. `simulated_today=2025-04-15`. Active=`H1 FY25-26`.
2. As `mentee.one`, complete Annual Review for FY25.
3. `simulated_today=2026-04-15`. Active=`H1 FY26-27`. Complete Annual Review for FY26.
4. `simulated_today=2027-04-15`. Active=`H1 FY27-28`. Complete Annual Review for FY27.
5. Query `/annual_reviews/me`.

**Expected**
- THREE distinct AnnualReview rows for `mentee.one`: cycle_names = FY25, FY26, FY27.
- Each independently editable per its cycle window (FY25, FY26 read-only after rollover).
- Mentor reviews per FY independent.
- Management calibration per FY independent.

---

## TC-CYCLE-018 — Multi-year: old goals don't pollute current view

**Type:** SIM **Priority:** P0

**Steps**
1. Goals exist for `mentee.one` in FY25 (10), FY26 (12), FY27 (in progress).
2. As `mentor.alpha`, GET `/goals/team?cycle_name=H1+FY27-28` (or current filter).

**Expected**
- Default view shows ONLY active-cycle goals.
- Filter by FY=25 returns the 10 FY25 goals.
- Filter by FY=26 returns the 12 FY26 goals.
- "All" filter returns 22+ entries with proper pagination.

---

## TC-CYCLE-019 — Multi-year 360 feedback uniqueness per FY

**Type:** SIM **Priority:** P0

**Steps**
1. `simulated_today=2025-12-01`. As `mentor.beta`, submit 360 for `mentee.one` (FY25).
2. `simulated_today=2026-12-01`. As `mentor.beta`, submit 360 for `mentee.one` (FY26).

**Expected**
- Both submissions succeed (different FYs → different reviewer_hashes).
- DB has 2 rows: `(target=mentee.one, fy=2025, hash=H1)` and `(target=mentee.one, fy=2026, hash=H2)` with H1 ≠ H2.
- Attempting a third submission for FY25 → 409.

---

## TC-CYCLE-020 — Multi-year export filtering

**Type:** SIM **Priority:** P0

**Steps**
1. Multi-year data exists per TC-CYCLE-017 / -018 / -019.
2. As `admin.mgmt`, Admin Panel → Exports → Annual Reviews.
3. Filter: FY = FY26. Download.
4. Filter: FY = "All". Download.

**Expected**
- FY26 export contains ONLY FY26 rows.
- "All" export contains all FYs.
- Each row has a `cycle_name` column.
- Filename includes FY label when single-FY filter selected; says "all" or no FY in the filename when "All" selected.

---

## TC-CYCLE-021 — fiscal_start_month change recomputes active_cycle

**Type:** SIM **Priority:** P1

**Steps**
1. `fiscal_start_month=4`, `simulated_today=2026-06-15`. Active=`H1 FY26-27`.
2. PATCH `{"fiscal_start_month": 1}` (calendar year FY).
3. GET → active recomputes; June with FY-start Jan → H1 of FY26 with `FY26` (calendar).

**Expected**
- New active cycle label reflects the calendar-year fiscal start.
- Existing data's `cycle_name` strings unchanged (no retroactive rewrite).

---

## TC-CYCLE-022 — Historical goal cycle_name not retroactively rewritten

**Type:** SIM **Priority:** P1

**Steps**
1. With `fiscal_start_month=4`, create goal A → cycle_name=`H1 2026`.
2. Change `fiscal_start_month=1`.
3. Re-fetch goal A.

**Expected**
- `cycle_name` is still `H1 2026` (immutable historical stamp).
- New goals created after the swap use the new calendar.

---

## 3.99 Suite teardown checks

After running ALL TC-CYCLE-*:
1. `simulated_today` IS null.
2. `cycle_type` restored to canonical staging default (`half_yearly`).
3. `fiscal_start_month=4`.
4. Active cycle reflects real today.
5. Spot-check 5 random staff: their Annual Reviews and Goals are accessible without 500 errors.
6. Audit log shows the trail of settings changes.

---

## Companion docs

- [02-cross-module-sync-tests.md](02-cross-module-sync-tests.md) for the integration TCs that use these sims.
- [04-project-lifecycle-tests.md](04-project-lifecycle-tests.md) for project completion across cycles.
- [05-edge-cases-and-validation-gaps.md](05-edge-cases-and-validation-gaps.md) for edge cases revealed by simulations.
