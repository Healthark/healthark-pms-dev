# 360 Feedback module

## Context

A new module for peer feedback. Anyone in an org can submit Likert-scale feedback (1 = strongly disagree → 5 = strongly agree) on anyone else once per fiscal year. The aggregate of received feedback is shown to the target themselves, their direct mentor, and Management; everyone else (including plain admins) is blocked. Critically, **the database must not expose who wrote each review** — the design must protect against casual DB inspection so a developer reading rows can't trace a rating back to a colleague.

The aggregate view is split into two color-coded series per question: ratings from reviewers who actually worked with the target (system-inferred from project assignments) and ratings from reviewers who didn't. This makes bias from grudge-reviewers visually obvious.

---

## Locked decisions (from requirements pass)

| #   | Decision              | Choice                                                                                                                                                    |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Anonymity model       | **Cryptographically anonymous** — `reviewer_id` never stored. Uniqueness via HMAC-SHA256 hash.                                                            |
| 2   | Worked-with detection | **System-inferred** from `project_assignments`. Same project at any point in the cycle. Snapshot on the review row at submit time.                        |
| 3   | Question source       | **Hard-coded in code (v1)**, schema is question-key-based so future admin-editing requires zero migrations.                                               |
| 4   | Submission scope      | **Anyone-on-anyone** in the org, except self. Deactivated users excluded.                                                                                 |
| 5   | Viewing rules         | **Self + direct mentees** (one level down). **Management** (Admin AND `is_management=true`) sees all. **Plain Admin sees nothing.**                       |
| 6   | Cycle window          | **Always open during the active FY.** Locks at FY end.                                                                                                    |
| 7   | Content               | **Likert only**, 1–5. All questions optional; ≥1 rating required to submit.                                                                               |
| 8   | Display               | **Per-question stacked bars** (worked-with avg + not-worked-with avg). Buckets used as visual section headings only — no roll-up averages.                |
| 9   | Min reviewers         | **3 per group** before the corresponding bar is rendered (else placeholder).                                                                              |
| 10  | Lifecycle             | **Submit-once.** No edit, no withdraw.                                                                                                                    |
| 11  | Cycle granularity     | **Fiscal year (integer)**, e.g. `2026` = FY26-27. Independent of H1/H2.                                                                                   |
| 12  | Feature gate          | **`feedback_360` in per-org `enabled_features`** (same mechanism as `dashboard`/`goals`/etc.).                                                            |
| 13  | Notifications         | **None.**                                                                                                                                                 |
| 14  | Page                  | **New top-level sidebar entry** at `/feedback`.                                                                                                           |
| 15  | Tabs                  | **Give Feedback / My Feedback / Mentee Feedback / Org Feedback.** Mentee tab hidden when `has_mentees=false`; Org tab hidden unless `is_management=true`. |

---

## Question registry (hard-coded)

12 questions across 10 buckets. Stable `key` fields are what gets persisted on the answer rows so the question text can change later without breaking history.

| Order | Bucket           | Key                        | Text                                                                                                                  |
| ----- | ---------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1     | Collaboration    | `collab_inclusive_env`     | Creates a collaborative, inclusive environment that promotes open communication and welcomes new ideas                |
| 2     | Empathy          | `empathy_consideration`    | Shows genuine consideration for others as individuals, supports their wellbeing, and makes them feel valued           |
| 3     | Empowerment      | `empower_support_autonomy` | Provides the right level of support and autonomy while ensuring clarity of roles, expectations, and context           |
| 4     | Empowerment      | `empower_recognition`      | Recognizes contributions and gives credit where it is due                                                             |
| 5     | Equity           | `equity_fair_treatment`    | Treats people fairly, respects diverse perspectives, and ensures equal opportunity for all to contribute and be heard |
| 6     | Growth           | `growth_dev_feedback`      | Supports professional development, helps build new skills, and provides constructive and actionable feedback          |
| 7     | Impact           | `impact_outcomes`          | Drives meaningful outcomes, prioritizes high-value work, and reliably removes obstacles to progress                   |
| 8     | Values           | `values_integrity`         | Models company values in day-to-day interactions and operates with integrity, honesty, and transparency               |
| 9     | Communication    | `comm_clarity`             | Communicates clearly, shares information in a timely manner, and is approachable for open dialogue                    |
| 10    | Communication    | `comm_alignment`           | Ensures alignment and smooth coordination across work and stakeholders                                                |
| 11    | Core Expertise   | `core_expertise`           | Demonstrates strong core skills and upholds high standards of quality, documentation, and deliverables                |
| 12    | Domain Knowledge | `domain_knowledge`         | Has strong domain knowledge and applies it to solve problems, enable others, and improve outputs                      |

