# QA Test Cases — Module 4: Project Reviews

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Module 1 reviewed. Apply Module 1 §1.6 UI checklist on every screen.
> **Test accounts needed:**
> - **PM** — a Staff who is the `reports_to_id` (primary reviewer) of at least one active project. They evaluate the team on that project.
> - **Secondary Evaluator** — a Staff who is the `secondary_evaluator_id` on at least one active project. They submit a peer/cross-check impact statement.
> - **Reviewed Staff** — a Staff who is assigned to a project via `ProjectAssignment` (the person being reviewed).
> - **Mentor of a Staff on a project** — to validate cross-visibility through MenteeDetail.
> - **Admin (`is_management = true`)** — to view org-wide project reviews via Admin Panel → Reviews tab + Exports.
>
> **Vocab — Project Review Status (`ProjectReviewStatus`):** `pending` → `draft` → `reviewed`. (There is no separate "self-review" stage — the Reviewed Staff does not write a self-review here.)
> **Vocab — Evaluator Status (`EvaluatorStatus`, for Secondary):** `draft` → `submitted`. The PM's review and each Secondary's input are tracked separately.
> **Vocab — Performance Group (1–5 scale, stored as string):** "1" (best) … "5" (worst). Visible on review cards / table only when `project_ratings_visible = true`.
> **Vocab — 7 Competencies (PM evaluates each):** Task Execution, Ownership, Project Management, Client Deliverables, Communication, Mentoring, Competency & Skills.

---

## 4.1 My Reviews tab (Staff being reviewed)

### TC-PR-MY-001 — Open My Reviews

**Login as:** any Staff who has at least one assigned project
**Steps:**
1. Open **Project Reviews** from the sidebar.
2. Default tab should be **My Reviews**.

**Expected:**
- Page header reads "Project Reviews" with active cycle in muted text.
- A grid or table lists each project review tied to this Staff (one per project per cycle).
- Each row shows: Project name + project_code, Cycle, PM name, Status.

**UI checks:**
- Project code is monospace and visually distinct from name.
- Status badge color matches the conventions used elsewhere (Pending = amber, Draft = amber-filled, Reviewed = green).

---

### TC-PR-MY-002 — View a Reviewed row's content (with PM evaluation)

**Pre-condition:** A project review where the PM has already submitted (`status = reviewed`).
**Login as:** Reviewed Staff
**Steps:**
1. On a Reviewed row, click **View** (or expand the row via the chevron).

**Expected:**
- A read-only panel / modal opens.
- Sections shown:
  - **Project info** — name, code, cycle, PM name.
  - **Performance Group** — shown as a 1–5 badge IF `project_ratings_visible = true`; otherwise the badge reads **"Hidden"** with a lock icon.
  - **7 Competency comments** — one card per competency (Task Execution, Ownership, etc.) with the PM's comment text.
  - **PM Impact Statement** — a blue-tinted block with `impact_statement` text (if non-empty).
  - **Secondary Impact Statements** — green-tinted blocks, one per submitted secondary evaluator (if any).

**UI checks:**
- Modal width is comfortable (large — around max-w-5xl per the design).
- Two-column grid for competency cards on wide screens; collapses to 1 column on narrow.
- Text wraps cleanly inside each block; no overflow.

---

### TC-PR-MY-003 — Pending project review (PM has not submitted)

