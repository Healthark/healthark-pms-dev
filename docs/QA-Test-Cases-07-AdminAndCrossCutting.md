# QA Test Cases — Module 7: Dashboard, Admin Panel, Exports & Cross-Cutting UX

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Modules 1–6 reviewed.
> **Goal:** Cover the Dashboard widgets, the Admin Panel tabs (Users, Projects, Reviews, Management Review, Exports, Settings), Excel exports, the export audit log, and cross-cutting UX / regression checks that span the whole app.
> **Test accounts needed:** Admin (`is_management = true`), Admin (`is_management = false`), Staff, Mentor, PM — to verify role-gated surfaces.

---

## 7.1 Dashboard (all roles)

### TC-DASH-001 — Open the Dashboard

**Login as:** any role
**Steps:**
1. After login, you should land on **Dashboard** (or click Dashboard in the sidebar).

**Expected:**
- Page header reads "Dashboard" with the active cycle name in muted text.
- Widget cards appear, role-appropriate:
  - **Active Cycle widget** — banner showing `active_cycle_name`, `cycle_type`, and any open submission window (start/end dates).
  - **Action Items widget** — list of pending tasks for *you* (e.g. "Submit your H1 self-review on Goal X", "Approve mentee's goal", "Write PM evaluation on Project Y").
  - **My Annual Review widget** — current FY review status + CTA.
  - **My Goals widget** — counts: Draft, Pending, Approved.
  - **My Mentees widget** — appears only if `has_mentees = true`; shows mentee count + total pending actions across mentees + link to /my-mentees.
  - **Pending Mentor Work widget** — appears only if `has_mentees = true`; lists pending goal approvals + pending mentor evaluations + pending project reviews if user is also a PM.

**UI checks:**
- Widget grid is responsive: 3 cols on wide, 2 on medium, 1 on narrow.
- All widgets have the same border style, padding, and corner radius.
- Widget titles are consistently styled and aligned.

---

### TC-DASH-002 — Active Cycle widget

**Login as:** any role
**Steps:**
1. Inspect the Active Cycle widget.

**Expected:**
- Shows: `active_cycle_name` (e.g. "H1 FY26"), `cycle_type` label (e.g. "Half-Yearly"), and submission status (Open / Closed).
- If `goals_submission_open` is true OR `annual_goals_edit_enabled` is true, the banner reflects "Goal submissions open".
- If `annual_reviews_enabled` is true, "Annual reviews open" is shown.

---

### TC-DASH-003 — Action Items widget — clicking a task navigates

**Login as:** Staff with at least one action item
**Steps:**
1. Click one of the action items (e.g. "Submit your H1 self-review on Goal X").

**Expected:**
- You're navigated to the corresponding page with that entity in focus (e.g. Annual Goals → the goal's row expanded with the self-review modal opening).

---

### TC-DASH-004 — Empty Action Items

**Login as:** a user with nothing pending
**Steps:**
1. Inspect the Action Items widget.

**Expected:** A friendly empty state — "You're all caught up." No errors.

---

### TC-DASH-005 — My Mentees widget hidden when user has no mentees

**Login as:** Staff with `has_mentees = false`
**Steps:**
1. Inspect the Dashboard.

**Expected:** The "My Mentees" widget and the "Pending Mentor Work" widget are NOT rendered.

---

### TC-DASH-006 — Pending Mentor Work widget shows live counts

**Login as:** Mentor with mentees in various pending states
**Steps:**
1. Inspect the Pending Mentor Work widget.

**Expected:**
- Three or four sub-counts: Goals awaiting approval · Annual reviews to evaluate · Project evaluations to write (if PM).
- Click a sub-count → navigates to the corresponding tab with appropriate filter.

---

### TC-DASH-007 — Dashboard loading skeleton

**Login as:** any role (use DevTools → Network throttling)
**Steps:**
1. Open Dashboard with slow network.

**Expected:**
- Skeleton cards render until data arrives.
- No layout shift when widgets fill in.

---

### TC-DASH-008 — Dashboard error fallback

**Login as:** any role (use DevTools → Network → block `/api/v1/dashboard`)
**Steps:**
1. Open Dashboard.

**Expected:**
- A clear error toast or in-widget error message: "Couldn't load dashboard. Please retry."
- The page does NOT crash to a blank screen.