Lives in `backend/app/feedback_360/questions.py`:

```python
@dataclass(frozen=True)
class FeedbackQuestion:
    key: str       # stable identifier; never changes once shipped
    bucket: str    # display grouping
    text: str      # current copy (mutable)
    order: int     # render order

FEEDBACK_QUESTIONS: list[FeedbackQuestion] = [...]  # 12 entries above
```

Frontend mirrors via the `GET /feedback-360/questions` endpoint — never duplicates the list in JS.

---

## Anonymity scheme

### Hash construction

```python
import hmac, hashlib
def reviewer_hash(reviewer_id: int, target_id: int, fy_year: int) -> str:
    msg = f"{reviewer_id}|{target_id}|{fy_year}".encode("utf-8")
    return hmac.new(settings.FEEDBACK_HASH_SECRET.encode("utf-8"),
                    msg, hashlib.sha256).hexdigest()
```

- `FEEDBACK_HASH_SECRET` is a new env var (≥32 random bytes). Required at boot — fail fast if missing.
- Never written to logs, error responses, or audit trails.
- Same `(reviewer_id, target_id, fy_year)` always produces the same hash → enforces "one review per reviewer per target per FY" via `UNIQUE(target_user_id, fy_year, reviewer_hash)`.

### Threat model — what this protects against

| Attacker capability                            | Outcome                                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reads DB rows only                             | Sees an opaque 64-char hash. Cannot identify the reviewer. ✅                                                                                                                    |
| Reads DB + backend code                        | Knows the algorithm, but without the secret cannot reverse the hash. ✅                                                                                                          |
| Reads DB + code + env (`FEEDBACK_HASH_SECRET`) | Can brute-force: iterate over all org users, compute hash, look up. ⚠️ Detectable via secret-access logs if secrets are managed via a vault. Not preventable in pure-app crypto. |

This is the same level of anonymity that real-world enterprise 360 tools provide. Documented in the route module's docstring so the limitation is explicit.

### What never leaves the backend

- `reviewer_id` is consumed in the request handler to compute the hash, then dropped before the row is written.
- API responses never include `reviewer_id` or anything derivable from it.
- The frontend never receives a per-row identifier of the reviewer; the only thing tied to a reviewer is their own "Have I reviewed X?" check, which is computed server-side from the JWT.

---

## Data model

Two new tables. No changes to existing tables.

### `feedback_360_reviews`

| Column           | Type                      | Notes                                          |
| ---------------- | ------------------------- | ---------------------------------------------- |
| `id`             | BIGSERIAL PK              |                                                |
| `org_id`         | int FK → organizations.id | Tenant isolation; every query filters on this. |
| `target_user_id` | int FK → users.id         | The person being reviewed.                     |
| `fy_year`        | int                       | Cycle key (e.g. 2026 = FY26-27).               |
| `reviewer_hash`  | char(64) NOT NULL         | HMAC-SHA256 hex.                               |
| `worked_with`    | bool NOT NULL             | Snapshot at submit time.                       |
| `created_at`     | timestamptz default now() |                                                |

**Constraints:**

- `UNIQUE(target_user_id, fy_year, reviewer_hash)` — enforces one-per-reviewer-per-target-per-FY at the DB level.
- `INDEX(target_user_id, fy_year)` — feeds the aggregate query.
- `INDEX(org_id)` — tenant scope.

