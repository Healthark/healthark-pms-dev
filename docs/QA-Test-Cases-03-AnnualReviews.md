# QA Test Cases — Module 3: Annual Reviews

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Module 1 & 2 reviewed. Apply Module 1 §1.6 UI checklist on every screen.
> **Test accounts needed:** Staff (with mentor and a current-FY review record), Staff who is a Mentor (has mentees with submitted self-reviews), Admin (`is_management = true`).
> **Vocab — Review Status (`ReviewStatus` enum):**
> - **draft** — Staff is filling in their self-review.
> - **pending_mentor** — Staff submitted; mentor must evaluate.
> - **pending_management** — Mentor submitted; management can calibrate (optionally override) and publish.
> - **completed** — Management has finalized; the final rating is visible (if `annual_review_final_rating_visible = true`).
> **Vocab — Performance Rating (1–5 scale, lower = better):**
> - 1 = Performed beyond expectations
> - 2 = Performed as expected (strong)
> - 3 = Performed as expected
> - 4 = Below expectations
> - 5 = Did not meet goals
> **Vocab — Cycle Name:** Annual reviews use FY-only labels (e.g. "FY26"), regardless of whether the org's `cycle_type` is half_yearly or quarterly for goals. One review per user per FY (unique constraint).

---

## 3.1 My Review tab (Staff)

### TC-AREV-001 — Open My Review

**Pre-condition:** `annual_reviews_enabled = true` in System Settings.
**Login as:** Staff
**Steps:**
1. Open **Annual Reviews** from the sidebar.

**Expected:**
- Page header reads "Annual Reviews" with the active FY (e.g. "· FY26") in muted text.
- Default tab is **My Review** (or "Self-Review").
- A row / card exists for the current FY (synthesized if no record exists yet — see TC-AREV-002).
- The leftmost data column or field shows your assigned **Mentor**'s name.

**UI checks:**
- Top of the page does NOT have a "Start Self-Review" button (the action lives on the row/card).

---

### TC-AREV-002 — Synthesized current-FY row when no review exists

**Pre-condition:** Staff has no annual review for the current FY (`AnnualReview` row absent).
**Login as:** Staff
**Steps:**
1. Open My Review.

**Expected:**
- A single row/card appears for the current FY showing:
  - Mentor's name
  - Cycle: current FY (e.g. "FY26")
  - Status: a muted **Not started** badge
  - Action: a **Start Self-Review** button

---

### TC-AREV-003 — Start a new self-review

**Login as:** Staff
**Steps:**
1. Click **Start Self-Review** on the current-FY row.
2. The **SelfReviewFormModal** opens with the self-review form.
3. Fill in:
   - **Overall self-review** (`self_overall_review`) — long-form reflection.
   - **Self performance rating** (`self_performance_rating`) — pick 1–5 via the PerformanceRatingSelect.
4. Click **Submit**.
5. Confirm in the dialog.

**Expected:**
- Status moves to **Pending Mentor**.
- Action on the row changes from "Start Self-Review" to **View** (read-only).
- Toast: "Self-review submitted."
- The mentor is notified.

**UI checks:**
- Form fields are clearly labeled; required fields have an asterisk.
- The overall-review field is a multi-line textarea (not single-line).
- The performance-rating selector clearly indicates "1 = best" (legend or label).
- Submit button at the bottom; primary brand color; disabled until required fields are non-empty.

---

### TC-AREV-004 — Save Draft

**Login as:** Staff
**Steps:**
1. Click Start Self-Review.
2. Type partial content; pick a rating (or leave blank).
3. Click **Save Draft**.

**Expected:**
- Toast: "Draft saved."
- Modal closes (or stays open with a Draft badge).
- Row Status badge reads **Draft**.
- Action button now reads **Continue Draft**.

---

### TC-AREV-005 — Continue Draft

**Login as:** Staff (with a draft row)
**Steps:**
1. Click **Continue Draft**.
2. Existing draft content loads.
3. Edit; click Save Draft → reopens with new content.
4. Eventually click Submit.

**Expected:**
- Draft is preserved between sessions until submitted.
- After Submit, status moves to Pending Mentor; modal closes.

---

### TC-AREV-006 — Mentor column populated after Save Draft (regression)

**Pre-condition:** Use a test Staff whose mentor is known.
**Login as:** that Staff
**Steps:**
1. Start a self-review and click Save Draft.
2. Observe the row immediately after save.

**Expected:**
- The Mentor column / field still shows the mentor's name (does NOT flash empty).
- Refresh the page → mentor name is still there.

---

### TC-AREV-007 — Cannot submit self-review when `annual_reviews_enabled` is OFF

