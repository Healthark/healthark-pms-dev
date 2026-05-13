# QA Test Cases — Module 1: Foundational & Cross-Cutting

> **Audience:** Manual QA tester, non-technical.
> **Scope:** The parts of the app that touch every other module — Login & Session, Forced Password Change, Reset Password, Role / Feature Gating, Profile, Notifications, and Topbar / Sidebar chrome.
> **Prerequisite:** You have the hosted application URL and a set of test accounts:
> - **Admin (is_management = true)** — sees Admin Panel + Management Review tab + Org Feedback.
> - **Admin (is_management = false)** — sees Admin Panel but not Management Review or Org Feedback.
> - **Staff (has mentor)** — regular employee.
> - **Staff (no mentor)** — for "no mentor" edge cases.
> - **Staff who is a mentor (has mentees)** — sees My Mentees + Mentee Feedback tab.
> - **Staff who is a PM** — assigned to a project as the primary reviewer (`reports_to_id`).
> - **Staff who is a Secondary Evaluator** — assigned to a project as `secondary_evaluator_id`.
>
> **Role names in code:** Only **"Admin"** and **"Staff"** exist. There is **no** "Mentor", "PM", "HR", or "Manager" role — those are *responsibilities* derived from `mentor_id`, `reports_to_id`, `secondary_evaluator_id`, or department.

---

## How to use this document

1. Walk through each test case (TC) in order.
2. **Login as** tells you which test account to use.
3. **Steps** are numbered. Do exactly what each step says.
4. **Expected** describes what should happen. If anything is different, mark the test FAIL and screenshot it.
5. **UI checks on this screen** are visual checks for the *same* screen the test took you to. Don't skip them — they catch layout bugs that functional steps miss.
6. Use a notebook or spreadsheet to record: **Test ID · Pass/Fail · Notes · Screenshot link**.

### What "UI feels off" means

Open every screen and ask these six questions. If the answer to any is *yes*, flag it as a UI bug:

- Is any text cut off, overlapping, or running into another element?
- Are buttons / input boxes wider or narrower than the others around them without a reason?
- Is anything misaligned (e.g. a column header sits to the right of its cell content)?
- Does spacing look uneven — too tight in one place, too loose in another?
- Does anything look stretched or squashed on a wider/narrower window?
- Are colors inconsistent with the rest of the app (e.g. one button is teal, another doing the same job is gray)?

Resize the browser window to test 3 widths each time: **narrow (≈ 600 px wide), medium (≈ 1000 px), wide (≈ 1400 px+)**. Most layout bugs only show up at one width.

---

## 1.1 Authentication — Login, Logout, Session

### TC-AUTH-001 — Login with valid credentials

**Login as:** _not logged in (open in fresh incognito window)_
**Steps:**
1. Open the hosted app URL.
2. You should land on the Login page automatically.
3. Type a valid Staff email in the **Email** box.
4. Type the matching password in the **Password** box.
5. Click **Sign In**.

**Expected:**
- You are taken to the Dashboard (home page).
- The Healthark logo and "PMS" label are visible top-left of the sidebar.
- Your name and avatar appear in the top-right corner (Topbar).
- No error banner is visible.

**UI checks on this screen (login page):**
- The login card is horizontally and vertically centered on the page.
- The Healthark logo is visible above the form.
- Email and Password input boxes are the same width.
- The **Sign In** button is the same width as the input boxes (or full-width within the card).
- Tab key moves focus Email → Password → Sign In in that order.
- On a narrow window (≈ 600 px), the card does not overflow horizontally; no horizontal scrollbar appears.

---

### TC-AUTH-002 — Login fails with wrong password

**Login as:** _not logged in_
**Steps:**
1. Open the Login page.
2. Type a valid email.
3. Type an obviously wrong password (e.g. `wrongpassword123`).
4. Click **Sign In**.

**Expected:**
- A red error message appears below or above the form.
- The message says something like "Invalid email or password" — it must **not** reveal whether the email exists.
- You stay on the Login page; you are NOT taken to the Dashboard.

**UI checks:**
- Error banner does not push the form out of vertical center.
- Banner text wraps cleanly; never extends past the card edge.
- The Email input is NOT cleared (your typed email should still be there so you can fix the password without retyping).

---

### TC-AUTH-003 — Login fails with non-existent email