---

## 7.2 Admin Panel — Users tab

### TC-ADMIN-USR-001 — Open Users tab

**Login as:** Admin
**Steps:**
1. Open Admin Panel → **Users** tab (often the default).

**Expected:**
- A table of users loads.
- Columns include at least: Name, Employee Code, Email, Phone, Role, Department, Designation, Mentor, is_management, Status (Active / Deleted).

**UI checks:**
- Column widths are reasonable — no column squashed so narrow it shows "…" everywhere, none so wide it leaves empty space.
- Row heights are consistent.

---

### TC-ADMIN-USR-002 — Search and filter

**Login as:** Admin
**Steps:**
1. Type part of a name or employee code in the search box.

**Expected:** Live filter — only matching rows remain.

**Then:**
2. Filter by Department / Designation / Role.

**Expected:** Each filter narrows the table; combining is AND logic. Clear all → table resets.

---

### TC-ADMIN-USR-003 — Create a new user

**Login as:** Admin
**Steps:**
1. Click **Add User** (or **Create**) → the **UserModal** opens.
2. Fill in:
   - Full Name (required)
   - Email (required)
   - Phone
   - Employee Code (required)
   - Role (Admin / Staff)
   - is_management (checkbox — only enabled when Role = Admin)
   - Department
   - Designation
   - Mentor (combobox)
3. Click **Save**.

**Expected:**
- Toast: "User created."
- New row appears in the table.
- The user's `must_change_password` flag is true initially (verify by logging in as the new user — they're sent to /change-password).

**UI checks:**
- Required fields have a clear asterisk.
- Mentor combobox is typeable with suggestions.
- is_management checkbox is disabled when Role = Staff.

---

### TC-ADMIN-USR-004 — Duplicate email is rejected

**Login as:** Admin
**Steps:**
1. Open Add User.
2. Use an email that already exists.

**Expected:** Inline error or toast: "A user with this email already exists." Form stays open; you can correct the field.

---

### TC-ADMIN-USR-005 — Edit a user

**Login as:** Admin
**Steps:**
1. Click an existing user's row → the **UserModal** opens in edit mode.
2. Change their Department; reassign Mentor; toggle is_management.
3. Save.

**Expected:**
- Toast: "User updated."
- Row reflects new values immediately.
- If you changed Role / is_management, the affected user's session re-reads on next page load (e.g. sidebar updates for them next time they log in or refresh).

---

### TC-ADMIN-USR-006 — Assign / change Mentor

**Login as:** Admin
**Steps:**
1. Edit a Staff who has no mentor; pick a Mentor from the combobox.
2. Save.

**Expected:**
- That Staff's Mentor column updates immediately.
- The picked Mentor's `has_mentees` flag becomes true (verify by logging in as them — My Mentees appears in sidebar).

---

### TC-ADMIN-USR-007 — Triggered Reset Password

**Login as:** Admin
**Steps:**
1. On a user row, click **Reset Password** (or kebab menu → Reset Password).
2. Confirm.

**Expected:**
- Toast: "Password reset link sent to <email>."
- A `PasswordResetToken` row is created with the user as `user_id`, the Admin as `requested_by_id`, and a 15-min expiry.
- The user's `must_change_password` flag is set to true (per the admin-reset flow).
- The user receives an email with a one-time link.
- Next time the user logs in (with old password or via the link), they are forced to `/change-password`.

---

### TC-ADMIN-USR-008 — Soft-delete a user

**Login as:** Admin
**Steps:**
1. On a user row, click **Delete** (or kebab → Delete).
2. A confirmation dialog appears: "Delete <name>? This action soft-deletes the user." — confirm.

**Expected:**
- The user's `is_deleted` flag is set to true.
- The row either disappears from the default view or moves to a "Deleted" filter.
- The deleted user cannot log in (TC-AUTH-005).
- The user does NOT appear in any combobox (mentor picker, secondary evaluator picker, etc.).

**UI checks:**
- Confirmation dialog is centered, with a clearly destructive red confirm button.

---

### TC-ADMIN-USR-009 — Cannot soft-delete yourself

**Login as:** Admin
**Steps:**
1. Find your own row.
2. Look at the actions.

