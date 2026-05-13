# QA Test Cases — Module 5: 360 Feedback (Healthark-only)

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Module 1 reviewed. Apply Module 1 §1.6 UI checklist on every screen.
> **Test accounts needed:**
> - **Staff A, Staff B, Staff C** — peers in the same org. Some share a project (so `worked_with = true`), some don't.
> - **Mentor** — a Staff with at least one direct mentee (`has_mentees = true`) to see Mentee Feedback tab.
> - **Admin (`is_management = true`)** — to see Org Feedback tab and probe any user's aggregate.
> - **Admin (`is_management = false`)** — to verify Org Feedback tab is hidden.
> - **Staff (`is_management = false`, `has_mentees = false`)** — to verify only Give + My Feedback tabs are visible.
>
> **Vocab:**
> - **Anonymous Submission** — reviewer identity is NEVER persisted. The DB only stores `reviewer_hash = HMAC-SHA256(reviewer_id | target_id | fy_year, secret)`. One review per (reviewer, target, FY) — enforced by a unique constraint.
> - **`worked_with` flag** — snapshot at submit time: true if the reviewer and target share at least one project assignment at that moment.
> - **Rating scale** — 1 (strongly disagree) … 5 (strongly agree). Per question. Skipped questions = no row stored.
> - **fy_year** — integer start year of the FY (e.g. 2026 = FY26). Distinct from goal/review cycle labels.
> - **Questions** — 12 hardcoded questions (see `backend/app/feedback_360/questions.py`) across buckets: Collaboration, Empathy, Empowerment (×2), Equity, Growth, Impact, Values, Communication (×2), Core Expertise, Domain Knowledge.

---

## 5.1 Give Feedback tab (Peer List)

### TC-FB360-001 — Open the Give Feedback tab

**Login as:** any Staff
**Steps:**
1. Open **360 Feedback** from the sidebar.
2. Default tab should be **Give Feedback**.

**Expected:**
- Page header reads "360 Feedback" and a short subtitle explains anonymity and the once-per-FY rule.
- Tab bar shows: **Give Feedback** (active), **My Feedback**, plus conditional tabs:
  - **Mentee Feedback** — only if `has_mentees = true`.
  - **Org Feedback** — only if `is_management = true`.
- A list of peer cards / rows loads in the Give tab.

**UI checks:**
- Tabs are evenly spaced; active tab has a clear brand-colored underline.
- Tab list scrolls horizontally on narrow widths without overflow.

---

### TC-FB360-002 — Peer list excludes the current user

**Login as:** Staff (e.g. user `alice@…`)
**Steps:**
1. Open Give Feedback.
2. Scroll through the peer list.

**Expected:**
- Your own row does NOT appear in the peer list.
- All other active users in your org appear.

---

### TC-FB360-003 — Filter: "Worked with" / "Not worked with" / "All"

**Login as:** Staff who is on at least one project
**Steps:**
1. Open Give Feedback. Default filter is **Worked with** (people who share a project with you).
2. Toggle to **All** → entire active org is shown.
3. Toggle to **Not worked with** → only peers with no shared project are shown.

**Expected:**
- "Worked with" matches the `worked_with` flag (live from current project assignments).
- The three filter states are visually distinct (active pill / underline).
- Row counts make sense given your project assignments.

---

### TC-FB360-004 — Search peer by name

**Login as:** Staff
**Steps:**
1. Type part of a peer's full name in the search box.

**Expected:** Live-filter: only matching peers remain.

---

### TC-FB360-005 — Peer card shows "Submitted" indicator when already reviewed

**Pre-condition:** You have already submitted feedback for Staff B in the current FY.
**Login as:** the reviewer
**Steps:**
1. Open Give Feedback.
2. Locate Staff B's row.

**Expected:**
- Staff B's row shows a clear **Submitted** (or "View" / check icon) indicator.
- The action button reads **View** (not "Give Feedback").

**UI checks:**
- Submitted rows have a subtle background tint or check icon that's distinct from unsubmitted rows.

---

### TC-FB360-006 — Open the give-feedback form for a peer