**Login as:** _not logged in_
**Steps:**
1. Type an email that doesn't exist (e.g. `nobody@nowhere.test`).
2. Type any password.
3. Click **Sign In**.

**Expected:** Same generic error as TC-AUTH-002. The app must NOT say "email not found" — that would let attackers fish for valid emails.

---

### TC-AUTH-004 — Login with empty fields

**Login as:** _not logged in_
**Steps:**
1. Leave both Email and Password empty.
2. Click **Sign In**.

**Expected:**
- The form does not submit.
- The browser's "Please fill out this field" hint, or an inline error, appears next to each empty field.

**UI checks:**
- The required-field indicator (asterisk or red border) is consistent on both fields.

---

### TC-AUTH-005 — Login as a soft-deleted user

**Pre-condition:** An admin has soft-deleted a Staff account (`is_deleted = true`) via Admin Panel → Users → Delete.
**Login as:** _the deleted user_
**Steps:**
1. Type the deleted account's email and last-known password.
2. Click **Sign In**.

**Expected:**
- A clear error appears: the user cannot log in (e.g. "Invalid email or password" — the system treats deleted users as non-existent).
- You stay on the Login page.

---

### TC-AUTH-006 — "Forgot password?" link visible

**Login as:** _not logged in_
**Steps:**
1. On the Login page, look below or beside the password field.

**Expected:**
- A **Forgot password?** link is visible and clickable.
- Clicking it navigates to `/reset-password`.

**UI checks:**
- Link text color contrasts with the background (you can read it).
- Cursor changes to a pointing hand on hover.

---

### TC-AUTH-007 — Request a password reset email (self-service)

**Login as:** _not logged in_
**Steps:**
1. Click **Forgot password?** on the Login page.
2. You land on `/reset-password` with an Email field.
3. Type a valid registered email.
4. Click **Send Reset Link** (or whatever the button says).

**Expected:**
- A confirmation message appears: e.g. "If that email exists, a reset link has been sent."
- The message is generic — it does NOT confirm whether the email actually exists (prevents email-fishing).
- The form clears or disables.
- No error is shown.

---

### TC-AUTH-008 — Reset password using the email link

**Login as:** _not logged in_
**Steps:**
1. Open the email inbox of the account from TC-AUTH-007.
2. Find the reset email and click the link (it contains a one-time `token` query param).
3. You land on `/reset-password?token=…` showing two password fields.
4. Type a new password (meeting any rules shown on the page).
5. Confirm the password in the second field.
6. Click **Reset Password**.

**Expected:**
- A success message appears.
- You are redirected to the Login page.
- You can sign in with the new password.
- The old password no longer works.

**UI checks:**
- Password strength indicator (if present) updates as you type.
- The two password fields are the same width and stacked vertically.
- An error appears if the two passwords don't match.

---

### TC-AUTH-009 — Reset token expires after 15 minutes

**Pre-condition:** Generate a reset link (TC-AUTH-007) and wait 16+ minutes before clicking it.
**Steps:**
1. Click the (now stale) reset link.
2. Try to set a new password.

**Expected:**
- A clear error appears: "This reset link has expired. Please request a new one."
- You are NOT able to change the password.
- A "Request a new link" call-to-action is visible.

---

### TC-AUTH-010 — Reset token cannot be reused

**Pre-condition:** TC-AUTH-008 has just been completed successfully with a token.
**Steps:**
1. Open the SAME reset link a second time.

**Expected:**
- An error appears: "This link has already been used. Request a new one if you need to reset again."
- No password change is possible with the consumed token.

---

### TC-AUTH-011 — Admin-triggered password reset forces a change at next login

**Pre-condition:** Login as Admin → open Admin Panel → Users tab → pick a Staff → trigger **Reset Password**. The system marks the staff's `must_change_password = true` and emails them a temporary password (or a token).
**Login as:** the affected Staff
**Steps:**
1. Enter the email and the temporary password / use the emailed link.

**Expected:**
- You are NOT routed to the Dashboard.
- Instead, you land on `/change-password` — a full-screen page with NO Sidebar and NO Topbar.
- A clear message indicates you must set a new password before continuing.

---

### TC-AUTH-012 — Set new password on the forced change-password page

**Login as:** Staff with `must_change_password = true` (continued from TC-AUTH-011)
**Steps:**
1. On `/change-password`, type a new password and confirm it.
2. Click **Save** (or **Change Password**).

