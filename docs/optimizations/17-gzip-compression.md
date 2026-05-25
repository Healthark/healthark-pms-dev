# Payload reduction PR A — Enable gzip compression globally

> First of three payload-reduction PRs. Single-line backend change
> with the highest ROI of the whole roadmap: ~70% smaller wire payload
> on **every** JSON response, with zero frontend changes.

## Context

Phase D landed the TanStack cache (reduces duplicate fetches) and F1
landed optimistic updates (reduces perceived latency). The next
performance axis is **wire size** — the bytes actually transferred
over the network on every request that does fire.

FastAPI ships responses uncompressed by default. The Starlette
`GZipMiddleware` adds standard gzip encoding to JSON responses above
a configurable threshold. The browser handles `Accept-Encoding: gzip`
automatically — no frontend change required.

Typical reductions for JSON payloads sit between 70% and 80%. Worth
shipping before any structural payload-reduction work (PRs B and C
below) because compression compounds with those wins — a payload
already trimmed by structure becomes ~30% of *that* on the wire.

## Code change

One file: `backend/main.py`.

```python
from fastapi.middleware.gzip import GZipMiddleware
# ...
app.add_middleware(GZipMiddleware, minimum_size=500)
```

Registered **before** the existing CSRF + CORS middlewares so it's the
innermost layer — it compresses the response body on the way out, then
CSRF and CORS append their headers around the already-compressed
payload. The order matters because Starlette runs middleware in
reverse-registration order on the response: innermost runs first.

The `minimum_size=500` threshold skips compression for responses
under 500 bytes — gzip overhead would dominate the savings on tiny
payloads (auth/session, dashboard summary, etc.).

## Expected wire savings

Typical reductions for our endpoints (text JSON compresses ~70-80%):

| Endpoint | Raw (typical) | Expected gzipped | Saving |
|---|---|---|---|
| `/admin/users` (100 users) | ~50 kB | ~15 kB | −35 kB |
| `/goals/team` (mentor, 45 goals) | ~18 kB | ~5.4 kB | −12.6 kB |
| `/mentees/{id}/detail` (typical) | ~10 kB | ~3 kB | −7 kB |
| `/annual-reviews/calibration` (100 rows) | ~15 kB | ~4.5 kB | −10.5 kB |
| `/feedback-360/peers` (100 peers) | ~10 kB | ~3 kB | −7 kB |
| `/project-reviews/pm-queue` (PM, 30 cards) | ~18 kB | ~5.4 kB | −12.6 kB |
| `/mentees/summary` (50 mentees) | ~12.5 kB | ~3.75 kB | −8.75 kB |

**Total across a typical session of these 7 endpoints: ~95 kB saved.**

Smaller endpoints (`/auth/session`, `/dashboard/summary` when slim,
`/settings/system`) stay uncompressed because they're under the
500-byte threshold — that's by design; the per-request overhead of
gzipping a 200-byte response isn't worth the saving.

## Frontend impact

Zero. Browsers send `Accept-Encoding: gzip` on every request by
default; the FE doesn't know or care that responses are now compressed.
No client-side decompression code needed — the browser handles it.

## Test Cases (manual, pre-merge)

Run through this checklist locally with the backend restarted (so the
new middleware loads):

1. **Restart the backend.** `Ctrl+C` the dev server, then `uvicorn main:app --reload` (or whichever launch command this repo uses).
2. **Open DevTools → Network. Filter by `XHR`.**
3. **Load `/admin`** (Admin panel). On `GET /api/v1/admin/users`:
   - Click the request row → Headers tab → Response Headers section.
   - Confirm `Content-Encoding: gzip` is present.
   - Confirm the "Size" column shows `transferred < resource` (e.g. `15.2 kB / 50.1 kB` — the smaller number first is the gzip size).
4. **Load `/annual-goals`** → Team Goals tab. On `GET /api/v1/goals/team`:
   - Same checks: `Content-Encoding: gzip`, transferred ≪ resource.
5. **Load `/my-mentees`**, then click a mentee. On `GET /api/v1/mentees/summary` and `GET /api/v1/mentees/{id}/detail`:
   - Same checks on both.
6. **Load `/feedback`** → Give Feedback tab. On `GET /api/v1/feedback-360/peers`:
   - Same checks.
7. **Load `/project-reviews`** → Evaluate Team tab. On `GET /api/v1/project-reviews/pm-queue`:
   - Same checks.
8. **Admin → Management Review** tab. On `GET /api/v1/annual-reviews/calibration`:
   - Same checks.
9. **Threshold negative check.** Reload the dashboard. On `GET /api/v1/dashboard/summary` (response is typically ~300 bytes):
   - Confirm `Content-Encoding` header is **NOT present** (response below the 500-byte threshold). This confirms `minimum_size=500` is honoured rather than gzipping everything.
10. **Auth flows.** Sign out and back in. POST `/api/v1/auth/login` returns a small body; should not be gzipped, and login should succeed normally (no CSRF or CORS regression).
11. **Mutation smoke test.** Approve a goal / submit a PM evaluation / change a management rating. Each mutation should:
   - Send the POST/PATCH and receive a 200 response.
   - The response body may or may not be gzipped depending on its size — either is fine. The FE's mutation hooks consume the parsed JSON; encoding is transparent.
12. **Across all the above:** confirm every page still renders identically to pre-PR. Compression is transparent to the FE.

### Spot-check the compression ratio
Pick the heaviest endpoint visible to you. The expected gzip ratio is
roughly 25–35% of raw size — JSON compresses well thanks to repeated
field names. If transferred / resource is much higher (say 60%+), the
response either had a lot of unique data (rare for our shapes) or the
middleware isn't engaging — investigate before merging.

## Risks

- **None functional.** `GZipMiddleware` is a standard, mature FastAPI/Starlette middleware.
- **CORS preflight unaffected.** OPTIONS preflight requests don't carry response bodies above the threshold, so gzip never engages on them. The CORS middleware (outermost) handles preflight before any other layer.
- **Reverse proxies/CDNs.** If this app sits behind nginx or a CDN that already does compression, the inner GZip would do redundant work. The CDN would typically decompress, then re-compress with brotli. Not harmful, but worth knowing — if the production deployment has CDN compression turned on, the app-level gzip can be removed.

## Related artifacts

- Plan source: `C:\Users\Dell\.claude\plans\phase-a-optimization-melodic-sketch.md`
- Next PR (B): drop `self_reviews` + `mentor_reviews` from `/goals/team`.
- Next PR (C): split `/mentees/{id}/detail` into sub-resources.
- F1 (optimistic updates): `docs/optimizations/16-optimistic-updates.md`
