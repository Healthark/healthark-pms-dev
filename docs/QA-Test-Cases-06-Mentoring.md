# QA Test Cases — Module 6: Mentoring (My Mentees & Mentee Detail) — Healthark-only

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Modules 1–4 reviewed. Apply Module 1 §1.6 UI checklist on every screen.
> **Test accounts needed:**
> - **Mentor** — a Staff who is the `mentor_id` of at least 3 mentees, with mentees in mixed pending states (some with pending goal approvals, some with pending self-reviews, some all caught up).
> - **Mentor with no pending actions** — for "all clear" empty/zero-state checks.
> - **Staff with no mentees** — to verify My Mentees is HIDDEN from sidebar.
> - **A mentee account** — for cross-checking visibility (mentor sees their data).
>
> **Vocab:**
> - **Mentee** — any Staff whose `mentor_id` equals the current user's id.
> - **Pending actions count** — sum of (goals awaiting your approval) + (annual reviews awaiting your mentor evaluation) + (other items requiring mentor attention) — per mentee. Surfaced as a badge on the mentee's card.
> - **MenteeDetail tabs** — read-only aggregator of a single mentee's data across Annual Summary, Projects, Goals, and Review.

---

## 6.1 My Mentees — Sidebar & Entry

### TC-MENT-001 — My Mentees hidden when user has no mentees

**Login as:** Staff with `has_mentees = false`
**Steps:**
1. Open the sidebar.