**Login as:** Staff
**Steps:**
1. On a peer you haven't reviewed yet, click **Give Feedback** → navigate to `/feedback/give/<target_user_id>`.

**Expected:**
- The **FeedbackGive** page loads.
- Target's full name + designation + (worked-with chip) are visible at the top.
- A list of all 12 questions appears, each with a 1–5 rating track (RatingTrack component).
- Questions are grouped visually by bucket (Collaboration, Empathy, Empowerment, etc.).

**UI checks:**
- Each rating track has 5 distinct positions with clear labels (1=disagree, 5=agree).
- Bucket headers are visually distinct from question text.

---

### TC-FB360-007 — Submit a complete review

**Login as:** Staff
**Steps:**
1. Open `/feedback/give/<target>`.
2. Pick a rating (1–5) for ALL 12 questions.
3. Click **Submit**.
4. Confirm in the dialog.

**Expected:**
- Submission succeeds.
- A toast: "Feedback submitted." (or similar).
- You are redirected back to the Give Feedback peer list (or remain on a read-only "Already submitted" view).
- That peer's row now shows the **Submitted** state.
- Reviewer identity is NOT stored — only `reviewer_hash`.

---

### TC-FB360-008 — Submit a partial review (skip some questions)

**Login as:** Staff
**Steps:**
1. Open the give-feedback form for a new peer.
2. Rate only 4 questions; leave the other 8 unrated.
3. Click Submit.

**Expected:**
- Submission succeeds (skipped questions are not stored — `Feedback360Answer` rows are only created for rated questions).
- The peer's row now shows Submitted.

**UI checks:**
- If a "Submit" button validates min-questions, the validation message is clear.

---

### TC-FB360-009 — Cannot submit zero ratings

**Login as:** Staff
**Steps:**
1. Open the give-feedback form.
2. Leave ALL ratings unselected.
3. Click Submit.

**Expected:**
- Submit is either disabled, or the API rejects with a clear error: "Please rate at least one question."

---

### TC-FB360-010 — Cannot re-submit feedback for the same peer in the same FY

**Pre-condition:** You already submitted feedback for Staff B in the current FY.
**Login as:** the reviewer
**Steps:**
1. Try to open `/feedback/give/<Staff B id>` via direct URL.
2. Look at the form.

**Expected:**
- The page renders in **read-only mode** — ratings appear (your prior submission) but are disabled.
- Submit button is hidden or disabled with a label "Already submitted for FY26."
- API-side, a second POST returns 409 (or similar) — uniqueness constraint enforces this at DB layer.

---

### TC-FB360-011 — Cannot give feedback to yourself

**Login as:** Staff
**Steps:**
1. Try navigating to `/feedback/give/<your own user_id>`.

**Expected:**
- The form refuses to load (redirect to peer list or a clear "You cannot review yourself" message).
- API returns 400 if a manual POST is attempted.

---

### TC-FB360-012 — `worked_with` chip and snapshot behavior

**Login as:** Staff who is currently on Project X with Staff B
**Steps:**
1. Open Give Feedback → Staff B's row shows a "Worked with" chip.
2. Open the give-feedback form → the same chip appears at the top.
3. Submit feedback for Staff B.
4. **Now have admin remove you from Project X** (so you no longer "work with" Staff B).
5. Go back to your submitted feedback (visible to admin / yourself in read-only).

**Expected:**
- The `worked_with` flag on the saved review remains **true** — it's a snapshot at submit time.
- The chip in any new feedback form (other peers) updates based on current assignments.

---

### TC-FB360-013 — Empty state when no peers exist

**Pre-condition:** A brand-new org with only the current user.
**Login as:** the sole user
**Steps:**
1. Open Give Feedback.

**Expected:**
- A friendly empty state ("No peers yet" or similar) — not a blank table.

---

## 5.2 My Feedback tab (Your aggregate)

### TC-FB360-014 — Open My Feedback tab

**Login as:** any Staff who has at least 1 review received (others have submitted feedback on you)
**Steps:**
1. Open 360 Feedback → click **My Feedback**.