**Expected:** Delete button on your own row is disabled or hidden, OR the API rejects the request with a clear error. The system never lets an Admin lock themselves out.

---

### TC-ADMIN-USR-010 — Users table sort

**Login as:** Admin
**Steps:**
1. Click the **Name** column header.

**Expected:** A→Z. Click again → Z→A. Sort indicator on the active column only.

---

## 7.3 Admin Panel — Projects tab

### TC-ADMIN-PROJ-001 — Open Projects tab

**Login as:** Admin
**Steps:**
1. Open Admin Panel → **Projects** tab.

**Expected:**
- A table of projects.
- Columns: Code, Name, Description, Start Date, Expected End, Status (Active / Completed), PM (reports_to), Secondary Evaluator.

---

### TC-ADMIN-PROJ-002 — Create a project

**Login as:** Admin
**Steps:**
1. Click **Add Project** → the **ProjectModal** opens.
2. Fill: Project Code (required, unique), Name, Description, Start Date, Expected End Date, PM (reports_to_id), Secondary Evaluator.
3. Save.

**Expected:**
- Toast: "Project created."
- New row appears.
- Project Code uniqueness is enforced — duplicate returns a clear error.

---

### TC-ADMIN-PROJ-003 — Edit a project

**Login as:** Admin
**Steps:**
1. Click a project row → edit modal opens.
2. Change PM or Secondary Evaluator.
3. Save.

**Expected:**
- The new PM's Project Reviews → Evaluate Team queue refreshes to include this project on next load.
- The old PM no longer sees it.

---

### TC-ADMIN-PROJ-004 — Assign team members to a project

**Login as:** Admin
**Steps:**
1. Open a project → look for an "Assignments" or "Team Members" section.
2. Add Staff X → save.

**Expected:**
- A `ProjectAssignment` row is created.
- When project review cycle opens, Staff X gets a pending project review.

---

### TC-ADMIN-PROJ-005 — Mark project as completed

**Login as:** Admin
**Steps:**
1. On an active project, click "Mark Complete" (or set status = Completed) → confirm.

**Expected:**
- Project's `status = completed` and `completed_at` is set.
- `completed_by_id` records the admin.
- The project no longer accepts new project review generation (TC-PR-EDGE-003).

---

### TC-ADMIN-PROJ-006 — Cannot assign self as both PM and Secondary on the same project

**Login as:** Admin
**Steps:**
1. Create or edit a project. Set PM = User A. Try to set Secondary Evaluator = User A.

**Expected:** Validation error: PM and Secondary cannot be the same person.

---

## 7.4 Admin Panel — Reviews tab

### TC-ADMIN-REV-001 — Open Reviews tab

**Login as:** Admin (`is_management = true`)
**Steps:**
1. Open Admin Panel → **Reviews** tab.

**Expected:**
- Org-wide overview of project reviews and/or annual reviews.
- Filters and table that lets management drill into any record (read-only).

**(Refer to Module 4 §4.4 for project review specifics.)**

---

## 7.5 Admin Panel — Management Review tab

> See Module 3 §3.3 for full coverage of the Management Review (calibration) flow. The tab itself is gated to Admin + `is_management = true`.

### TC-ADMIN-MGT-001 — Management Review tab gating

**Login as:** Admin without is_management
**Steps:**
1. Open Admin Panel → look at the tabs.

**Expected:** Management Review tab is hidden.

**Then login as:** Admin with is_management = true.
**Expected:** Tab appears and loads.

---

## 7.6 Admin Panel — Settings tab

### TC-ADMIN-SET-001 — Open Settings tab

**Login as:** Admin
**Steps:**
1. Open Admin Panel → **Settings** tab.

**Expected:**
- Sections grouped logically (e.g. "Active Cycle", "Goal Settings", "Review Visibility").
- Each setting has a label, current value, and an editor (toggle / input / dropdown).
- A Save button (or auto-save) confirms each change.

---

### TC-ADMIN-SET-002 — Change cycle type

**Login as:** Admin
**Steps:**
1. Change `cycle_type` from `half_yearly` to `quarterly`.
2. Save.

**Expected:**
- Toast: "Settings updated."
- Refresh; the change persists.
- On the Annual Goals page, the self-review menu now shows Q1–Q4 options (not H1/H2).

