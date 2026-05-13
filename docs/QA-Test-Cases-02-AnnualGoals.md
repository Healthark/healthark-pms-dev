# QA Test Cases — Module 2: Annual Goals

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** You have completed Module 1 (Foundational). Refer back to Module 1 §1.6 for the cross-cutting UI checklist — apply it on every screen here too.
> **Test accounts needed:** Staff (with mentor), Staff (no mentor), Staff who is a Mentor (has mentees), Admin (`is_management = true`).
> **Vocab — Goal Approval Status:** Goals move through these states (`ApprovalStatus` enum):
> - **Pre-approval:** `draft` → `pending_approval` → `changes_requested` ↺ → `approved`
> - **Post-approval (Half-Yearly cycle):** `h1_self_reviewed` → `h1_mentor_reviewed` → `h2_self_reviewed` → `h2_mentor_reviewed`
> - **Post-approval (Quarterly cycle):** `q1_self_reviewed` → `q1_mentor_reviewed` → … `q4_mentor_reviewed`
> - **Goal Type:** `regular` or `annual`. This module focuses on `annual` goals, which are gated by `annual_goals_edit_enabled` in System Settings.
> **Vocab — Active Cycle:** Set by Admin in System Settings as `cycle_type` (annual / half_yearly / quarterly) + `active_cycle_name` (e.g. "H1 FY26"). The active cycle determines which self-review menu options appear on approved goals.

---

## 2.1 My Goals tab (Staff)

### TC-GOAL-001 — Open My Goals tab

**Login as:** Staff
**Steps:**
1. Open **Annual Goals** from the sidebar.
2. Default tab should be **My Goals**.

**Expected:**
- Page header reads "Annual Goals" with the active cycle name (e.g. "· H1 FY26") in muted text next to it.
- A short subtitle below the header explains the page.
- An **Add Goal** button is in the top-right (only when `annual_goals_edit_enabled = true` AND you have a mentor).
- An empty state shows a target icon and a "No goals yet" message if you have no goals.

**UI checks:**
- Header and Add Goal button are vertically centered with each other.
- If you have no goals yet, the empty-state graphic is centered both horizontally and vertically.

---

### TC-GOAL-002 — Add Goal button hidden when no mentor

**Login as:** Staff who does NOT have a mentor assigned
**Steps:**
1. Open Annual Goals → My Goals.

**Expected:**
- The Add Goal button is REPLACED by a locked banner / disabled state: "No mentor assigned — goal creation is disabled."
- The banner has a lock icon.

