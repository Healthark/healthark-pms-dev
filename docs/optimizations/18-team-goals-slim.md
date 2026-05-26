# Payload reduction PR B — Drop review text bodies from /goals/team

> Second of three payload-reduction PRs. Trims the mentor's Team Goals
> list payload by ~30–40% by sending only `cycle_half` + `is_draft`
> per review row instead of the full text bodies. The mentor-review
> modal fetches the full goal on open to populate the read-only
> self-review pane + pre-fill the mentor textarea.

## Context

`GET /goals/team` returns one `TeamGoalResponse` per goal owned by
each of the mentor's mentees. Each goal carries inline arrays:

- `self_reviews: GoalSelfReview[]` — one row per FY half, with the
  mentee's full free-form `self_overall_review` text (up to 10 kB
  per row in Pydantic's `max_length`).
- `mentor_reviews: GoalMentorReview[]` — one row per half, with the
  mentor's full `mentor_overall_review` text (same shape, same limit).

**Nothing on the Team Goals table view reads these text bodies.** The
table renders id, owner, title, status, progress. The
`SelfReviewCycleMenu` reads only `cycle_half` and `is_draft` to render
its Submitted / Draft / Missing indicators. The actual review text
is only rendered inside the `GoalMentorReviewModal`, which opens on
click — so it can fetch on demand.

After PR A (gzip compression) landed, the raw wire payload is already
~70% smaller on every endpoint. But `/goals/team` still carries
review text bodies that nothing on screen reads. This PR drops them
from the list response (~6–8 kB raw / ~2 kB gzip saved per mentor
session with ~45 mentee goals).

## Code change

### Backend

Two new slim Pydantic schemas in `backend/app/schemas/goal_schemas.py`:

```python
class GoalSelfReviewSlim(BaseModel):
    cycle_half: SelfReviewCycleHalf
    is_draft: bool = False
    model_config = ConfigDict(from_attributes=True)

class GoalMentorReviewSlim(BaseModel):
    cycle_half: SelfReviewCycleHalf
    is_draft: bool = False
    model_config = ConfigDict(from_attributes=True)
```

And `TeamGoalListResponse` overrides the two review arrays in
`TeamGoalResponse` to use the slim subtypes:

```python
class TeamGoalListResponse(TeamGoalResponse):
    self_reviews: list[GoalSelfReviewSlim] = []
    mentor_reviews: list[GoalMentorReviewSlim] = []
```

The route at `backend/app/api/routes/goal_routes.py` changes its
`response_model` from `List[TeamGoalResponse]` to
`List[TeamGoalListResponse]`. No query change — the existing
`lazy="joined"` on the model still loads the relationships into
Python; Pydantic serializes only the fields defined in the slim
schema, dropping the text bodies.

The per-goal detail endpoint `GET /goals/{goal_id}` is unchanged and
keeps returning the full `GoalResponse` with all review text.

### Frontend

Three small additions:

- `goal.service.ts`: new `getGoal(goalId): Promise<Goal>` calling `GET /goals/{id}`.
- `queries/goals.ts`: new `useGoalDetail(goalId | null)` hook + `goalDetailQueryKey(id)`. Gated by `enabled: goalId !== null` so it only fires when the modal mounts.
- `components/goals/GoalMentorReviewModal.tsx`: uses `useGoalDetail(isOpen ? goal.id : null)` to fetch the full goal on modal open. Replaces the prior `goal.self_reviews.find(...)` + `goal.mentor_reviews.find(...)` reads with `detail.self_reviews.find(...)` + `detail.mentor_reviews.find(...)`. Adds a loading indicator in the left (self-review) panel while detail is in flight. Re-seeds the mentor textarea once detail arrives so the textarea doesn't clobber input mid-load.

`SelfReviewCycleMenu` (the dropdown attached to each team-tab row)
is untouched — it only reads `cycle_half` + `is_draft` which are
present in the slim shape.

### TypeScript types intentionally unchanged

The `Goal.self_reviews: GoalSelfReview[]` type still describes the
full shape. The runtime contract becomes "list responses send slim
rows; detail / mine / mentee-detail responses send full rows" — but
the only consumer that reads the heavy text fields (the mentor modal)
explicitly fetches via `useGoalDetail`. Other consumers
(`SelfReviewCycleMenu`, `MenteeAnnualSummaryTab`, `GoalSelfReviewModal`)
either read from full-shape sources or only access `cycle_half` /
`is_draft` which are in both shapes. No type-level lying that affects
correctness; an explicit `TeamGoalSlim` TS type would be a separate
cleanup PR.

## Expected wire savings

Per goal, the slim representation drops:
- `self_overall_review` text (~150–500 bytes typical, up to 10 kB)
- `mentor_overall_review` text (same shape)
- `id`, `goal_id`, `submitted_at` on each review row (~80 bytes per row)

For a mentor with 45 goals × ~2 review rows per goal × ~250 bytes
saved per row: **~22 kB raw saved per Team Goals load**, before gzip.
Combined with the gzip middleware from PR A: **~6–7 kB gzipped saved**
on the wire.

## Frontend impact