**Expected:**
- Success toast appears.
- `must_change_password` is cleared on the backend.
- You are redirected to `/dashboard`.
- Sidebar and Topbar now appear.
- The new password works for future logins.

**UI checks:**
- Both password fields are the same width.
- Visible password-mismatch error appears inline if the two fields differ.
- No Logout option in the page header — the design pushes the user to set a password, not navigate away.

---

### TC-AUTH-013 — Forced-change-password page cannot be bypassed via URL

**Login as:** Staff with `must_change_password = true`
**Steps:**
1. While on `/change-password`, type `/dashboard` into the address bar.
2. Try every other protected URL (`/annual-goals`, `/profile`, `/admin`).

**Expected:**
- Every protected URL re-routes you back to `/change-password`.
- You cannot reach Dashboard, Profile, or anything else until the password is set.

---

### TC-AUTH-014 — Logout from the Topbar

**Login as:** any role
**Steps:**
1. After login, click the avatar in the top-right corner of the Topbar.
2. (Or use the sidebar **Logout** button at the bottom of the sidebar — both should work.)

**Expected:**
- You are redirected to the Login page.
- A success toast may say "Signed out" (optional).
- Clicking the browser **Back** button does NOT return you into the app — it stays on Login or re-prompts authentication.

**UI checks:**
- Logout button text/icon color is red (destructive style).
- Hover state on the Logout button is a light red background.

---

### TC-AUTH-015 — Login resilience: rapid double-click

**Login as:** _not logged in_
**Steps:**
1. Type a valid email + password.
2. Click **Sign In** rapidly two or three times in quick succession.

**Expected:**
- The button disables (or the second click is ignored) — only one login API call fires.
- You end up successfully logged in, NOT in some half-broken state.

---

### TC-AUTH-016 — Login page resizes correctly

**Login as:** _not logged in_
**Steps:**
1. Open the Login page in a wide browser window.
2. Slowly drag the window narrower until it's about phone-width (≈ 400 px).

**Expected:**
- The login card stays centered.
- Form fields shrink to fit but never overflow horizontally.
- No horizontal scrollbar appears at any width.
- Logo, title, fields, and Sign In button remain readable and tappable.

---

## 1.2 Authorization — Role & Feature Gating

> **Role model in Healthark:** Only `Admin` and `Staff` exist. Within Admin, the `is_management` flag further gates: Management Review tab, Org Feedback tab, and parts of Exports.
> **Feature flags** (per-org `enabled_features` array, viewable in user session): `dashboard`, `goals`, `annual_reviews`, `project_reviews`, `mentoring`, `feedback_360`, `admin`.

### TC-RBAC-001 — Staff sees Staff-appropriate sidebar

**Login as:** Staff (with mentor; on at least one project)
**Steps:**
1. Open the sidebar; walk through every menu item.