**UI checks:**
- Lock icon is the same height as the banner text.
- Banner uses muted/gray styling (not red, not green — it's informational).

---

### TC-GOAL-003 — Add Goal button hidden when `annual_goals_edit_enabled` is OFF

**Pre-condition:** Admin toggles **annual_goals_edit_enabled** to OFF in **Admin Panel → Settings**.
**Login as:** Staff (with a mentor)
**Steps:**
1. Open Annual Goals → My Goals.

**Expected:**
- Add Goal button is REPLACED by an amber banner: "Goal submissions are currently closed." (or similar).
- The banner has a lock icon.

**UI checks:**
- Amber/yellow color (distinct from the gray "no mentor" banner).

---

### TC-GOAL-004 — Create a new annual goal

**Pre-condition:** `annual_goals_edit_enabled = true`, you have a mentor.
**Login as:** Staff
**Steps:**
1. Click **Add Goal** → the **GoalFormModal** opens.
2. Fill in:
   - **Title** (required) — e.g. "Improve assay turnaround time"
   - **Description** (optional)
   - **Goal Type** = Annual
   - **Attachment URL** (optional)
   - Add 2–3 criteria (each requires a title)
3. Click **Save** (or **Create**).

**Expected:**
- Modal closes.
- Success toast appears.
- New goal appears at the top of My Goals (most-recent first).
- Status badge reads **Draft** (gray).
- Progress shows 0% (no criteria completed).

**UI checks on the modal:**
- Modal is horizontally and vertically centered.
- Title field has a clear asterisk indicating required.
- Save and Cancel buttons are at the bottom-right; Cancel left of Save.
- Criteria section lets you add multiple rows with a "+ Add criterion" button — each row aligned consistently.

---

### TC-GOAL-005 — Validation: empty title

**Login as:** Staff
**Steps:**
1. Click Add Goal.
2. Leave Title blank.
3. Click Save.

**Expected:**
- Save does not proceed.
- An inline error appears under the Title field: "Title is required."
- The modal stays open.

---

### TC-GOAL-006 — Edit a draft goal

**Login as:** Staff
**Steps:**
1. On a goal with **Draft** status, click the **Edit** icon (or the goal title).
2. Change the title or description.
3. Add a new criterion; remove an existing one.
4. Save.

**Expected:**
- Goal updates inline; success toast.
- Status remains Draft.
- New criterion appears; removed criterion is gone.

**UI checks:**
- Edit modal pre-fills with the existing values; criteria show in their `sort_order`.

---

### TC-GOAL-007 — Cannot edit a non-draft goal

**Login as:** Staff
**Steps:**
1. Find a goal whose status is **Pending Approval** or **Approved**.
2. Look for the Edit button.

**Expected:**
- Edit button is absent (or disabled) for these statuses.
- Hovering a disabled button (if present) shows a tooltip like "Goal is locked".

---

### TC-GOAL-008 — Submit a draft for approval

**Login as:** Staff
**Steps:**
1. On a Draft goal, click **Request Approval** (or **Submit**).
2. A confirmation dialog appears: "Submit goal for approval?"
3. Click **Submit**.

**Expected:**
- Status badge updates to **Pending Approval** (amber/yellow).
- Edit and Request-Approval buttons disappear.
- A small note "Awaiting mentor review…" appears in the action area.
- A notification is created for the mentor (visible in the mentor's bell icon).

**UI checks:**
- Confirm dialog is centered with clear primary (Submit) and secondary (Cancel) buttons.
- Pending Approval badge color matches every other "pending" badge in the app.

---

### TC-GOAL-009 — Goal in Changes Requested state

**Pre-condition:** Mentor sent a goal back (see TC-MENT-003 below). The goal status is now **Changes Requested** and `manager_feedback` is filled.
**Login as:** Staff
**Steps:**
1. Open My Goals.
2. Find the goal whose status is Changes Requested.

**Expected:**
- Status badge is amber/red **Changes Requested**.
- Edit button is enabled again.
- The mentor's feedback (`manager_feedback`) is visible — either inline in the card or in an expanded view.

**UI checks:**
- Feedback is in a tinted box (amber/red 50) with a message icon.
- Feedback text wraps; does not overflow the card.

---

### TC-GOAL-010 — Resubmit after changes

**Login as:** Staff
**Steps:**
1. On a Changes Requested goal, click Edit.
2. Change the title or description per the mentor's feedback.
3. Save → status returns to Draft.
4. Click Request Approval → status moves to Pending Approval again.

**Expected:** Goal can cycle through draft → pending again. The mentor's previous feedback is preserved (visible until a fresh feedback is given, or replaced when re-reviewed).

---

### TC-GOAL-011 — Approved goal shows criteria checklist

**Login as:** Staff
**Steps:**
1. Find an Approved goal.
2. Expand it (click the card or the table row).

**Expected:**
- Status badge reads **Approved** (green).
- All criteria are listed.
- Each criterion has a checkbox to toggle `is_completed`.
- Progress percent recomputes when you check/uncheck a criterion.

**UI checks:**
- Checkbox is properly aligned with criterion text.
- Progress bar updates smoothly without flicker.
- Completed criteria are visually distinct (struck-through or muted).

---

### TC-GOAL-012 — Attachment link opens in a new tab

**Login as:** Staff
**Steps:**
1. On a goal with an `attachment_url`, click the **Attachment** link.

**Expected:**
- Opens in a new browser tab (`target="_blank"`).
- Original app tab is preserved.

---

### TC-GOAL-013 — Year / cycle filter

**Pre-condition:** You have goals across multiple cycles (e.g. FY25 and FY26).
**Login as:** Staff
**Steps:**
1. Use the **Cycle** / **Year** dropdown filter.
2. Select a specific cycle name (e.g. "FY26").

**Expected:** Only goals matching that cycle are shown.

**Then:** Select "All" → table resets.

**UI checks:** Dropdown options display the human-readable cycle name (e.g. "H1 FY26" not raw "h1_fy26").

---

### TC-GOAL-014 — Approval Status filter

**Login as:** Staff
**Steps:**
1. Use the **Status** dropdown.
2. Try each option in turn: Draft, Pending Approval, Changes Requested, Approved, H1 Self-Reviewed, H1 Mentor-Reviewed, H2 Self-Reviewed, H2 Mentor-Reviewed.
3. (For quarterly orgs, also Q1–Q4 variants are present.)

**Expected:**
- Each filter narrows the list correctly.
- "All" resets.

---

### TC-GOAL-015 — Search

**Login as:** Staff with several goals
**Steps:**
1. Type part of a goal title in the search box.

**Expected:** Live filter — only matching goals remain.

---

### TC-GOAL-016 — Toggle Card / Table view

**Login as:** Staff
**Steps:**
1. Switch to **Cards** view.
2. Switch to **Table** view.

**Expected:**
- Both views show the same goals after filtering.

**UI checks:**
- Card view: cards are equal height in the same row; layout uses a 3-column grid on wide screens, 2 on medium, 1 on narrow.
- Table view: columns are clearly labeled; sortable headers are clickable.

---

### TC-GOAL-017 — Sort columns (table view)

**Login as:** Staff
**Steps:**
1. Click the **Goal** column header → rows sort alphabetically.
2. Click again → reverse order.
3. Click **Status** → alphabetical by status.

**Expected:** Sort indicator (arrow) appears only on the active column.

---

### TC-GOAL-018 — Expand a goal row (table view)

**Login as:** Staff
**Steps:**
1. Click on a goal row.

**Expected:**
- Row expands to show description, attachment link, mentor feedback (if any), and criteria checklist.
- The chevron icon rotates 180° smoothly.

**UI checks:**
- Expanded content is indented under the row, not breaking column alignment of OTHER rows.

---

### TC-GOAL-019 — Self-Review cycle menu appears on approved goals

**Pre-condition:** A goal is in **Approved** state.
**Login as:** Staff
**Steps:**
1. Look at the action area of the approved goal.

**Expected:**
- A **Self-Review cycle menu** (dropdown) is visible.
- For a `half_yearly` org → options are H1 and (if applicable) H2.
- For a `quarterly` org → options are Q1–Q4.
- For an `annual` org → a single "Annual Self-Review" action.
- Options that are not yet open (e.g. H2 before October) appear disabled or hidden.

**UI checks:**
- Menu options are clearly labeled with the cycle AND year (e.g. "H1 FY26").

---

## 2.2 Team Goals tab (Mentor)

> **Login pre-condition:** You are a Staff whose user record is the `mentor_id` of at least one other Staff (`has_mentees = true`).

### TC-MENT-001 — Open Team Goals tab

**Login as:** Mentor
**Steps:**
1. Open Annual Goals.
2. Click the **Team Goals** tab (or default tab if you have no own goals).

**Expected:**
- A table or grid of mentees' goals is shown.
- Each row includes: mentee name (full_name), goal title, cycle, status.

**UI checks:**
- Mentee name column is in the same column position as **Goal** in the Staff view — alignment is consistent across roles.
- Filter row matches the same pattern as My Goals.

---

### TC-MENT-002 — Approve a pending goal

**Login as:** Mentor
**Steps:**
1. Find a goal with status **Pending Approval**.
2. Click the action button → **Approve** (or open the goal card → Approve).
3. Confirm in the dialog.

**Expected:**
- Status updates to **Approved**.
- `approved_at` timestamp is recorded on the goal (visible in expanded view or details).
- Success toast.
- The mentee receives a notification.

---

### TC-MENT-003 — Request changes with feedback

**Login as:** Mentor
**Steps:**
1. Find a Pending Approval goal.
2. Click **Request Changes**.
3. A feedback modal opens.
4. Type a clear message (e.g. "Please add a deadline to criterion #2.").
5. Click Submit.

**Expected:**
- Status updates to **Changes Requested**.
- `manager_feedback` field stores your message.
- Mentee sees this feedback when they next open the goal (TC-GOAL-009).

**UI checks:**
- Feedback textarea is comfortably sized (multiple lines, resizable or generous).
- Submit button is disabled until you've typed some feedback (no empty rejections).

---

### TC-MENT-004 — Bulk approve

**Pre-condition:** Multiple goals are in Pending Approval.
**Login as:** Mentor
**Steps:**
1. Select 2–3 goals via checkboxes in the table.
2. Click **Bulk Approve** → the **BulkApproveModal** opens with a summary.
3. Confirm.

**Expected:**
- All selected goals move to Approved.
- A summary toast or modal notes how many succeeded and how many failed.
- If any failed (e.g. status changed concurrently), the modal lists each failure with a reason.

**UI checks:**
- Bulk Approve button is hidden until at least one row is selected.
- Button is on the right side of the toolbar; doesn't shift layout when it appears.

---

### TC-MENT-005 — Mentor review for H1 (or current half)

**Pre-condition:** A mentee has submitted their H1 self-review on an approved goal (status = `h1_self_reviewed`).
**Login as:** Mentor
**Steps:**
1. Find the goal in Team Goals.
2. Open the goal; locate the Mentor Review action for H1.
3. Click **Write Mentor Review** for H1 → the **GoalMentorReviewModal** opens.
4. Read the mentee's H1 self-review (read-only above your textarea).
5. Type your review.
6. Click **Save Draft** → confirm a draft saved (toast: "Draft saved").
7. Reopen the same goal → draft is preserved.
8. Edit the draft → click **Submit**.

**Expected:**
- Status moves to **H1 Mentor-Reviewed**.
- Mentee sees the mentor review next time they open the goal.
- The mentee receives a notification.

**UI checks:**
- Modal shows mentee's self-review (read-only) above your textarea — visually distinct sections.
- Save Draft and Submit buttons are clearly separated.

---

### TC-MENT-006 — Cannot mentor-review before mentee submits self-review

**Login as:** Mentor
**Steps:**
1. Find a goal that's Approved but the mentee has NOT submitted H1 self-review yet.
2. Look at the mentor-review action area for H1.

**Expected:**
- Mentor cannot start the H1 mentor review (button disabled or hidden, with a note "Awaiting mentee's self-review").

---

### TC-MENT-007 — Search & filter on Team Goals

**Login as:** Mentor with multiple mentees
**Steps:**
1. Use the search box to type a mentee's name → table filters.
2. Combine with a Status filter → AND logic applies.

---

### TC-MENT-008 — Bulk approve handles partial failures gracefully

**Pre-condition:** Among the goals you select, one was just approved by someone else in another browser.
**Login as:** Mentor
**Steps:**
1. Select 3 goals (one stale).
2. Click Bulk Approve.

**Expected:**
- The 2 fresh goals approve; the stale one returns an error.
- Result modal lists the failed item and reason; the page does NOT crash.

---

## 2.3 Goal Self-Review

### TC-SELFREV-001 — Open Self-Review modal (current cycle)

**Pre-condition:** A goal is **Approved**; the current cycle (from System Settings) is H1.
**Login as:** Staff
**Steps:**
1. On the approved goal, click the self-review menu → choose **H1**.
2. The **GoalSelfReviewModal** opens.

**Expected:**
- Modal title reads "Self-Review · H1 FY26" (or current cycle).
- Form contains:
  - A **self_review_notes** textarea (freeform reflection).
  - A **progress_notes** textarea (optional — what you've delivered against criteria).

**UI checks:**
- Each textarea is at least 4–6 rows tall.
- Modal width is comfortable (around max-w-xl).
- Save Draft and Submit buttons at the bottom-right.

---

### TC-SELFREV-002 — Save Draft

**Login as:** Staff
**Steps:**
1. Type a partial reflection.
2. Click **Save Draft**.

**Expected:**
- Success toast: "Draft saved."
- Modal stays open (or closes gracefully — verify with product).
- Goal status does NOT change yet.
- Reopening the modal loads your draft content.

---

### TC-SELFREV-003 — Submit Self-Review

**Login as:** Staff
**Steps:**
1. With draft text in place, click **Submit**.
2. Confirm in the dialog.

**Expected:**
- Modal closes.
- Goal status updates to **H1 Self-Reviewed** (`h1_self_reviewed`).
- Success toast.
- The self-review is now locked — opening it again shows it read-only.
- The mentor is notified.

---

### TC-SELFREV-004 — Re-opening a submitted self-review

**Login as:** Staff
**Steps:**
1. Re-open the H1 self-review from the goal.

**Expected:**
- Textareas are read-only.
- Save Draft / Submit are hidden or disabled.
- A note says "Submitted on <date>".

---

### TC-SELFREV-005 — H2 not available until H2 window opens

**Pre-condition:** Currently inside the H1 cycle (configured `active_cycle_name = H1 FY26`, `cycle_end_date` is in the future).
**Login as:** Staff
**Steps:**
1. Look at the self-review menu options on an approved goal.

**Expected:**
- H1 is enabled.
- H2 is hidden or shows "Available after Oct 1" (or similar greyed state).

---

### TC-SELFREV-006 — Quarterly cycle shows Q1–Q4 options

**Pre-condition:** Admin sets `cycle_type = quarterly`, `active_cycle_name = Q2 FY26`.
**Login as:** Staff
**Steps:**
1. Open an Approved goal; look at the self-review menu.

**Expected:**
- Q1 (if already passed) and Q2 (current) are visible options.
- Q3 / Q4 (future) are disabled or hidden.

---

## 2.4 Goal Mentor-Review (additional flows)

### TC-MENTREV-001 — Mentor reads mentee's self-review side-by-side

**Pre-condition:** Mentee has submitted an H1 self-review.
**Login as:** Mentor
**Steps:**
1. Open the goal in Team Goals.
2. Open the mentor-review modal for H1.

**Expected:**
- The mentee's self-review and `progress_notes` are visible read-only.
- Your editable textarea (`mentor_review_notes`) sits below.

---

### TC-MENTREV-002 — Mentor cannot re-edit after submit

**Login as:** Mentor (after submitting H1 mentor review)
**Steps:**
1. Reopen the goal.

**Expected:**
- The mentor review is now read-only.
- Save Draft / Submit are hidden.

---

### TC-MENTREV-003 — Mentor draft is preserved across sessions

**Login as:** Mentor
**Steps:**
1. Open a goal pending mentor review.
2. Type a partial review; click Save Draft.
3. Logout, log back in, reopen the goal.

**Expected:**
- The draft text is still in the textarea.
- "Draft" indicator is visible in the modal header bar.

---

## 2.5 Annual Goals — Cross-checks

- Refer to **Module 1 §1.6** UI checklist for every screen in this module.
- All success operations show a green toast; all failures show a red toast.
- After every state change (submit, approve, reject, save-draft), refresh the page and confirm the change persisted in the database.
- Test in three browser widths: narrow / medium / wide.
- When `annual_goals_edit_enabled` flips from ON to OFF mid-session, the Staff's Add Goal button should disappear on next page load. Submitting an in-progress draft after the gate closes should be rejected by the API with a clear error.

---

**End of Module 2.** Next: Module 3 — Annual Reviews.