### `feedback_360_answers`

| Column         | Type                                               | Notes                                |
| -------------- | -------------------------------------------------- | ------------------------------------ |
| `id`           | BIGSERIAL PK                                       |                                      |
| `review_id`    | int FK → feedback_360_reviews.id ON DELETE CASCADE |                                      |
| `question_key` | text NOT NULL                                      | Matches `FEEDBACK_QUESTIONS[i].key`. |
| `rating`       | smallint NOT NULL CHECK (rating BETWEEN 1 AND 5)   |                                      |

**Constraints:**

- `UNIQUE(review_id, question_key)` — one rating per question per review.
- `INDEX(review_id)`.

Skipped questions = no row. Backend treats absent rows as "no opinion", excluded from averages.

---

## Backend

### New files

| Path                                                   | Role                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `backend/app/feedback_360/__init__.py`                 | (empty)                                                                               |
| `backend/app/feedback_360/questions.py`                | `FEEDBACK_QUESTIONS` registry + `FeedbackQuestion` dataclass.                         |
| `backend/app/services/feedback_360_service.py`         | `reviewer_hash()`, `did_work_together()`, `current_active_fy()`, `can_view_target()`. |
| `backend/app/api/routes/feedback_360_routes.py`        | All HTTP routes.                                                                      |
| `backend/app/models/feedback_360_models.py`            | `Feedback360Review`, `Feedback360Answer` SQLAlchemy models.                           |
| `backend/app/schemas/feedback_360_schemas.py`          | Pydantic request/response shapes.                                                     |
| `backend/migrations/versions/<id>_add_feedback_360.py` | Alembic migration creating both tables.                                               |

### Routes (all under `/api/v1/feedback-360`, mounted in `main.py`)

| Method | Path                          | Auth                       | Returns                                                                                                                                                                                                                          |
| ------ | ----------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/questions`                  | Authed                     | The hard-coded question list (key, bucket, text, order).                                                                                                                                                                         |
| `GET`  | `/peers`                      | Authed                     | List of org users (excl. self + deactivated). Each: `{user_id, full_name, designation_name, has_submitted, worked_with}` for the active FY. `has_submitted` is computed by hashing `(viewer_id, peer_id, fy)` and looking it up. |
| `POST` | `/reviews`                    | Authed                     | Submit a review. Body: `{target_user_id, ratings: {question_key: 1..5, ...}}`. Backend rejects on: self-review, deactivated target, empty ratings, FY closed, duplicate (409 from UNIQUE). Returns 204.                          |
| `GET`  | `/aggregate/{target_user_id}` | Authed + `can_view_target` | The aggregate. Per question: `{question_key, bucket, worked_with: {count, avg} \| null, not_worked_with: {count, avg} \| null}`. A group is `null` when its count < 3. Backend also returns `total_reviews` for context.         |

### `can_view_target(viewer, target)`

```python
def can_view_target(viewer: User, target_user_id: int, db: Session) -> bool:
    if viewer.id == target_user_id:
        return True
    # Direct mentor — viewer is one level above target
    target = db.query(User).filter(User.id == target_user_id,
                                    User.org_id == viewer.org_id).first()
    if target is None:
        return False
    if target.mentor_id == viewer.id:
        return True
    # Management override
    if viewer.role == "Admin" and viewer.is_management:
        return True
    return False