**Pre-condition:** Admin toggles `annual_reviews_enabled` to OFF in Settings.
**Login as:** Staff
**Steps:**
1. Re-login or refresh.
2. Look for the Annual Reviews entry in the sidebar.

**Expected:**
- Annual Reviews item is hidden from the sidebar.
- Direct URL `/annual-reviews` redirects to `/dashboard`.

---

### TC-AREV-008 — View a completed review

**Pre-condition:** Staff has at least one Completed (`completed`) annual review.
**Login as:** Staff
**Steps:**
1. Find a row whose status is **Completed**.
2. Click **View** → the **AnnualReviewDetailModal** opens.

**Expected:**
- Modal is read-only.
- Sections shown:
  - **Self review** (your `self_overall_review` + `self_performance_rating`).
  - **Mentor review** (`mentor_overall_review` + `mentor_performance_rating`).
  - **Management remarks** (`management_comments`, `management_performance_rating`).
  - **Final rating** (`final_performance_rating`) — visible ONLY if `annual_review_final_rating_visible = true`.
- No edit controls.

**UI checks:**
- If the final rating is hidden, that row reads **"Final rating not yet published"** with a lock icon, not blank.

---

### TC-AREV-009 — Final rating visibility honors `annual_review_final_rating_visible`

**Pre-condition:** A review is Completed with a `final_performance_rating` set.
**Steps:**
1. Admin sets `annual_review_final_rating_visible = false`.
2. Login as the Staff. Open the Completed review.

**Expected:**
- Final rating shows as **"Hidden"** (or a lock icon) — not the number.

**Then:** Admin toggles back to true; refresh the Staff's modal → the number badge reappears.

---

### TC-AREV-010 — FY filter

**Login as:** Staff with reviews from multiple FYs
**Steps:**
1. Use the **Fiscal Year** filter dropdown.
2. Select a past FY (e.g. FY25).

**Expected:** Only that FY's row(s) are shown. "All" resets.

---

### TC-AREV-011 — Status filter

**Login as:** Staff
**Steps:**
1. Use the Status filter.
2. Try each option: Not Started, Draft, Pending Mentor, Pending Management, Completed.

**Expected:** Each option narrows correctly. "All" resets.

---

### TC-AREV-012 — View mode toggle (cards/table)

**Login as:** Staff
**Steps:**
1. Switch to Cards → cards render with Mentor, FY, Status, Action.
2. Switch to Table → table renders the same columns.

**Expected:**
- Both views show identical content.
- Cards equal height in same row.

---

## 3.2 Team Review tab (Mentor)

> **Login pre-condition:** You are somebody's mentor (`has_mentees = true`).

### TC-MREV-001 — Open Team Review queue

**Login as:** Mentor
**Steps:**
1. Open Annual Reviews → **Team Review** tab.
2. Filter Status = "Pending Mentor".

**Expected:** All mentee reviews where the staff has submitted their self-review (status = `pending_mentor`) appear in the queue.

**UI checks:**
- Each row shows mentee name, FY, status, and an action (Open / Continue Draft / View).

---

### TC-MREV-002 — Open a pending mentor review

**Login as:** Mentor
**Steps:**
1. Click on a pending row → the **EvalModal** or **EvalDrawer** opens.

**Expected:**
- Top section: mentee's self-review content (read-only).
  - `self_overall_review`
  - `self_performance_rating` (read-only badge)
- Below: editable mentor inputs:
  - `mentor_overall_review` (textarea)
  - `mentor_performance_rating` (1–5 selector)
- Save Draft and Submit buttons at the bottom.

**UI checks:**
- Read-only vs editable sections are visually distinct (different background tint).
- Modal is comfortably sized; no horizontal scroll.

---

### TC-MREV-003 — Save Draft as Mentor

**Login as:** Mentor
**Steps:**
1. Fill in partial mentor review.
2. Click Save Draft.

**Expected:**
- Draft saves to `mentor_overall_review_draft` + `mentor_performance_rating_draft`.
- Status remains Pending Mentor.
- Reopening loads your draft (not the submitted version).
- Toast: "Draft saved."

---

### TC-MREV-004 — Submit Mentor Review

**Login as:** Mentor
**Steps:**
1. Complete the mentor review form (rating + overall review).
2. Click **Submit** → confirm.

**Expected:**
- The draft fields are promoted to the final `mentor_overall_review` + `mentor_performance_rating` columns.
- Status moves to **Pending Management**.
- The review is removed from the Mentor's pending queue.
- Mentee can see (read-only) the mentor's comments and rating in their own My Review.
- Management is notified.

---

### TC-MREV-005 — Cannot edit submitted mentor review