---

### TC-ADMIN-SET-003 — Set `active_cycle_name`

**Login as:** Admin
**Steps:**
1. Edit `active_cycle_name` to a new value (e.g. "Q2 FY26").
2. Save.

**Expected:**
- The Topbar / Active Cycle widget updates everywhere.
- New goals created use this as their `cycle_name`.

---

### TC-ADMIN-SET-004 — Set fiscal_start_month

**Login as:** Admin
**Steps:**
1. Change `fiscal_start_month` from 4 (April) to 1 (January).
2. Save.

**Expected:**
- The system re-computes the current FY based on the new start month.
- Verify FY labels on goals / reviews still display correctly.

---

### TC-ADMIN-SET-005 — Toggle `annual_goals_edit_enabled`

**Login as:** Admin
**Steps:**
1. Toggle OFF.
2. Save.

**Expected:**
- Toast: "Settings updated."
- After refresh, persist.
- Login as Staff → Annual Goals → Add Goal button is replaced by the "submissions closed" banner (Module 2 TC-GOAL-003).

**Then:** Toggle back ON → Add Goal appears again.

---

### TC-ADMIN-SET-006 — Toggle `annual_reviews_enabled`

**Login as:** Admin
**Steps:**
1. Toggle OFF.

**Expected:**
- Annual Reviews item disappears from the sidebar for all roles.
- Direct URL `/annual-reviews` redirects.

**Then:** Toggle back ON → restored.

---

### TC-ADMIN-SET-007 — Toggle `project_ratings_visible`

**Login as:** Admin
**Steps:**
1. Toggle OFF.

**Expected:**
- Mentor / Reviewed Staff sees Performance Group on Project Reviews as "Hidden" with a lock icon (Module 4 TC-PR-MY-005).
- Admin / Management still sees ratings in Admin Panel views.

**Then:** Toggle back ON → ratings visible again.

---

### TC-ADMIN-SET-008 — Toggle `annual_review_final_rating_visible`

**Login as:** Admin
**Steps:**
1. Toggle OFF.

**Expected:**
- Staff cannot see `final_performance_rating` on past completed reviews — shown as "Hidden".
- Mentor still sees their own mentor_performance_rating (Module 3 TC-AREV-009 / TC-MENT-026).

---

### TC-ADMIN-SET-009 — Settings persistence after refresh

**Login as:** Admin
**Steps:**
1. Toggle several settings.
2. Hard-refresh the page (Ctrl+F5).

**Expected:** All values render with the last-saved state. No defaults overwrite the saved choices.

---

### TC-ADMIN-SET-010 — Settings audit trail

**Login as:** Admin
**Steps:**
1. Toggle a setting.
2. Inspect the database (or an audit display, if exposed) for `updated_by_id` and `updated_at`.

**Expected:** Both fields are populated with the current Admin and current timestamp.

---

## 7.7 Admin Panel — Exports tab

### TC-EXP-001 — Open Exports tab

**Login as:** Admin (gated for export eligibility — HR department or is_management; verify with product)
**Steps:**
1. Open Admin Panel → **Exports** tab.

**Expected:**
- Buttons / cards for each available export:
  - Export Users
  - Export Annual Goals (current cycle and/or all cycles)
  - Export Annual Reviews
  - Export Project Reviews
- (Optional) Filters per export — FY, cycle, department.

---

### TC-EXP-002 — Export Users

**Login as:** Admin (eligible)
**Steps:**
1. Click **Export Users** → confirm any download dialog.

**Expected:**
- An `.xlsx` file downloads.
- File name has a clear pattern with date (e.g. `users-2026-05-13.xlsx`).
- Opens cleanly in Excel / Google Sheets without warnings.
- Columns include at least: Name · Employee Code · Email · Phone · Role · is_management · Department · Designation · Mentor · Status · Date Joined.
- Rows match what the Users tab shows.

---

### TC-EXP-003 — Export Annual Goals

**Login as:** Admin
**Steps:**
1. Click **Export Goals** (apply filters if present, e.g. current FY).

**Expected:**
- Excel with one row per goal (or per goal-criterion pair, depending on the schema).
- Columns include: Employee · Department · Designation · Goal Title · Description · Cycle · Mentor · Approval Status · Self/Mentor review status per cycle half/quarter · Created Date.