```

Plain admins (`is_management=False`) hit the final `return False`. Tested explicitly.

### `did_work_together(reviewer_id, target_id, fy_year)`

SQL pattern: existence check on `project_assignments` joined to itself by `project_id`, where one side has `user_id=reviewer_id`, the other `user_id=target_id`, and both rows reference a `cycle` whose FY token matches `fy_year`.

```python
SubA = aliased(ProjectAssignment)
SubB = aliased(ProjectAssignment)
exists = (
    db.query(SubA.project_id)
      .join(SubB, SubA.project_id == SubB.project_id)
      .filter(SubA.user_id == reviewer_id,
              SubB.user_id == target_id,
              extract_fy_from_cycle(SubA.cycle) == fy_year,
              extract_fy_from_cycle(SubB.cycle) == fy_year)
      .first()
)
return exists is not None
```

`extract_fy_from_cycle` is a SQL-side equivalent of the existing Python `extract_fy_token` util — implemented as a Python-side filter post-fetch in v1 if SQL extraction is fiddly. Optimization can come later.

### Active FY derivation

Reuse `app/core/cycle_utils.current_half_and_fy(now, settings)` — already exists. Take the `fy_year` integer from its return.

### Config change

`backend/app/core/config.py`:

```python
FEEDBACK_HASH_SECRET: str  # required, no default
```

---

## Frontend

### New files

| Path                                                    | Role                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/pages/Feedback360.tsx`                    | The page with four tabs.                                                                                                              |
| `frontend/src/components/feedback360/PeerList.tsx`      | Browseable list of org users with submit-status pill + worked-with chip.                                                              |
| `frontend/src/components/feedback360/ReviewModal.tsx`   | Modal form. Likert 1–5 row per question, grouped by bucket. Each row has a "Skip" pseudo-option. Submit disabled until ≥1 rating set. |
| `frontend/src/components/feedback360/AggregateView.tsx` | Renders the per-question stacked bars. Below 3 → "Not enough reviewers yet" placeholder per group.                                    |
| `frontend/src/services/feedback360.service.ts`          | `getQuestions()`, `getPeers()`, `submitReview(target_id, ratings)`, `getAggregate(target_id)`.                                        |

### Edits to existing files

| Path                               | Change                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `frontend/src/App.tsx`             | New `<Route path="/feedback" …>` inside `ProtectedRoute requiredFeature="feedback_360"`. |
| `frontend/src/layouts/Sidebar.tsx` | New entry "360 Feedback" gated on the same feature.                                      |

### Tab visibility

```tsx
const isMgmt = user?.is_management ?? false;
const hasMentees = user?.has_mentees ?? false;

<Tabs>
  <Tab id="give">Give Feedback</Tab>
  <Tab id="my">My Feedback</Tab>
  {hasMentees && <Tab id="mentees">Mentee Feedback</Tab>}
  {isMgmt && <Tab id="org">Org Feedback</Tab>}
</Tabs>;
```

Reuses existing `useAuth()` hook; no new claims plumbing needed (`is_management` and `has_mentees` already in `SessionResponse`).

### Aggregate view rendering

For each question, two horizontal rows under a bucket heading:

```
COLLABORATION
  Creates a collaborative, inclusive environment...
  Worked with     ████████████░░░░  4.2  (8)
  Not worked with ░░░░░░░░░░░░░░░░  —    (1, hidden — need 3+)
```

Worked-with bar uses `bg-brand`. Not-worked-with bar uses `bg-amber-500`. Below threshold → "Not enough reviewers" muted-text placeholder, no bar.

---

## Edge cases & decisions

- **Reviewer or target deactivated mid-cycle.** Existing reviews stay (hash-anonymous, no PII to scrub). New reviews on a deactivated target rejected with 400. Reviewers, even if later deactivated, can't be retroactively identified anyway.
- **Mentor relationship changes mid-cycle.** Viewing rules check the _current_ `mentor_id` at view time (consistent with how MyMentees and other features work). A new mentor immediately gets visibility into their new mentee's existing reviews.
- **Worked-with snapshot is wrong if reviewer submits before being staffed onto a shared project.** Accepted tradeoff. With submit-once + always-open window, most reviewers will submit late in the cycle when the picture is clear. Documented in the service module's docstring.
- **Question text changes mid-cycle.** Old answers still join correctly because they reference `question_key`, not text. The aggregate renders whatever `text` the registry currently has.
- **Bucket renamed.** Same — `bucket` is part of the question registry, not stored on answers. Renaming is a code change with no data impact.
- **Min-reviewer threshold gaming.** A target who realizes only 2 "not worked with" reviewers have submitted will see no bar. They cannot tell whether the rating is high or low. Anonymity preserved.

---

## Migration plan