- One new round-trip the first time a mentor opens the mentor-review modal on a given goal in a session (`GET /goals/{id}`). TanStack caches it; subsequent opens are 0 requests.
- Loading indicator appears in the modal's left (self-review) panel for ~150–300 ms on first open.
- Mutation invalidations from D1 still hit the new `['goals', 'detail', id]` keys via the top-level `['goals']` broadcast — submitting a mentor review refetches both the list AND any open detail.

## Test Cases (manual, pre-merge)

Run through this checklist with a mentor account that has at least one
mentee with an approved annual goal and a submitted H1 self-review.

### Setup
1. Restart the backend so the new schema loads.
2. Restart the frontend dev server.
3. Sign in as a mentor.

### Slim list response
4. Open DevTools → Network. Navigate to `/annual-goals` → Team Goals tab.
5. Click the `GET /api/v1/goals/team?goal_type=annual` request → Response tab.
6. **Confirm the response JSON** for each goal contains `self_reviews` and `mentor_reviews` arrays where each item has **only** `cycle_half` and `is_draft` fields — no `self_overall_review`, `mentor_overall_review`, `id`, `goal_id`, or `submitted_at`.
7. Compare the response Size column to the pre-PR baseline if you have it — should be ~30–40% smaller raw, ~10–15% smaller gzipped (gzip already crunched a lot of the repetition).

### Team table renders correctly
8. The Team Goals table renders all rows: owner name, title, FY year, status badge, progress.
9. Expand a goal row → criteria checklist renders. No errors in the console.
10. The "Self Reviews" / "Reviews" dropdown on each approved goal row shows the correct **submitted / draft / not-submitted** indicators — confirms `cycle_half` + `is_draft` are still in the slim payload.

### Modal happy path
11. On an **approved** goal where the mentee has submitted H1 self-review, click the "Reviews" dropdown → pick H1.
12. Modal opens. Network tab: confirm exactly **1× `GET /api/v1/goals/{id}`** fires.
13. While the request is in flight (~150 ms), confirm the left "Mentee Self Review" panel shows a **"Loading review…"** spinner.
14. Once the request settles, the mentee's full self-review text appears in the left panel. The right panel's textarea is **empty** (no prior mentor review on this half) and editable.
15. Type "Excellent execution on the H1 milestones." in the textarea.
16. Click **Save Draft**. Toast appears. The mutation invalidates `['goals']` → list refetches → `is_draft: true` flag on the new draft row appears in the dropdown indicator.
17. Close the modal. Reopen the same H1 review → **0 new requests** (cache hit). Textarea pre-fills with the draft text.
18. Click **Submit Review**. Mutation invalidates the goal detail too → on subsequent opens the row shows as submitted (not draft).

### Modal — no self-review case
19. On an approved goal where the mentee has **not** submitted H2 self-review, click Reviews → H2.
20. Modal opens. After detail loads, left panel shows "The mentee has not submitted their self-review for this half yet." Right panel shows the amber "You can only submit a mentor review once the mentee has submitted their self-review" warning. No textarea, no submit button.

### Cross-domain invalidation still works
21. Approve a new goal (or trigger any goals mutation). Confirm:
    - The Team Goals list refetches (slim payload).
    - The Dashboard summary counters refresh.
    - The Mentees aggregate (`['mentees']` broadcast from D4) refreshes if a MenteeDetail page is mounted.

### Negative checks
22. Confirm that on a goal where you just submitted a mentor review, reopening the modal shows the submitted text in the (now read-only) right panel — confirms `useGoalDetail` is the source of truth for the text, not the (slim) list.
23. Inspect the list response JSON one more time. Confirm no `self_overall_review` or `mentor_overall_review` fields appear under any goal. (If they do, the schema override didn't take effect — investigate.)
24. With the backend restarted, confirm the FE doesn't crash on:
    - A mentee with 0 approved goals (empty team list).
    - A mentee with 1 approved goal but no self-review yet (slim arrays empty).
    - A goal where the mentor draft was saved before this PR shipped (data is fine; the detail endpoint returns the full text on open).

## Risks

- **One extra round-trip on first modal open.** ~150–300 ms on a fast connection. Cached after that. Acceptable for a click-to-open modal.
- **Inline assertions in the schema.** The `# type: ignore[assignment]` on the slim override of `self_reviews` / `mentor_reviews` is intentional — Pydantic v2 supports field type override in subclasses, but mypy/Pyright may flag the variance. The runtime behaviour is correct.
- **TypeScript types describe full shape regardless of source.** Documented above; non-issue at runtime but a minor lie at compile time. Could be cleaned up by introducing `TeamGoalListItem` TS type in a follow-up PR.

## Related artifacts

- PR A (gzip compression): `docs/optimizations/17-gzip-compression.md`
- Phase D close-out: `docs/optimizations/15-tanstack-profile.md`
- F1 (optimistic updates): `docs/optimizations/16-optimistic-updates.md`
- Plan source: `C:\Users\Dell\.claude\plans\phase-a-optimization-melodic-sketch.md`
- Next PR (C): split `/mentees/{id}/detail` into sub-resources.