---

### TC-EXP-004 — Export Annual Reviews

**Login as:** Admin
**Steps:**
1. Click **Export Annual Reviews**.

**Expected:**
- Excel with one row per `AnnualReview`.
- Columns include: Employee · Department · Designation · FY · Mentor · Status · Self Rating · Mentor Rating · Management Rating · Final Rating.

---

### TC-EXP-005 — Export Project Reviews

**Login as:** Admin
**Steps:**
1. Click **Export Project Reviews**.

**Expected:**
- Excel with one row per project review.
- Columns include: Employee · Project Code · Project Name · Cycle · PM · Performance Group · Each competency comment · Impact Statement · Status.
- Secondary impact statements may be included as additional columns or as a separate sheet — verify.

---

### TC-EXP-006 — Export logs to ExportAuditLog

**Login as:** Admin
**Steps:**
1. Perform any export (e.g. TC-EXP-002).
2. Inspect the `export_audit_log` table (or, if exposed, the Audit Log UI).

**Expected:**
- A new row exists with: `user_id` = Admin, `export_type` = "users" (or similar), `exported_at` = just now, `org_id` correct.

---

### TC-EXP-007 — Non-eligible Admin cannot export

**Pre-condition:** Verify whether export eligibility requires HR department membership or is_management. Test with an Admin who lacks the eligibility (if any).
**Login as:** ineligible Admin
**Steps:**
1. Open Admin Panel → Exports tab.

**Expected:**
- Either the Exports tab is hidden, OR the export buttons are disabled with a clear message, OR the backend rejects with 403.
- Behavior must be consistent across all four exports.

---

### TC-EXP-008 — Staff cannot reach export endpoints

**Login as:** Staff
**Steps:**
1. Manually call `POST /api/v1/exports/goals` from DevTools.

**Expected:** 403 Forbidden.

---

### TC-EXP-009 — Export with no rows

**Pre-condition:** Apply a filter that yields zero results (e.g. an FY in the future).
**Login as:** Admin
**Steps:**
1. Click Export.

**Expected:**
- Either the export button is disabled when zero rows would be returned, OR an Excel file downloads with headers only.
- No crash, no error toast.

---

### TC-EXP-010 — Large export does not lock the UI

**Pre-condition:** Have 500+ rows.
**Login as:** Admin
**Steps:**
1. Click Export.

**Expected:**
- A loading indicator appears.
- The button is disabled during generation (no double-click duplicates).
- The file downloads successfully without timeout.

---

## 7.8 Responsive layout

Run each at three browser widths: **narrow ≈ 600 px** · **medium ≈ 1000 px** · **wide ≈ 1400 px+**.

### TC-RESP-001 — Sidebar on narrow widths

**Login as:** any role
**Steps:**
1. Open the app at narrow width.

**Expected:**
- Sidebar either collapses (you can still click the chevron toggle) or auto-hides.
- Main content uses the full width.
- No horizontal scrollbar at any width.

---

### TC-RESP-002 — Topbar on narrow widths

**Steps:**
1. At narrow width, check the Topbar.

**Expected:** Logo, navigation, bell, avatar all fit. Items abbreviate or hide; nothing overflows.

---

### TC-RESP-003 — Tables on narrow widths

**Steps:**
1. Open Users (Admin Panel) or My Goals (table view) at narrow width.

**Expected:** Either the table converts to cards OR scrolls horizontally with a scrollbar inside the table area, NOT the page.

---

### TC-RESP-004 — Modals on narrow widths

**Steps:**
1. Open any modal (goal form, user form, eval modal) at narrow width.

**Expected:** Modal width adapts; never wider than the viewport. Padding shrinks proportionally. Close X reachable; ESC closes.

---

### TC-RESP-005 — Forms on narrow widths

**Steps:**
1. Open a multi-field form (Add User, Add Goal) at narrow width.

**Expected:** Multi-column forms collapse to single column. Buttons stack or shrink but stay legible.

---

### TC-RESP-006 — Dashboard widgets at three widths

**Login as:** any role
**Steps:**
1. Cycle widget layout through wide (3 cols), medium (2 cols), narrow (1 col).