**Expected:**
- An **AggregateView** loads showing:
  - Heading: "Your aggregate" (or similar).
  - A list of all 12 questions, each with a visual bar/track showing the distribution of 1–5 ratings.
  - Per-question average is displayed.
  - Total number of reviews received in the current FY.
- The aggregate is anonymous — no reviewer name or identity is shown anywhere.

**UI checks:**
- Bars/tracks are sized proportionally to the rating counts.
- Gridlines (1, 2, 3, 4, 5) are clearly marked.
- Bucket grouping is preserved.

---

### TC-FB360-015 — My Feedback shows "No data yet" when no reviews received

**Pre-condition:** You have received 0 reviews this FY.
**Login as:** that Staff
**Steps:**
1. Open My Feedback tab.

**Expected:**
- A friendly empty state: "No feedback received yet for FY26." (or similar).
- No broken charts, no NaN%, no console errors.

---

### TC-FB360-016 — FY filter on My Feedback

**Login as:** Staff with reviews across multiple FYs
**Steps:**
1. Open My Feedback.
2. Look for an FY picker (if implemented). Switch to a past FY.

**Expected:**
- Aggregate refreshes to that FY's data.
- "Total reviews" count updates.

---

### TC-FB360-017 — Cannot infer reviewer identity from aggregate

**Login as:** Staff with only 1 received review (so only 1 reviewer in the FY)
**Steps:**
1. Open My Feedback.

**Expected:**
- The page does NOT display the reviewer's name, hash, or any traceable detail.
- The total count is shown ("1 review received") but the individual answers are not attributed.

**UI checks (anonymity safeguard):**
- Even with N=1, the distribution display does not leak structure that could re-identify the reviewer.

---

## 5.3 Mentee Feedback tab (Mentor only)

### TC-FB360-018 — Mentee Feedback tab visible only to mentors

**Login as:** Staff who is NOT a mentor (`has_mentees = false`)
**Steps:**
1. Open 360 Feedback → look at the tab bar.

**Expected:** Mentee Feedback tab is NOT present.

---

### TC-FB360-019 — Mentor picks a mentee to view aggregate

**Login as:** Mentor (`has_mentees = true`)
**Steps:**
1. Open 360 Feedback → click **Mentee Feedback** tab.
2. A picker (dropdown / search) lists your direct mentees.
3. Pick one mentee.

**Expected:**
- The AggregateView loads for that mentee's received feedback.
- Same format as My Feedback (12 questions, distributions, total count).
- Identity of reviewers is NOT shown.

---

### TC-FB360-020 — Mentor cannot probe non-mentees

**Login as:** Mentor
**Steps:**
1. Identify a user Z in the org who is NOT your direct mentee.
2. Use DevTools or manual URL crafting to call `GET /api/v1/feedback360/aggregate/<Z's id>?fy_year=2026`.

**Expected:**
- API returns 403 / Forbidden.
- No data leaks to the Mentor.

---

### TC-FB360-021 — Mentee with no feedback received

**Pre-condition:** Your mentee has received 0 reviews this FY.
**Login as:** Mentor
**Steps:**
1. Open Mentee Feedback → pick that mentee.

**Expected:**
- Empty state: "No feedback received yet."

---

## 5.4 Org Feedback tab (Management only)

### TC-FB360-022 — Org Feedback tab visible only to is_management

**Login as:** Admin with `is_management = false`
**Steps:**
1. Open 360 Feedback → look at the tab bar.

**Expected:** Org Feedback tab is NOT present.

**Then login as:** Admin with `is_management = true`
**Expected:** Org Feedback tab IS present.

---

### TC-FB360-023 — Management picks any org user

**Login as:** Admin (`is_management = true`)
**Steps:**
1. Open Org Feedback tab.
2. A combobox / picker lists every active user in the org.
3. Pick a user (e.g. Staff X).

**Expected:**
- AggregateView loads for Staff X's received feedback.
- Same 12-question format.
- Reviewer identities remain hidden (anonymity preserved even for management — only aggregates).

**UI checks:**
- Search inside the picker works (type a few letters of a name).

---

### TC-FB360-024 — Org Feedback respects FY scoping