**Expected:**
- **My Mentees** item is NOT present in the sidebar.
- Direct URL `/my-mentees` redirects to `/dashboard` (or `/unauthorized` if dashboard isn't accessible).

---

### TC-MENT-002 — My Mentees visible when user has mentees

**Login as:** Mentor (`has_mentees = true`)
**Steps:**
1. Open the sidebar.

**Expected:**
- **My Mentees** appears in the sidebar with the **Users** (people) icon.
- Clicking it loads `/my-mentees`.

---

## 6.2 My Mentees — List View

### TC-MENT-003 — Open My Mentees page

**Login as:** Mentor
**Steps:**
1. Click **My Mentees** in the sidebar.

**Expected:**
- Page header reads "My Mentees" with a Users icon.
- Default view is **Cards (grid)**.
- A card / row for each of your direct mentees.
- Each card shows:
  - Avatar / initials
  - Full name
  - Employee code
  - Email
  - Department · Designation
  - **Pending actions count** badge (number of items needing your attention for this mentee).
- A toolbar above the grid contains: Search box, "Only pending" filter, Sort dropdown, Grid/Table view toggle.

**UI checks:**
- Cards in the same row have equal height.
- Pending count badge uses an attention color (red or amber) when > 0; muted gray when 0.

---

### TC-MENT-004 — Mentees only show YOUR direct reports

**Login as:** Mentor A
**Steps:**
1. Open My Mentees.

**Expected:**
- Only Staff with `mentor_id == Mentor A's id` appear.
- Mentees of other mentors are NOT visible.
- The current user (Mentor A) is not in their own list.

---

### TC-MENT-005 — Search by name or employee code

**Login as:** Mentor with 5+ mentees
**Steps:**
1. Type part of a mentee's name in the search box.
2. Clear; type part of an employee code.

**Expected:**
- Live filter: only matching mentees remain visible.
- Search matches both name and employee_code (case-insensitive).
- Clearing the search restores the full list.

---

### TC-MENT-006 — "Only pending" filter

**Login as:** Mentor
**Steps:**
1. Toggle the **Only pending** filter ON.

**Expected:**
- Only mentees with `pending_actions_count > 0` are visible.
- Mentees with 0 pending actions are hidden.
- Toggle OFF restores the full list.

---

### TC-MENT-007 — Sort dropdown (card view)

**Login as:** Mentor
**Steps:**
1. Open the Sort dropdown.
2. Try each option in turn (e.g. "Name A–Z", "Pending actions").

**Expected:**
- The grid re-orders according to the chosen sort key.
- "Pending actions" sort puts mentees with the most pending work at the top.

---

### TC-MENT-008 — Grid / Table view toggle

**Login as:** Mentor
**Steps:**
1. Click the view toggle → switch to **Table**.

**Expected:**
- Mentees render as a table with columns: Name · Employee Code · Email · Department · Designation · Pending Actions.
- Column headers are clickable to sort (TC-MENT-009).
- Active view selection persists during the session (verify behavior — table preserved on tab switch within the page).

---

### TC-MENT-009 — Table column sort

**Login as:** Mentor (table view)
**Steps:**
1. Click the **Name** column header → A→Z sort.
2. Click again → Z→A.
3. Click **Pending Actions** → numeric sort (most pending first).
4. Click **Department** → alphabetical.

**Expected:**
- Sort indicator (arrow) appears only on the active column.
- Empty values sort to the end consistently.

---

### TC-MENT-010 — Empty state when no mentees match filter

**Login as:** Mentor
**Steps:**
1. Type a nonsense search term that matches no mentee.

**Expected:**
- Friendly empty state: "No mentees match your search."
- Clearing the search restores results.

---

### TC-MENT-011 — Loading skeleton on initial load

**Login as:** Mentor (use DevTools → Network → Slow 3G)
**Steps:**
1. Navigate to My Mentees.

**Expected:**
- Skeleton cards (animated pulse) render while data loads.
- Cards do not flash empty before the first paint.

---

### TC-MENT-012 — Error state when API fails

**Login as:** Mentor (use DevTools → Network → block `/api/v1/mentees`)
**Steps:**
1. Navigate to My Mentees.

**Expected:**
- A clear error message: "Could not load mentees. Please try again." (or similar).
- No crash, no blank screen, no stack trace.

---

### TC-MENT-013 — Pending action count matches reality

**Pre-condition:** A mentee (call them Bob) has 2 goals awaiting your approval and 1 annual review awaiting your mentor evaluation. So Bob's pending_actions_count = 3.
**Login as:** Mentor
**Steps:**
1. Open My Mentees → find Bob's card.
2. Note the badge number (should be 3).
3. Approve one of Bob's goals via the Annual Goals → Team Goals tab.
4. Return to My Mentees and refresh.

**Expected:**
- Bob's badge updates to 2.
- (If real-time refresh is implemented, the change appears without manual refresh.)

---

## 6.3 Open a Mentee → MenteeDetail

### TC-MENT-014 — Click a mentee card → MenteeDetail loads

**Login as:** Mentor
**Steps:**
1. On My Mentees, click any mentee's card.

**Expected:**
- Navigates to `/my-mentees/<mentee_id>`.
- The **MenteeDetail** page loads.
- A header section shows: mentee's name, employee code, email, department, designation, mentor (you).
- Tabs are visible: **Annual Summary**, **Projects**, **Goals**, **Review**.

**UI checks:**
- Tabs row uses the same style as other tabbed pages (360 Feedback, AdminPanel).
- A breadcrumb or "Back to My Mentees" link is present.

---

### TC-MENT-015 — Direct URL access for a non-mentee returns 403 / redirect

**Login as:** Mentor A
**Steps:**
1. Find a user Y who is NOT your mentee. Note Y's id (e.g. 42).
2. Try navigating to `/my-mentees/42`.

**Expected:**
- The page does NOT show Y's data.
- You are redirected back to `/my-mentees`, OR you see a clear "Not found / unauthorized" message.
- No data leaks via the API (DevTools → Network → request returns 403/404).

---

## 6.4 MenteeDetail — Annual Summary tab

### TC-MENT-016 — Annual Summary content

**Login as:** Mentor
**Steps:**
1. Open MenteeDetail → **Annual Summary** tab (default).

**Expected:**
- The current FY's annual review status for this mentee:
  - If not started: "Not started" state.
  - If draft: Draft status.
  - If pending mentor: "Awaiting your evaluation" — with a CTA link to open the eval modal (deeplink into Annual Reviews → Team Review).
  - If pending management: "Awaiting management" state.
  - If completed: Final rating shown (if `annual_review_final_rating_visible = true`).
- A summary of self/mentor/management ratings (read-only).

**UI checks:**
- Status badge color matches the conventions used in Annual Reviews module.

---

### TC-MENT-017 — Annual Summary empty state

**Pre-condition:** The mentee has no annual review for the current FY (`AnnualReview` row absent).
**Login as:** Mentor
**Steps:**
1. Open MenteeDetail → Annual Summary.

**Expected:**
- A friendly "No annual review for this cycle yet" state.
- No crash, no console errors.

---

## 6.5 MenteeDetail — Projects tab

### TC-MENT-018 — Projects tab shows current assignments

**Login as:** Mentor
**Steps:**
1. Open MenteeDetail → **Projects** tab.

**Expected:**
- A list of the mentee's current project assignments.
- Each row shows: Project name + code · PM (reports_to) name · assignment_role · start date · status (active / completed).

**UI checks:**
- Project code is monospace and distinct from name.

---

### TC-MENT-019 — Projects tab shows project review status per project

**Login as:** Mentor
**Steps:**
1. Open Projects tab.

**Expected:**
- For each project, the current cycle's project review status is visible (Pending / Draft / Reviewed).
- If `project_ratings_visible = true` AND the review is Reviewed, the Performance Group is shown.
- If `project_ratings_visible = false`, the Performance Group cell reads "Hidden" with a lock icon.

---

### TC-MENT-020 — Click a project review → opens read-only detail

**Login as:** Mentor
**Steps:**
1. On a Reviewed project, click View (or expand).

**Expected:**
- Same read-only modal as in Module 4 §TC-PR-MY-002 — competencies, impact statement, secondary impact statements.
- This is read-only — Mentor cannot edit the PM's review.

---

### TC-MENT-021 — Empty state when mentee has no projects

**Login as:** Mentor (mentee is not assigned to any project)
**Steps:**
1. Open Projects tab.

**Expected:**
- "No projects yet" state — friendly, no crash.

---

## 6.6 MenteeDetail — Goals tab

### TC-MENT-022 — Goals tab shows current-cycle goals

**Login as:** Mentor
**Steps:**
1. Open MenteeDetail → **Goals** tab.

**Expected:**
- Mentee's annual goals for the current cycle are listed.
- Each row shows: Title, Status (Draft / Pending / Approved / etc.), Progress %.
- Click a row to expand the criteria checklist and any submitted self/mentor reviews.

---

### TC-MENT-023 — Mentor can act on a pending goal from here

**Login as:** Mentor
**Steps:**
1. On a Pending Approval goal, click the action button.

**Expected:**
- Either:
  - An inline approve/reject is offered, OR
  - You're navigated to Annual Goals → Team Goals with the goal pre-selected.
- After acting, returning to MenteeDetail shows the updated status.

---

### TC-MENT-024 — Goals tab respects cycle filter (FY)

**Login as:** Mentor
**Steps:**
1. If the page exposes an FY picker on this tab, switch to a past FY.

**Expected:**
- Only that FY's goals show.
- If no FY picker, only current-cycle goals show — verify with product.

---

## 6.7 MenteeDetail — Review tab

### TC-MENT-025 — Review tab shows mentee's full annual review

**Login as:** Mentor
**Steps:**
1. Open MenteeDetail → **Review** tab.

**Expected:**
- A read-only view of the mentee's annual review for the current FY.
- Sections:
  - Self review (`self_overall_review`, `self_performance_rating`).
  - Mentor review (yours — `mentor_overall_review`, `mentor_performance_rating`).
  - Management remarks (if completed).
  - Final rating (only if `annual_review_final_rating_visible = true`).

**UI checks:**
- If you haven't yet submitted your mentor review, your section shows an "Awaiting your evaluation" call-to-action that deeplinks into Annual Reviews → Team Review.

---

### TC-MENT-026 — Review tab final rating visibility

**Pre-condition:** The mentee's review is Completed with `final_performance_rating` set.
**Steps:**
1. Admin sets `annual_review_final_rating_visible = false`.
2. Login as Mentor → MenteeDetail → Review.

**Expected:** Final rating shows as "Hidden" with a lock icon — not the number. Mentor still sees their own mentor_performance_rating (because that's required for the workflow).

---

## 6.8 Cross-checks

- Refer to **Module 1 §1.6** UI checklist on every screen.
- Mentor visibility is strictly per-mentee — no leakage of non-mentees' data via any tab or API endpoint.
- MenteeDetail is read-only as an aggregator: all CTAs link out to the canonical edit surfaces (Annual Goals, Annual Reviews) rather than duplicating edit forms.
- The pending_actions_count badge on My Mentees must match the count of items needing the mentor's attention across goals + annual reviews (and any other mentor-driven action).
- When a mentor is reassigned (Admin changes a mentee's `mentor_id` to someone else), the previous mentor should no longer see that mentee on next page load.
- Test in three browser widths: narrow / medium / wide.

---

**End of Module 6.** Next: Module 7 — Dashboard, Admin Panel, Exports, and Cross-Cutting UX/Regression.