**Expected:** Widgets resize cleanly. Charts/text inside widgets do not overflow.

---

### TC-RESP-007 — 360 Feedback aggregate at narrow width

**Login as:** any role
**Steps:**
1. Open My Feedback at narrow width.

**Expected:** Bars / distribution charts remain legible. Bucket headers stack appropriately.

---

## 7.9 Empty / Loading / Error states

### TC-STATE-001 — Empty state on every list

**Steps:**
1. For each list page (My Goals, Team Goals, My Reviews, Team Reviews, My Mentees, Project Reviews, 360 Peer List), filter or engineer your way to zero rows.

**Expected:**
- Friendly empty-state graphic + heading + supporting line.
- No console errors.

**UI checks:**
- Empty-state is centered both horizontally and vertically in its container.
- Tone of voice ("No goals yet" vs "No matching mentees") distinguishes "nothing exists" from "filter matched nothing".

---

### TC-STATE-002 — Loading state on every list

**Steps:**
1. With DevTools → Network throttled, navigate to each list page.

**Expected each:**
- A skeleton/spinner is shown while loading.
- No flash of empty-state before data loads.
- Loading state matches the shape of loaded content (no layout shift).

---

### TC-STATE-003 — Error state on every list

**Steps:**
1. With DevTools → block the API request, navigate to each list.

**Expected each:**
- A red error banner or toast: "Failed to load. Please try again."
- A **Retry** option (if implemented).
- The app does NOT crash to a blank screen.

---

### TC-STATE-004 — Unauthorized / catch-all 404

**Login as:** Staff
**Steps:**
1. Navigate to `/admin` (forbidden for Staff).
2. Navigate to `/this-does-not-exist`.

**Expected:**
- `/admin` → redirected to `/dashboard` (or `/unauthorized` if no dashboard feature).
- `/this-does-not-exist` → redirected to `/dashboard` per the App.tsx catch-all route.
- In each case the Sidebar/Topbar render normally.

---

### TC-STATE-005 — Unauthorized page (Unauthorized.tsx) renders cleanly

**Pre-condition:** A user has no `dashboard` feature flag (rare; configure via Admin if possible).
**Login as:** that user
**Steps:**
1. After login, you should land on `/unauthorized`.

**Expected:**
- A friendly "You don't have access to any features" message.
- A link or guidance to contact an Admin.
- Sidebar may or may not render — verify with product.

---

## 7.10 Filters & Sort consistency

### TC-FS-001 — Same filter pattern across pages

**Steps:**
1. Open any 3 list pages (e.g. My Goals, Team Reviews, Admin → Users).

**Expected:**
- Filter dropdowns are on the same row, evenly spaced.
- Combobox filters (Employee, Project, Mentor) behave identically: typeable, clearable.
- Status filter dropdowns have consistent option styling.

---

### TC-FS-002 — Sort indicators match

**Steps:**
1. On each sortable column on each page, click the header.

**Expected:**
- Sort indicator (arrow) is in the SAME position on every page.
- Only the active column shows an indicator.
- Clicking the same header twice reverses sort.

---

### TC-FS-003 — Clearing filters

**Steps:**
1. Apply 3+ filters on a page.
2. Use a "Clear all" button OR set each back to "All" manually.

**Expected:** Table fully resets to original state.

---

## 7.11 Toasts / Snackbars / Confirm dialogs

### TC-TOAST-001 — Success toast style

**Steps:**
1. Trigger several success actions: save a goal, submit a review, deactivate a user.

**Expected each:**
- Toast appears in the same corner.
- Green/teal color.
- Auto-dismisses after a few seconds.

---

### TC-TOAST-002 — Error toast style

**Steps:**
1. Trigger several errors: submit invalid input, hit a 500 (block the endpoint).

**Expected each:**
- Red color; same corner as success toasts.

---

### TC-CONFIRM-001 — Confirmation dialog style

**Steps:**
1. Trigger several confirms: submit a goal, soft-delete a user, complete an annual review.

**Expected each:**
- Dialog is centered.
- Primary action color is appropriate: destructive = red, normal = brand.
- Cancel is to the left of the primary.
- ESC closes the dialog (Cancel).

---

### TC-CONFIRM-002 — Destructive confirms have explicit copy