**Login as:** Admin (`is_management = true`)
**Steps:**
1. Open Org Feedback → pick a user.
2. Switch FY picker to a past FY.

**Expected:** Aggregate refreshes to that FY's data.

---

### TC-FB360-025 — Non-management cannot call org-aggregate endpoint

**Login as:** Staff (not management, not mentor of target)
**Steps:**
1. Manually call `GET /api/v1/feedback360/aggregate/<some target id>?fy_year=2026`.

**Expected:** API returns 403.

---

## 5.5 Anonymity & Data Integrity

### TC-FB360-026 — Reviewer identity not in API responses

**Login as:** any role with access to an aggregate
**Steps:**
1. Open DevTools → Network tab.
2. Open My Feedback / Mentee Feedback / Org Feedback.
3. Inspect the JSON response from the aggregate endpoint.

**Expected:**
- The response contains ratings, distributions, counts.
- The response does NOT contain `reviewer_id`, `reviewer_hash`, `reviewer_email`, or any user-identifying field for the reviewer.

---

### TC-FB360-027 — Database-level uniqueness prevents duplicate submission

**Pre-condition:** Have technical access to the DB or use a tool to attempt two near-simultaneous POSTs to `/api/v1/feedback360/reviews` with the same target + FY.
**Login as:** Staff (technical QA)
**Steps:**
1. Fire two POST requests in quick succession.

**Expected:**
- Exactly one succeeds.
- The other returns 409 (conflict) due to the unique constraint `uq_feedback_360_reviews_target_fy_hash`.

---

### TC-FB360-028 — Submitting outside the current FY is rejected

**Login as:** Staff
**Steps:**
1. Manually craft a POST with `fy_year = 2025` (a past FY no longer open for feedback).

**Expected:** API returns 400 or 403 with a clear message: "Submissions for FY25 are closed." (Behavior depends on whether the org allows back-dated reviews — verify with product. Whichever it is, the response must be consistent.)

---

## 5.6 Aggregate View UI

### TC-FB360-029 — Aggregate bars render proportionally

**Login as:** Staff with mixed received ratings
**Steps:**
1. Open My Feedback.
2. Inspect the bars for a question with, say, 1×rating-5, 3×rating-4, 2×rating-3.

**Expected:**
- The bar segments are sized proportionally (the rating-4 segment is 3× the width of the rating-5 segment).
- Hovering a segment shows a tooltip with the count.

---

### TC-FB360-030 — Skipped questions show "No responses"

**Pre-condition:** You have received some feedback but every reviewer skipped question `domain_knowledge`.
**Login as:** Staff
**Steps:**
1. Open My Feedback → look at `domain_knowledge`.

**Expected:**
- The row reads "No responses" or shows an empty bar with a muted label.
- No NaN%, no broken layout.

---

### TC-FB360-031 — Aggregate sums match the per-FY review count

**Login as:** Staff with N reviews received
**Steps:**
1. Sum the rating counts across rating positions for any single question.

**Expected:** The sum ≤ N (some reviewers may have skipped a particular question, so it can be less, but never more).

---

## 5.7 Cross-checks

- Refer to **Module 1 §1.6** UI checklist on every screen.
- Anonymity is the headline guarantee — every tab, every API response, every UI surface must NEVER leak the reviewer's identity. Treat any leak as a Critical severity bug.
- Submission lifecycle: peer list → form → submit → row state updates → My Feedback aggregate updates on next load.
- Tabs visibility table — verify against the actual user shape:

| User type | Give | My Feedback | Mentee Feedback | Org Feedback |
|---|---|---|---|---|
| Staff, no mentees, not management | ✓ | ✓ | ✗ | ✗ |
| Staff with mentees, not management | ✓ | ✓ | ✓ | ✗ |
| Admin, not management | ✓ | ✓ | only if has mentees | ✗ |
| Admin, management | ✓ | ✓ | only if has mentees | ✓ |

- Test in three browser widths: narrow / medium / wide.

---

**End of Module 5.** Next: Module 6 — Mentoring (My Mentees / MenteeDetail).