1. Apply Alembic migration: creates both tables + indexes + UNIQUE constraints.
2. Add `FEEDBACK_HASH_SECRET` to env (`.env`, Render config, etc.). Generate via `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
3. Add `feedback_360` to `enabled_features` of any org that should get the module (DB UPDATE; or via the existing admin tooling if it exposes feature flags).
4. Deploy backend (loads new routes, validates secret on boot).
5. Deploy frontend (renders new sidebar entry + page when feature is enabled).

No data backfill required. First reviews can be submitted immediately after step 3 lands.

---

## Files modified / created

### Created

- `backend/app/feedback_360/__init__.py`
- `backend/app/feedback_360/questions.py`
- `backend/app/services/feedback_360_service.py`
- `backend/app/api/routes/feedback_360_routes.py`
- `backend/app/models/feedback_360_models.py`
- `backend/app/schemas/feedback_360_schemas.py`
- `backend/migrations/versions/<id>_add_feedback_360.py`
- `frontend/src/pages/Feedback360.tsx`
- `frontend/src/components/feedback360/PeerList.tsx`
- `frontend/src/components/feedback360/ReviewModal.tsx`
- `frontend/src/components/feedback360/AggregateView.tsx`
- `frontend/src/services/feedback360.service.ts`

### Modified

- `backend/app/core/config.py` — add `FEEDBACK_HASH_SECRET`.
- `backend/app/main.py` — wire the new router.
- `frontend/src/App.tsx` — new route, feature-gated.
- `frontend/src/layouts/Sidebar.tsx` — new sidebar entry.

---

## Verification

After implementation, walk through these manually with the dev server running:

1. **Unauth access** — log out, hit `/feedback`. ProtectedRoute bounces to `/login`. ✓
2. **Feature gate** — log in as a user in an org without `feedback_360` enabled. Sidebar entry hidden; direct nav to `/feedback` redirects to `/unauthorized` (existing requiredFeature behavior). ✓
3. **Give feedback** — log in as employee A. Open Give Feedback tab. Pick employee B (with whom A is on the same project). Open the modal, fill ratings on 3 of 12 questions, submit. DB has one new row in `feedback_360_reviews` with `worked_with=true` and three rows in `feedback_360_answers`. ✓
4. **Inspect anonymity** — query `SELECT * FROM feedback_360_reviews` directly. Confirm: no `reviewer_id` column exists, only `reviewer_hash`. ✓
5. **Duplicate review blocked** — A tries to submit on B again in the same FY. Backend returns 409 (UNIQUE violation). ✓
6. **Empty submit blocked** — open modal, click Submit without rating anything. Frontend disables the button; backend also rejects with 400 if forced. ✓
7. **Self-review blocked** — try to POST `target_user_id = self`. 400. ✓
8. **Worked-with split** — have ≥3 reviewers on the same project as B submit, and ≥3 reviewers NOT on any project with B submit. View `My Feedback` as B → both bars render per question. ✓
9. **Below threshold hidden** — only 2 not-worked-with reviewers submit. The not-worked-with bar shows "Not enough reviewers yet" instead of a value. ✓
10. **Viewing rules** —
    - As B: see own aggregate ✓
    - As B's direct mentor: see B's aggregate ✓
    - As B's mentor's mentor (transitive): 403 ✓
    - As random peer of B: 403 ✓
    - As plain Admin: 403 ✓
    - As Management Admin: 200 ✓
11. **Mentee tab visibility** — as a user with no mentees, the Mentee Feedback tab is not rendered. ✓
12. **Org tab visibility** — as plain Admin, no Org tab. As Management, Org tab renders with org-wide search/list. ✓
13. **FY closure** — manually force FY+1 (advance system date or override active_cycle_name). Submit attempt rejected with 400 "FY closed". ✓
14. **Hash determinism** — back-end unit test: `reviewer_hash(7, 12, 2026)` returns the same value across two invocations. ✓
15. **Question registry** — `GET /feedback-360/questions` returns 12 entries in the documented order with the documented buckets. ✓