**Steps:**
1. Trigger Soft-Delete User confirmation.

**Expected:** Body text spells out the consequence: "This will revoke their access. They can be reactivated by editing them later." (or equivalent).

---

## 7.12 Date / FY formatting

### TC-DATE-001 — FY label consistency

**Steps:**
1. Across all pages, look at FY labels: dashboards, filters, tables, modal headers.

**Expected:** Every FY label uses the same format. Within each context the choice (long "FY 2026–27" vs short "FY26") is consistent.

---

### TC-DATE-002 — Date timestamp consistency

**Steps:**
1. Across pages with timestamps (audit log, "submitted at", "approved on"), confirm the format.

**Expected:** Either absolute ("13 May 2026, 14:30") or relative ("2 hours ago"), but consistent within similar contexts.

---

### TC-DATE-003 — Cycle label consistency

**Steps:**
1. On goals with self-reviews, the cycle label appears as "H1" / "H2" / "Q1"–"Q4" depending on `cycle_type`.

**Expected:** Within the same surface, label format is consistent.

---

## 7.13 Permission denied (redirect) surfaces

### TC-403-001 — Staff hitting Admin URL

**Login as:** Staff
**Steps:**
1. Navigate to `/admin` directly.

**Expected:**
- Redirected to `/dashboard` (because Staff has the dashboard feature).
- No stack trace, no blank screen.

---

### TC-403-002 — Logged-out user hitting any internal URL

**Login as:** _not logged in_
**Steps:**
1. Paste an internal URL (e.g. `/annual-goals`) without logging in.

**Expected:** Redirected to `/login`. The intended URL is preserved in router state — after a successful login, you land on `/annual-goals`.

---

### TC-403-003 — User with `must_change_password` hits any protected URL

**Pre-condition:** User has `must_change_password = true`.
**Steps:**
1. Try any protected URL.

**Expected:** Redirected to `/change-password`. Other URLs are blocked until the password is set.

---

## 7.14 Browser & device compatibility

### TC-BROW-001 — Chrome happy path

**Steps:** Login → My Goals → Annual Reviews → Project Reviews → 360 Feedback → Logout.
**Expected:** All flows work; no console errors.

---

### TC-BROW-002 — Firefox happy path

**Expected:** Identical to Chrome.

---

### TC-BROW-003 — Edge happy path

**Expected:** Identical.

---

### TC-BROW-004 — Safari (Mac) happy path

**Expected:** Identical. Watch for date input differences and modal animation quirks.

---

### TC-BROW-005 — Mobile viewport (iPhone-sized)

**Steps:** Toggle DevTools mobile emulation (iPhone 12 viewport).

**Expected:** App is fully usable; nothing overflows. Touch-tap targets are at least 44 px tall.

---

## 7.15 Keyboard & accessibility

### TC-A11Y-001 — Tab order on Login

**Steps:**
1. Tab through fields → Email → Password → Sign In → Forgot Password.

**Expected:** Logical order; no traps.

---

### TC-A11Y-002 — Modal focus trap

**Steps:**
1. Open any modal.
2. Press Tab repeatedly.

**Expected:** Focus cycles inside the modal; does not escape to the page underneath.

---

### TC-A11Y-003 — ESC closes modals

**Steps:**
1. Open every modal type (goal create, eval, user form, profile edit, etc.).
2. Press ESC.

**Expected:** Each closes (or asks for confirmation when there are unsaved edits — verify the policy is consistent).

---

### TC-A11Y-004 — Click outside closes modals

**Steps:**
1. Open every modal.
2. Click on the dark backdrop outside the modal.

**Expected:**
- Read-only / view modals: close.
- Form modals: either close OR require explicit Cancel/Save (to prevent data loss). Behavior should be CONSISTENT across all form modals.

---

### TC-A11Y-005 — Visible focus indicator

**Steps:**
1. Tab through any page.

**Expected:** Each focused element shows a visible outline (blue ring or similar). No element is invisible to keyboard users.

---

## 7.16 Console & network hygiene

### TC-LOG-001 — No console errors on happy paths

**Steps:**
1. Open DevTools → Console.
2. Walk through every major flow.

**Expected:** No red error messages. Yellow warnings are acceptable but worth noting if many.