**Login as:** Reviewed Staff
**Steps:**
1. Find a row with status **Pending** (PM hasn't started or submitted yet).

**Expected:**
- Action area shows "Awaiting PM" or a similar muted message — NO View button.
- Status badge is amber.

---

### TC-PR-MY-004 — Filters and search

**Login as:** Reviewed Staff with multiple projects
**Steps:**
1. Use Project filter (combobox) + Cycle + Status filters.
2. Search by project name or code.

**Expected:** AND logic; row count caption updates.

**UI checks:**
- Combobox is typeable with live suggestions.

---

### TC-PR-MY-005 — `project_ratings_visible` toggles the rating badge

**Pre-condition:** Reviewed Staff has at least one Reviewed project review with `performance_group` set.
**Steps:**
1. Admin sets `project_ratings_visible = false`.
2. Login as Reviewed Staff → open the Reviewed row.

**Expected:**
- Performance Group badge reads **"Hidden"** with a lock icon.

**Then:** Admin toggles back to true → refresh → badge reappears.

---

## 4.2 Evaluate Team tab (PM)

> **Login pre-condition:** You are the `reports_to_id` of an active project that has at least one `ProjectAssignment` (i.e. team members to evaluate). When a project review cycle is opened (manually or by automation), one `ProjectReview` row is created per team member per cycle with `status = pending`.

### TC-PMR-001 — Open Evaluate Team queue

**Login as:** PM
**Steps:**
1. Open **Project Reviews** → **Evaluate Team** tab (or the equivalent — "PM Evaluation").

**Expected:**
- A list of pending project reviews assigned to this PM.
- Each row shows: Employee · Project (name + code) · Cycle · Status.

**UI checks:**
- Status badge color matches Pending elsewhere (amber).

---

### TC-PMR-002 — Open a pending review (write evaluation)

**Login as:** PM
**Steps:**
1. Click on a pending row OR click **Write Review** action → the **EvalModal** (or expanded row panel) opens.

**Expected:**
- Form sections (matching the `ProjectReview` model):
  - **7 Competency comment fields** — Task Execution, Ownership, Project Management, Client Deliverables, Communication, Mentoring, Competency & Skills. Each is a multi-line textarea.
  - **Performance Group selector** — 1–5 pick (string values "1"…"5"). A hint reads "Lower is better (1 = best)".
  - **Impact Statement** textarea.
  - (Optional) **Role Expectation panel** — collapsible reference text drawn from `RoleExpectation` matching the reviewed Staff's department × designation. Useful as a benchmark.

**UI checks:**
- Each competency card has a clear label.
- Performance Group selector is clearly a 1–5 pick (radio buttons, pill group, or PerformanceRatingSelect).
- Role expectation panel toggles open/closed cleanly.

---

### TC-PMR-003 — Save Draft on PM review

**Login as:** PM
**Steps:**
1. Fill in 2–3 competency fields.
2. Click **Save Draft**.

**Expected:**
- Toast: "Draft saved."
- Status badge on the row changes to **Draft** (amber-filled).
- Action button now reads **Continue Draft**.
- Reopening the row pre-fills your draft content.

---

### TC-PMR-004 — Continue Draft

**Login as:** PM
**Steps:**
1. Click **Continue Draft** on a draft row.

**Expected:** Existing content reloads. You can edit and save or submit.

---

### TC-PMR-005 — Submit a PM review

**Login as:** PM
**Steps:**
1. Complete required competencies + Performance Group.
2. Click **Submit** → confirm.

**Expected:**
- Status moves to **Reviewed** (green).
- Row's action changes to **Edit** (or **View**).
- Toast: "Review submitted."
- The Reviewed Staff receives a notification.
- The Mentor of the Reviewed Staff can now see the PM evaluation under Team Reviews / MenteeDetail.

---

### TC-PMR-006 — Cannot submit without Performance Group

**Login as:** PM
**Steps:**
1. Fill competency fields and Impact Statement but DO NOT pick a Performance Group.
2. Click Submit.

**Expected:** Validation error: "Please select a performance group." Form stays open.

---

### TC-PMR-007 — Cannot submit with no competency comments

**Login as:** PM
**Steps:**
1. Pick a Performance Group but leave all 7 competency fields blank.
2. Click Submit.

**Expected:** Validation error: at least one competency comment is required (or each is required — verify with product). Form stays open.

---

### TC-PMR-008 — Edit a submitted review

**Login as:** PM
**Steps:**
1. Open a Reviewed row → click **Edit**.

**Expected:**
- Form opens pre-filled with the submitted content.
- An "Editing" badge or similar indicator is visible.
- Save Changes / Cancel buttons at the bottom.
- After save, status remains Reviewed.

---

### TC-PMR-009 — Filters & search

**Login as:** PM
**Steps:**
1. Use Employee combobox + Project combobox + Cycle + Status filters.

**Expected:** AND logic; row count caption updates.

**UI checks:** Both comboboxes are typeable with live suggestions.

---

### TC-PMR-010 — View mode toggle (Cards / Table)

**Login as:** PM
**Steps:**
1. Switch to Cards view → grid of cards.
2. Switch to Table view → table.

**Expected:** Both views render the same dataset.

**UI checks:**
- Cards equal height in the same row.
- Table column widths consistent.

---

### TC-PMR-011 — PM cannot evaluate themselves

**Pre-condition:** PM is assigned to their own project as a team member (edge case).
**Login as:** PM
**Steps:**
1. Open Evaluate Team.

**Expected:** PM does NOT see a project review row for themselves. The system filters out `user_id == reviewer_id`.

---

## 4.3 Secondary Evaluation tab

> **Login pre-condition:** You are the `secondary_evaluator_id` on at least one project. Secondary reviews are tracked as `ProjectReviewEvaluator` rows with `evaluator_type = "Secondary"` and their own `EvaluatorStatus` (draft / submitted).

### TC-SEC-001 — Open Secondary Evaluation tab

**Login as:** Secondary Evaluator
**Steps:**
1. Open Project Reviews → **Secondary Evaluation** tab.

**Expected:**
- A list of reviews where you're the secondary.
- Each row shows: Employee · Project (name + code) · Cycle · Status.
- Three possible statuses: **Pending**, **Draft**, **Submitted**.

**UI checks:**
- Pending badge: amber.
- Draft badge: amber-filled.
- Submitted badge: green.

---

### TC-SEC-002 — Filters

**Login as:** Secondary Evaluator
**Steps:**
1. Use each filter (Employee / Project / Cycle / Status); verify AND logic.
2. Confirm **Draft** is one of the options in the Status filter.

**Expected:** Filter narrows; "All" resets each.

---

### TC-SEC-003 — Write a new secondary review

**Login as:** Secondary Evaluator
**Steps:**
1. On a Pending row, click **Write Review** → the **ImpactModal** opens.

**Expected:**
- Modal title is "Secondary Feedback" (or similar).
- Subtitle explains "Write your perspective on the staff's contribution to this project."
- A single textarea labeled **Impact Statement** / **Review**.
- Save Draft and Submit buttons at the bottom.

**UI checks:**
- Modal width is around max-w-2xl (comfortable).
- Textarea is at least 6–8 rows tall.

---

### TC-SEC-004 — Save Draft as Secondary

**Login as:** Secondary Evaluator
**Steps:**
1. Type a partial review.
2. Click **Save Draft**.

**Expected:**
- Toast: "Draft saved."
- Modal closes (or stays open with a Draft indicator).
- Row status changes to **Draft** in both card and table views.
- Action button on that row now reads **Continue Draft** (amber-styled).

**UI checks:**
- Draft card has amber tint background; clear distinction from Pending and Submitted cards.
- Draft preview text on the card is line-clamped to about 3 lines.

---

### TC-SEC-005 — Continue Draft

**Login as:** Secondary Evaluator
**Steps:**
1. Click **Continue Draft**.

**Expected:** Existing draft text reloads. Save Draft button is still available; Submit button is enabled.

---

### TC-SEC-006 — Submit Secondary Review

**Login as:** Secondary Evaluator
**Steps:**
1. With draft content (or fresh content), click **Submit**.

**Expected:**
- Modal closes.
- Row swaps to **Submitted** (green badge) in both views.
- Action becomes **Edit**.
- Toast: "Review submitted."
- The secondary impact statement is now visible on the Reviewed Staff's view of the project review (TC-PR-MY-002).

---

### TC-SEC-007 — Edit a Submitted review

**Login as:** Secondary Evaluator
**Steps:**
1. On a Submitted row, click **Edit**.

**Expected:**
- Modal opens with an "Editing" badge.
- Save Draft button is hidden (because the review is already submitted; further saves are direct).
- Submit button reads **Save Changes**.

---

### TC-SEC-008 — Cannot submit empty review

**Login as:** Secondary Evaluator
**Steps:**
1. Open a Pending row.
2. Leave the textarea empty.
3. Click Submit.

**Expected:** Submit button is disabled until the textarea has non-whitespace content (or, if not disabled, server returns 422 / validation error).

---

### TC-SEC-009 — Card view three-way rendering

**Login as:** Secondary Evaluator
**Steps:**
1. Switch to Cards view.
2. Compare cards for Pending vs Draft vs Submitted reviews.

**Expected:**
- Pending: amber "Pending" badge; **Write Review** button.
- Draft: amber-filled "Draft" badge; **Continue Draft** button; draft preview (line-clamped).
- Submitted: green "Submitted" badge; **Edit** button; submitted review preview (line-clamped).

**UI checks:**
- All three card variants use the same width and minimum height.
- Background tint differs subtly so the state is recognisable at a glance.

---

### TC-SEC-010 — Table view three-way rendering

**Login as:** Secondary Evaluator
**Steps:**
1. Switch to Table view.

**Expected:**
- Status column shows three distinct badges (Pending, Draft, Submitted).
- Action column shows three distinct buttons (Write Review, Continue Draft, Edit).

---

### TC-SEC-011 — Secondary cannot evaluate themselves

**Pre-condition:** Attempt to assign a Staff as the secondary evaluator on a project where they're also a team member.
**Expected:**
- The system should reject this combination (UI validation at project edit time AND/OR server-side validation).
- If it does happen by accident, the Reviewed Staff should NOT see their own secondary row in the Secondary Evaluation tab.

---

## 4.4 Admin Panel → Reviews tab (Admin / Management)

### TC-ALLPR-001 — Open Reviews tab in Admin Panel

**Login as:** Admin (`is_management = true`)
**Steps:**
1. Open Admin Panel → **Reviews** tab.

**Expected:**
- A consolidated org-wide table or section of project reviews.
- Filters by Project / Cycle / Status / Department.

**UI checks:** Filter row layout matches other Admin Panel tabs.

---

### TC-ALLPR-002 — View any row from Reviews tab

**Login as:** Admin
**Steps:**
1. Click on any Reviewed row.

**Expected:** Read-only detail panel/modal — same content as the Reviewed Staff's view (TC-PR-MY-002), with the rating always visible to management regardless of `project_ratings_visible`.

---

### TC-ALLPR-003 — Plain Admin (`is_management = false`) view

**Login as:** Admin without management flag
**Steps:**
1. Open Admin Panel → check if Reviews tab is present.

**Expected:**
- Verify the expected behavior with product — Reviews tab may be:
  - **Visible** (any admin can view reviews) but with the rating hidden if `project_ratings_visible = false`, OR
  - **Hidden** entirely.
- Whichever it is, it must be consistent (no broken UI, no 500s).

---

## 4.5 Edge cases

### TC-PR-EDGE-001 — User who is both PM and Mentor

**Pre-condition:** A user is `reports_to_id` of Project A AND the `mentor_id` of Staff Z, who happens to be on Project A.
**Login as:** that user
**Steps:**
1. Open Project Reviews → confirm Evaluate Team shows the row for Staff Z.
2. Open My Mentees → confirm Staff Z appears there too.

**Expected:**
- Both surfaces show Staff Z correctly.
- The user's PM evaluation of Staff Z and their mentor role are independent and do not collide.

---

### TC-PR-EDGE-002 — Project with no `reports_to_id` (orphaned PM)

**Pre-condition:** A project's `reports_to_id` is NULL.
**Expected:**
- The system should NOT auto-generate project reviews for that project (or it shows a clear admin warning in the Projects tab).
- No phantom rows appear in anyone's Evaluate Team queue.

---

### TC-PR-EDGE-003 — Project completed mid-cycle

**Pre-condition:** A project's `status = completed` and `completed_at` is set.
**Login as:** PM
**Steps:**
1. Look at Evaluate Team.

**Expected:**
- Project reviews for that project are still visible (so the PM can finish writing reviews for the period).
- New project reviews are NOT generated after `completed_at`.

---

### TC-PR-EDGE-004 — Soft-deleted Project Review

**Pre-condition:** A project review has `is_deleted = true`.
**Expected:**
- The review does not appear in any tab (My Reviews, Evaluate Team, Secondary Evaluation, Admin → Reviews).
- It does not appear in Excel exports.

---

## 4.6 Cross-checks

- Refer to **Module 1 §1.6** UI checklist on every screen.
- Confirm consistent labeling: "Performance Group" everywhere (not mixed with "Rating" or "Score").
- Modal sizes: PM eval (large), Secondary eval (max-w-2xl), Reviewed-row detail (max-w-5xl).
- Drafts persist between sessions; refreshing the page does NOT lose draft content.
- Notifications fire on key transitions (PM submit → Reviewed Staff; Secondary submit → optional notification).
- Role Expectation panel shows the correct expectations for the **reviewed Staff's** department × designation (not the PM's).
- Tests in three browser widths: narrow / medium / wide.

---

**End of Module 4.** Next: Module 5 — 360 Feedback.