**Login as:** Mentor
**Steps:**
1. Open a review now in Pending Management state (you already submitted as mentor).

**Expected:**
- View only — no edit controls.
- A note: "Awaiting management review."

---

### TC-MREV-006 — Cannot submit mentor review with missing rating

**Login as:** Mentor
**Steps:**
1. Open a Pending Mentor review.
2. Type only the overall review; leave the rating unselected.
3. Click Submit.

**Expected:**
- Validation error: "Please select a performance rating."
- Form stays open.

---

### TC-MREV-007 — Mentor sees only own mentees

**Login as:** Mentor A
**Steps:**
1. Open Team Review.

**Expected:** Mentor A sees ONLY reviews for users whose `mentor_id` is Mentor A's user id. Other mentors' mentees are not visible.

---

## 3.3 Management Review (Calibration) — Admin with `is_management = true`

### TC-MGMTREV-001 — Open Management Review tab

**Login as:** Admin with `is_management = true`
**Steps:**
1. Open Admin Panel.
2. Click the **Management Review** tab.

**Expected:**
- A calibration grid loads showing every annual review currently in `pending_management` (and optionally completed too — verify).
- Columns: Employee · Department · Designation · Mentor · Self Rating · Mentor Rating · Management Rating · Final Rating · Status · Action.

**UI checks:**
- Column widths are reasonable; long names truncate with "…".

---

### TC-MGMTREV-002 — Filter and sort calibration grid

**Login as:** Admin (is_management)
**Steps:**
1. Filter by Department / Designation / Status.
2. Sort by Mentor Rating column.

**Expected:** Filters narrow the grid correctly; sort indicator appears on the active column.

---

### TC-MGMTREV-003 — Set / override the Management Rating

**Login as:** Admin (is_management)
**Steps:**
1. On a `pending_management` row, click the row → the eval drawer / modal opens.
2. Review self + mentor content (read-only).
3. Set `management_performance_rating` (1–5) — optional override.
4. Add `management_comments`.
5. Set `final_performance_rating` (this is the published value).
6. Click **Save / Publish**.

**Expected:**
- Status moves to **Completed**.
- `final_rating_enabled = true` flips on (or remains true after publish).
- The row's Final Rating column shows the value.
- Toast: "Review completed."
- Both Staff and Mentor can now see the completed review (read-only) — with the final rating visible only if `annual_review_final_rating_visible = true`.

---

### TC-MGMTREV-004 — Save Draft (calibration in progress)

**Login as:** Admin (is_management)
**Steps:**
1. Open a Pending Management review.
2. Set a tentative `management_performance_rating` but do NOT publish.
3. Click **Save** (not Publish).

**Expected:**
- Status stays Pending Management.
- The tentative rating is stored.
- Reopening the row shows the in-progress data.
- The Staff still sees the review as "pending management" (not yet completed).

---

### TC-MGMTREV-005 — Cannot complete without final rating

**Login as:** Admin (is_management)
**Steps:**
1. Open a Pending Management review.
2. Try to publish without setting `final_performance_rating`.

**Expected:** Validation error: "Please set the final rating before publishing." No status change.

---

### TC-MGMTREV-006 — Plain Admin (is_management = false) cannot access Management Review

**Login as:** Admin with `is_management = false`
**Steps:**
1. Open Admin Panel → look at the tabs.
2. Try the URL `/admin?tab=management-review`.

**Expected:**
- Management Review tab is NOT in the tab list.
- Direct URL access does not render the grid (defaults to the first allowed tab, or shows a "no permission" message).
- API calls to `/api/v1/annual-reviews/calibration` return 403 for this user.

---

### TC-MGMTREV-007 — Completed review is locked (no further edits)

**Login as:** Admin (is_management)
**Steps:**
1. Open a Completed review from the calibration grid.

**Expected:**
- Either fully read-only, OR a clearly-labeled "Reopen" / "Edit" action with a destructive confirmation modal (verify the expected behavior with the product team).

---

## 3.4 Cross-checks

- Refer to **Module 1 §1.6** UI checklist on every screen.
- After every submission (self / mentor / management), refresh the page → state persists in the database.
- The Mentor column on Staff's My Review must NEVER show "—" or blank if a mentor is assigned.
- FY formatting is consistent: "FY26" (short) everywhere it appears.
- Test in three browser widths: narrow / medium / wide.
- Confirm that when `annual_review_final_rating_visible` is toggled, the Staff's view updates on next page load (no stale cache).
- Confirm that toggling `annual_reviews_enabled` to OFF hides the sidebar item AND blocks the backend submit endpoint (a stale browser tab attempting Submit should see a clear server error).

---

**End of Module 3.** Next: Module 4 — Project Reviews.