---

### TC-LOG-002 — No 4xx/5xx on happy paths

**Steps:**
1. Open DevTools → Network.
2. Walk through happy paths.

**Expected:** All API responses are 2xx. 401s only after session expiry.

---

### TC-LOG-003 — Sensitive data not leaked in URLs

**Steps:**
1. Check URLs across all pages.

**Expected:**
- No email addresses, names, tokens, or other identifying info in query strings unless functional.
- Especially: no auth tokens, no `reviewer_hash`, in URLs.

---

### TC-LOG-004 — Anonymous-feedback guarantee in API responses

**Steps:**
1. Open DevTools → Network → submit feedback in 360 module.
2. Inspect the POST response body and any subsequent aggregate fetch.

**Expected:** No `reviewer_id`, `reviewer_email`, or any field that ties a review row back to a person — only aggregated data.

---

## 7.17 Final regression sweep — happy-path roundtrip

Do this sweep **after every release**. It's the smoke test for "the app still works end-to-end."

**Login as:** Admin (is_management)
1. Open Dashboard → widgets load.
2. Admin Panel → Users → invite a test user (verify `must_change_password = true` for them).
3. Admin Panel → Settings → toggle `annual_goals_edit_enabled` → save → refresh → setting persists.
4. Admin Panel → Projects → create a project with PM = TestStaff and Secondary = AnotherStaff.
5. Logout.

**Login as:** the test user (forced change-password)
1. Land on /change-password → set new password → redirected to /dashboard.
2. Open Profile → update phone → save.
3. Logout.

**Login as:** Staff (with a mentor)
1. Annual Goals → create a goal → submit for approval.
2. Annual Reviews → start self-review → save draft → continue → submit.
3. Project Reviews → My Reviews → confirm row appears (if PM has submitted).
4. 360 Feedback → Give Feedback → submit feedback for one peer.
5. Logout.

**Login as:** Mentor (mentor of that Staff)
1. Annual Goals → Team Goals → approve the goal.
2. Annual Reviews → Team Review → submit mentor evaluation.
3. My Mentees → click the Staff → MenteeDetail tabs all load.
4. Logout.

**Login as:** Admin (is_management)
1. Admin Panel → Management Review → set final rating + comments → publish.
2. Admin Panel → Reviews → confirm the project review and annual review appear.
3. Admin Panel → Exports → Export Annual Reviews → file downloads cleanly.
4. Inspect `export_audit_log` → row exists for the export.
5. Dashboard → counts updated.

If every step in this sweep passes, the release is functional. Then run the focused module test cases for deeper coverage.

---

## 7.18 Bug-reporting workflow (reminder)

Use the template from Module 1 §1.7 for every finding. Always include:
- Module + Test Case ID
- Browser + version + window width
- Steps to reproduce
- Expected vs Actual
- Screenshot
- DevTools console errors (F12 → Console)
- DevTools network errors (F12 → Network → look for red rows)

---

**End of Module 7.**

---

## All-modules index

| Module | Topic | File |
|---|---|---|
| 1 | Foundational / cross-cutting (auth, forced password change, RBAC, profile, notifications, chrome) | `QA-Test-Cases-01-Foundational.md` |
| 2 | Annual Goals (My / Team, criteria, self & mentor review, bulk approve) | `QA-Test-Cases-02-AnnualGoals.md` |
| 3 | Annual Reviews (Self / Mentor / Management 3-stage calibration) | `QA-Test-Cases-03-AnnualReviews.md` |
| 4 | Project Reviews (My / PM Evaluation / Secondary, 7 competencies, Performance Group) | `QA-Test-Cases-04-ProjectReviews.md` |
| 5 | 360 Feedback (Give / My / Mentee / Org, anonymity, 12 questions) | `QA-Test-Cases-05-Feedback360.md` |
| 6 | Mentoring (My Mentees list + MenteeDetail aggregator tabs) | `QA-Test-Cases-06-Mentoring.md` |
| 7 | Dashboard, Admin Panel (Users/Projects/Reviews/Mgmt/Settings/Exports), responsive, a11y, regression sweep | `QA-Test-Cases-07-AdminAndCrossCutting.md` |

Total: 7 modules · ~210 test cases · ready for QA hand-off.