**Expected (sidebar shows):**
- Dashboard
- Project Reviews (only if `project_reviews` feature is on)
- Annual Goals (only if `goals` feature is on)
- Annual Reviews (only if `annual_reviews` feature is on)
- My Mentees — only if the Staff *has mentees* (i.e. is somebody's mentor)
- 360 Feedback (only if `feedback_360` is on)
- Profile · Support · Logout (always at the bottom)

**NOT visible to a plain Staff:**
- Admin Panel

**UI checks:**
- Sidebar items are evenly spaced; no orphan separators or gaps.
- The currently active page is visually highlighted (brand-tinted background, accent left border).
- Sidebar icons and labels are aligned (text not drifting up/down from its icon).

---

### TC-RBAC-002 — Staff with no mentees does NOT see My Mentees

**Login as:** Staff who has a `mentor_id` but is NOT a mentor to anyone (`has_mentees = false`)
**Steps:**
1. Open the sidebar.

**Expected:** No **My Mentees** item appears in the sidebar.

---

### TC-RBAC-003 — Mentor (Staff with mentees) sees My Mentees + Mentee Feedback

**Login as:** Staff who *is* somebody's mentor (`has_mentees = true`)
**Steps:**
1. Sidebar shows **My Mentees**.
2. Open 360 Feedback → tabs row.

**Expected:**
- Sidebar has **My Mentees** entry, badge with mentee count optional.
- 360 Feedback page shows the **Mentee Feedback** tab in addition to Give / My Feedback.

---

### TC-RBAC-004 — Admin sees Admin Panel; Staff does not

**Login as:** Admin
**Steps:**
1. Confirm sidebar includes **Admin Panel** at the bottom of the main nav.
2. Click Admin Panel → it opens with tabs.

**Then login as:** Staff
**Steps:**
1. Confirm sidebar does NOT include Admin Panel.
2. Paste `<host>/admin` into the URL bar.

**Expected:**
- Admin sees Admin Panel and its tabs.
- Staff is redirected away (to `/dashboard` if they have it, otherwise `/unauthorized`).

---

### TC-RBAC-005 — Admin without `is_management` does NOT see Management Review or Org Feedback

**Login as:** Admin with `is_management = false`
**Steps:**
1. Open Admin Panel — confirm the tab list.
2. Open 360 Feedback — confirm the tab list.

**Expected:**
- Admin Panel tabs include Users, Projects, Reviews, Exports, Settings — but **Management Review tab is absent**.
- 360 Feedback tabs include Give / My Feedback / Mentee Feedback (if applicable) — but **Org Feedback tab is absent**.

---

### TC-RBAC-006 — Admin with `is_management = true` sees Management Review + Org Feedback

**Login as:** Admin with `is_management = true`
**Steps:**
1. Open Admin Panel → confirm tab list includes **Management Review**.
2. Open 360 Feedback → confirm tab list includes **Org Feedback**.

**Expected:** Both tabs render and load their content.

---

### TC-RBAC-007 — Direct URL access to forbidden pages

**Login as:** Staff
**Steps:**
1. While logged in as Staff, paste each of these URLs into the address bar:
   - `/admin`
   - `/admin?tab=management-review`
2. Then try a non-existent URL: `/this-does-not-exist`.

**Expected for `/admin`:**
- You are redirected to `/dashboard` (because Staff has the dashboard feature). NOT to a blank screen or stack trace.

**Expected for `/this-does-not-exist`:**
- A catch-all redirect sends you to `/dashboard`. Sidebar and Topbar are intact.

---

### TC-RBAC-008 — Feature flag OFF hides the sidebar item

**Pre-condition:** Admin opens **Admin Panel → Settings → toggle annual_reviews_enabled = OFF** (or, if the org's `enabled_features` excludes `annual_reviews`, the feature is off).
**Login as:** Staff (re-login if needed)
**Steps:**
1. Open the sidebar.
2. Try to navigate to `/annual-reviews` directly.

**Expected:**
- "Annual Reviews" item is NOT in the sidebar.
- Direct URL navigation redirects to `/dashboard`.

---

### TC-RBAC-009 — Feature flag ON shows the sidebar item

**Pre-condition:** Admin toggles `annual_reviews_enabled = ON` (or the org's feature is enabled).
**Login as:** Staff
**Steps:**
1. Refresh the page; open the sidebar.

**Expected:** **Annual Reviews** appears in the sidebar; clicking it loads the Annual Reviews page.

---

### TC-RBAC-010 — Unauthenticated user hitting a protected URL is bounced to Login

**Login as:** _not logged in_
**Steps:**
1. Paste `<host>/annual-goals` into the URL bar.

**Expected:**
- You are redirected to `/login`.
- The original `/annual-goals` path is preserved in router state so that after a successful login, you land on Annual Goals (intended-destination pattern).

---

## 1.3 Profile

### TC-PROFILE-001 — View your own profile

**Login as:** any Staff
**Steps:**
1. Click the **Profile** item in the sidebar (or click your avatar in the Topbar → Profile).

**Expected:**
- A **Profile Info Card** shows: avatar (or initials placeholder), full name, employee code, email, phone, department, designation, and mentor name (if assigned).
- A **Change Password Card** below it (or in a second panel) shows: Current Password · New Password · Confirm New Password.

**UI checks:**
- Sections are aligned in a clean two-column or stacked layout.
- Label text (e.g. "Email") is muted / smaller; the value is darker / larger.
- The page does not have excessive blank space at the bottom.

---

### TC-PROFILE-002 — Profile shows assigned mentor

**Login as:** Staff who has a `mentor_id`
**Steps:**
1. Open Profile.

**Expected:** A **Mentor** field shows the mentor's full name. It is NOT empty and does NOT say "No Mentor".

---

### TC-PROFILE-003 — Profile shows "No mentor assigned" gracefully

**Login as:** Staff who does NOT have a mentor
**Steps:**
1. Open Profile.

**Expected:**
- Mentor field reads "No Mentor Assigned" (or equivalent) in muted/italic style — never blank, never "undefined", never "null".

---

### TC-PROFILE-004 — Edit name and phone

**Login as:** any user
**Steps:**
1. Open Profile → click **Edit** on the Profile Info Card.
2. Change phone number to a new value.
3. Save.

**Expected:**
- Success toast appears.
- The new phone shows immediately without a hard refresh.
- After a hard refresh, the new value is still there (persisted).

**UI checks:**
- Save and Cancel buttons are clearly distinguishable; Cancel reverts edits.

---

### TC-PROFILE-005 — Cannot edit email, role, department, designation, mentor

**Login as:** any non-Admin user
**Steps:**
1. Open Profile → enter edit mode.

**Expected:**
- Email, role, department, designation, and mentor fields are NOT editable in self-service edit mode.
- These can only be changed by an Admin through the Admin Panel.

---

### TC-PROFILE-006 — Self-service Change Password (NOT the forced flow)

**Login as:** any user
**Steps:**
1. Open Profile → Change Password Card.
2. Type the current password.
3. Type a new password and confirm it.
4. Click **Update Password**.

**Expected:**
- Success toast.
- You stay on the Profile page (no forced redirect — this is voluntary).
- Logging out and back in with the new password succeeds.
- The old password no longer works.

**UI checks:**
- Mismatched new/confirm shows an inline error before submission.
- Wrong current password shows a server-side error toast.

---

### TC-PROFILE-007 — Profile reachable from the Topbar avatar menu

**Login as:** any user
**Steps:**
1. Click the avatar in the top-right Topbar.
2. The dropdown opens.
3. Click **Profile**.

**Expected:** You land on `/profile`.

**UI checks:**
- Dropdown appears below the avatar; does not get clipped by the page edge.
- Menu items have consistent padding and font size.

---

## 1.4 Notifications

### TC-NOTIF-001 — Bell icon visible

**Login as:** any role
**Steps:**
1. After login, look at the top-right of the page (near your avatar) in the Topbar.

**Expected:**
- A bell icon is visible.
- If you have unread notifications, a small red badge with a number appears on the bell.

**UI checks:**
- The bell icon is the same size as the avatar / matches the height of the Topbar.
- The unread badge is correctly positioned (top-right of the bell, not floating elsewhere).
- The badge number is centered inside its red circle.

---

### TC-NOTIF-002 — Open notifications dropdown

**Login as:** any role with at least one notification
**Steps:**
1. Click the bell icon.

**Expected:**
- A panel opens below the bell.
- It lists recent notifications: most recent on top.
- Each row shows: a short message, a timestamp, and unread/read state.

**UI checks:**
- Panel doesn't get clipped by the right edge of the screen.
- Each notification row is the same height.
- Unread notifications look visually distinct from read ones (bolder text or a colored dot).

---

### TC-NOTIF-003 — Click a notification navigates to its source

**Login as:** any role with a goal-related notification (e.g. "Your goal was approved")
**Steps:**
1. Open the notifications panel.
2. Click on a single notification row.

**Expected:**
- You are taken to the source entity (e.g. the Annual Goals page, with the relevant goal in view).
- The notification is automatically marked as read (badge count decreases by 1).

---

### TC-NOTIF-004 — Empty notifications state

**Login as:** a fresh test account with no notifications
**Steps:**
1. Click the bell icon.

**Expected:**
- The panel shows a friendly empty state ("You're all caught up!" or similar).
- No error, no infinite spinner.

**UI checks:**
- Empty-state illustration / icon is centered.
- Empty-state text is muted and not too large.

---

### TC-NOTIF-005 — Long notification list scrolls

**Login as:** an account with 20+ notifications (e.g. a Staff who has had many goals approved/reviewed)
**Steps:**
1. Open the notifications panel.
2. Scroll down inside the panel.

**Expected:**
- The panel has a max height; once exceeded, scrolling happens inside the panel — not on the whole page.
- All notifications are reachable by scrolling.

---

### TC-NOTIF-006 — Badge count clears across sessions

**Login as:** user with unread notifications
**Steps:**
1. Open the panel, click a notification (marked read), close the panel.
2. Logout and log back in.

**Expected:**
- Read notifications stay read across sessions.
- The badge count reflects only the remaining unread items.

---

## 1.5 Topbar / Sidebar Chrome

### TC-CHROME-001 — Topbar shows org name and active cycle

**Login as:** any user
**Steps:**
1. Look at the Topbar.

**Expected:**
- The active cycle name (e.g. "H1 FY26", "FY26", or "Q2 FY26" depending on the configured `cycle_type`) is displayed somewhere in the Topbar or at the top of pages that depend on it.
- The user's avatar / initials are top-right.

**UI checks:**
- Topbar height is constant across all pages.

---

### TC-CHROME-002 — Sidebar collapse / expand

**Login as:** any user
**Steps:**
1. Click the chevron button on the right edge of the sidebar.

**Expected:**
- Sidebar collapses to icons-only (≈ 64 px wide). Tooltips appear on hover.
- Click the chevron again → sidebar expands to its full width (≈ 224 px). Labels reappear.

**UI checks:**
- Active page highlight remains visible after collapse.
- Logo swaps between full and small versions cleanly.

---

### TC-CHROME-003 — Healthark logo and "PMS" label

**Login as:** any user
**Steps:**
1. Look at the top of the sidebar.

**Expected:**
- Healthark logo image (`healtharklogov2.png` for full, `healtharklogo-small.png` for collapsed).
- The text **PMS** appears next to the logo (when expanded), in muted style.

---

### TC-CHROME-004 — Sidebar items reflect user role + features in real time

**Login as:** Admin
**Steps:**
1. Open Admin Panel → Settings → toggle `annual_reviews_enabled` to OFF → save.
2. Logout and re-login as Staff.

**Expected:** Staff's sidebar no longer shows **Annual Reviews**.

**Then:** Admin toggles back ON; Staff re-logs in → sidebar shows Annual Reviews again.

---

## 1.6 Cross-cutting UI / UX checks (do these on every screen)

Run these on every page you visit, regardless of test case. Log a separate bug for each finding.

| Check | What "good" looks like |
|---|---|
| **Topbar height** | Same height across every page; doesn't jump on navigation. |
| **Sidebar width** | Constant width per collapse-state; doesn't expand/contract when you switch pages. |
| **Page padding** | Same left/right padding on every page; content doesn't hug the edge in some places and have huge gutters in others. |
| **Table column widths** | Long values truncate with "…" or wrap cleanly — they don't push the layout sideways. |
| **Modals** | Centered horizontally and vertically; backdrop covers the whole page; ESC closes them; clicking outside closes them; X is in the top-right; modal width matches the content (not too narrow, not edge-to-edge). |
| **Forms** | Labels are above their inputs (or aligned consistently); required fields have an asterisk; error messages appear inline and in red; success uses green/teal. |
| **Buttons** | Primary buttons (Save, Submit) are the brand color; secondary buttons (Cancel) are white/gray; destructive buttons (Delete, Deactivate) are red. Each button has a clear hover and pressed state. |
| **Toasts** | Appear in a consistent corner; auto-dismiss after a few seconds; do not stack into infinity. |
| **Loading states** | Each list shows a skeleton or spinner during load; nothing shows blank white while waiting. |
| **Empty states** | A friendly icon + sentence — never just a blank table. |
| **Error states** | When an API call fails, a clear error appears (red banner or toast). The app does NOT show a stack trace or a blank white screen. |
| **Font sizes** | Headings (H1) are clearly larger than subheadings (H2/H3) than body text. No two headings at the same level have different sizes. |
| **Color consistency** | Every "approved" badge is the same green. Every "pending" is the same amber. No two badges with the same meaning use different colors. |
| **Responsive** | At narrow widths (≈ 600 px), nothing overflows; tables convert to cards or scroll horizontally if needed. |
| **Mouse hover** | Every clickable element changes appearance on hover (cursor changes to a hand; color/border shifts). |
| **Keyboard nav** | Tab key moves through interactive elements in a sensible order. Modals trap focus inside themselves. ESC closes them. |

---

## 1.7 Bug reporting template (use this for every finding)

```
Bug ID: BUG-FOUND-001
Module: 1. Foundational / Cross-cutting
Test Case: TC-AUTH-002

Severity: (Critical / High / Medium / Low)
Browser & version: e.g. Chrome 142 on Windows 11
Window width: e.g. 1440 px

Steps to reproduce:
1. ...
2. ...

Expected:
...

Actual:
...

Screenshot: <link>
Console errors (if any): <press F12, click Console tab, screenshot any red errors>
```

---

**End of Module 1.** Next module: Annual Goals.
