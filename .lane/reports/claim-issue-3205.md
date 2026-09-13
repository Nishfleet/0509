# Lane evidence — claim/issue-3205 (Nishfleet/0509#3205)

Threads mentions → the mention table: closes the acceptance #3254's connector
PR (#3360) had not yet proven — the end-to-end capture (fixture mention →
`pollPresenceTarget` → `upsertPresenceItems` → `listPresenceItems`) with
canonical-URL dedupe and the capture-validity gates exercised on the FULL path,
plus the /status per-source row.

Delta only, per the disjoint-slice rule: the adapter, flag, registry, coverage
module and migration were landed by #3360 (7c95d7a28, verified ancestor of
origin/main) and are untouched — no shared-interface edits.

## Files

- MOD `tests/integration/threads-mention-connector.integration.test.ts` —
  +3 tests (25 total): the capture path through `pollPresenceTarget` →
  `upsertPresenceItems` → `listPresenceItems` (>=1 mention, exactly one live
  row, second identical poll does not multiply — dedupe by canonical URL
  via `presenceUrlHash(item.canonicalUrl)`); the kill flag (rollout unset)
  and the credential gate (token missing) both stop the poll through
  `pollPresenceTarget` with `connector_not_operational`, zero rows, no
  network hop. Runs BEFORE the 2,200-cap describe (same storage contract the
  cap suite's header note records — the cap sums every target's open window).
- MOD `app/routes/status.tsx` — the `/status` per-source row: a new
  "Tracked sources" block rendering `presenceSourceCoverageForDocs()`
  verbatim (label + productionStatus + the honest note), including the
  gated Threads row. Loader-only, pure, no probe, no D1, cannot throw; the
  measured "Core surfaces" doctrine is untouched (the legend says the
  posture comes from the catalog in code). Phrase-ban literals avoided
  ("unavailable" renders at runtime from the catalog, never as a route
  source literal).
- MOD `tests/status.route.test.ts` — the existing loader it() now also pins
  the Threads row as present-and-gated in the loader result; a new it()
  renders the REAL catalog through the component and asserts the Threads
  row, its "Meta app review" note, the legend, and that the whole catalog
  passes through untouched (GDELT + the runtime-only posture).
- MOD `docs/mentions/PLAN.md` — the honest-coverage table row now states
  that the catalog renders publicly on /status since #3205 (the coverage
  note on the public surface).

## Verification

- `npx vitest run tests/integration/threads-mention-connector.integration.test.ts`
  → 25/25 pass (22 shipped + 3 new; first run caught the shared 2,200-cap
  ordering, fixed by the describe order + the storage-contract note).
- `npx vitest run tests/status.route.test.ts tests/public-tree-phrase-ban.test.ts`
  → 14/14 pass (loader + the new component it + the phrase-ban scan).
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 24/24 pass (2 files).
- `npx vitest run --configLoader runner --project workers --changed origin/main`
  → 25/25 pass (the extended integration suite on real workerd).

## Research (issue-required: searched + rejected)

Existing open-source Threads collectors, searched 2026-09-13 (this lane):

- `gh search repos "threads api"`: `threadsjs/threads.js` (★275, official-API
  Node client) — rejected: Node-runtime patterns, full SDK for one GET
  endpoint, bypasses the SSRF-hardened `presenceSafeFetch`/bounded-response
  path every 0509 connector rides. `junhoyeo/threads-api` (★1621,
  unofficial) — rejected: reverse-engineered web-UI surface, undocumented,
  conflicts with the documented-public-surface posture. `fbsamples/threads_api`
  (★290) — Meta's sample app, not a reusable collector.
- `npm search threads keyword_search`: no Workers-native keyword_search
  client; the nearest are web-worker/thread-pool packages (name collision,
  unrelated).

Reuse decision: the collector IS the landed connector (#3360, 7c95d7a28) —
this issue adds its missing proof, not a second implementation.

## Acceptance mapping (issue #3205)

- e2e fixture returns >=1 mention — the new capture it(): 1 fixture mention
  reaches `presence_item` (the mention table) through the real poll→upsert→
  list path.
- rate budget tested — pre-existing: the five 2,200-queries/24h cap its in
  the same suite (shipped by #3360); unchanged, still green.
- /status per-source row — the "Tracked sources" block: every catalog
  source gets exactly one row; the Threads row renders `gated` with its
  honest note; pinned by the new component it() and the extended loader it().
- deduped by canonical URL — the capture it(): second identical poll+upsert
  leaves exactly one live row (`url_hash` = `presenceUrlHash(canonicalUrl)`).
- per-source kill flag + capture-validity gate — the two gate its(): both
  gates stop the FULL path with `connector_not_operational`, no fetch, zero
  rows.
- coverage note states what the public surface covers — PLAN.md's coverage
  row + the /status "Tracked sources" disclosure.
- required: research cited above; public surfaces only (documented
  `graph.threads.net` keyword_search, $0); no paid vendor; no edits to the
  shared interface (diff touches this source's tests, the coverage note and
  the /status acceptance only).

loose-ends: threads stays flag-off until Meta app review + the rollout call —
tracked on the PLAN.md #3254 row, not this PR.
