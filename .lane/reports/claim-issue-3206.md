# Lane report — issue #3206: Bluesky mentions into the mention table (split of #3171)

Branch: `claim/issue-3206`
Base: `origin/main` at `63b49c1f7` (merge of #3377)
Unit: `pi-issue-0509-3206`

## What the issue needed, and what main actually had

Both blocked-ons were resolved before pickup: #3178 (mention table + adapter
interface + mainstream news) merged as #3339 on 2026-09-13; fleet-ops#5806
(the split-release gate) closed 2026-09-13T16:37Z. The dedupe comment names
#3198 (the X split, still open, different source) — not this issue's work.

Deletion-first survey of the #3252-landed Bluesky connector (MVP source 3/3,
commit 5036afde0): the connector, the 0098 CHECK widen, the rollout +
credential gates, the coverage entry and a 397-line integration test were ALL
already on main. The gap was wiring, not machinery:

- The registry's dispatch (`pollPresenceTarget`) called
  `blueskyConnector.poll(ctx)` WITHOUT the source target. The connector's
  `poll(ctx)` ignored everything and returned `missing_match_phrase`.
- The live path, the exported `pollBlueskyMention(ctx, phrase)`, had ZERO
  production callers. Its own header comment ("the live poll path resolves the
  tracked entity's match phrase through pollBlueskyMention below") described an
  intention nobody executed.
- Net: every scheduled Bluesky poll answered `missing_match_phrase` — no
  mention was ever captured. The #3206 termination ("a tracked brand or person
  gets mentions from Bluesky captured") was NOT met on main, and nothing
  noticed because the #3252 integration test called `pollBlueskyMention`
  directly, never through the dispatch.

## What shipped (the smallest durable fix + the missing detector)

- `app/lib/presence-connectors/bluesky.server.ts` — `poll(ctx, target?)`
  resolves the match phrase from `target.targetKey ?? target.targetHandle`
  (what `validateTarget` stores) and delegates the live path to
  `pollBlueskyMention`. ONE poll body: the registry dispatch and any direct
  caller share the same gate, phrase normalization, session handling and rate
  budget. Mock path, bare-context fail-fast, and the fail-closed gating
  (connector_disabled / credentials_missing) are unchanged.
- `app/lib/presence-connector-registry.server.ts` — the bluesky dispatch
  branch passes the target. One line. No shared-interface edits:
  `presence-types.ts` untouched, no new migration (0098's CHECK widen already
  carries `'bluesky'`), no new env, no wrangler.jsonc change (the connector
  ships dark like rss/gdelt/threads — activation is the epic's separate
  rollout decision).
- `tests/integration/bluesky-mention-connector.integration.test.ts` — the
  detector, on real workerd/D1, following the mention-source-activation
  exerciseSource shape: `pollPresenceTarget` with a seeded `bluesky`
  source_target → ≥1 mention captured into `presence_item`; a second identical
  poll + upsert inserts 0 (deduped by canonical URL via
  `UNIQUE (source_target_id, url_hash)`); the rate budget pinned at 1 session +
  1 search per poll across two polls. Plus the MAX_PAGES=2 bound proof: a
  3-page fixture, exactly 2 searchPosts calls, the unconsumed continuation
  returned — a third page is never requested.
- `app/lib/presence-source-coverage.server.ts` — the bluesky coverage note now
  states what the public surface covers (AppView post search for the tracked
  match phrase, near-real-time; no engagement counts or follow-graph; the
  AppView index's completeness is Bluesky's) and the in-connector rate budget
  (1 authenticated session + at most 2 result pages of 100 per poll, polls
  serialized upstream) — parity with the gdelt/threads notes.
  `productionStatus` stays `"gated"` (pinned).

## Issue acceptance, evidenced

- "e2e fixture returns >=1 mention": the new dispatch test — 2 fixtures
  captured into `presence_item` through the REAL `pollPresenceTarget` path
  (before the fix this exact flow answers `missing_match_phrase`, 0 items).
- "deduped by canonical URL": second identical poll + upsert → 0 inserted,
  live-row count unchanged (urlHash dedup); the connector's canonicalUrl is the
  public bsky.app permalink, hashed by the shared `presenceUrlHash` path.
- "rate budget tested": 1 session + 1 search per poll (dispatch test, 2 polls
  = 2+2), and the 3-page fixture proves MAX_PAGES=2 (a third page is never
  requested; the continuation is returned, not dropped).
- "/status per-source row": `presenceSourceCoverageForDocs` bluesky entry with
  `productionStatus: "gated"` — pinned (pre-existing) — and the note itself now
  carries the what-it-covers + rate-budget honesty.
- "behind a per-source kill flag": `PRESENCE_BLUESKY_ROLLOUT`, disabled
  default, credential-gated on `BSKY_IDENTIFIER`/`BSKY_APP_PASSWORD` — both
  fail-closed, pinned.
- "capture-validity": fail-closed posture pinned — gated polls never fetch,
  credentials_missing answers before any request, a failed session = no
  unauthenticated search, an empty result set is honest (`ok: true, items:
  []`), healthCheck reports degraded, never fabricated.
- "required: research existing open-source collectors first (cite searched +
  rejected)": already documented — docs/mentions/PLAN.md §8 (openstream/
  open-social-media-monitoring 132★ stale; news-r/auritus 31★;
  gdelt/gdelt.github.io 79★ — none adopted; `@atproto/api` available, rejected,
  no dependency) + the connector's own `research:` header. This PR adopts
  nothing; it completes the shipped adapter.
- "no edits to the shared interface": `presence-types.ts` untouched; the
  connector's added parameter is optional and additive.
- Metric: mentions/brand/day = `presence_item` rows per tracked entity where
  `connector_id='bluesky'`; failure rate = `presence_poll_cursor.last_error_code`.

## Verification (this lane, on the diff)

- `npx vitest run --configLoader runner --project workers
  tests/integration/bluesky-mention-connector.integration.test.ts` → 21/21
  (both NEW tests green by name: the MAX_PAGES=2 bound proof and the
  registry-dispatch capture+dedup), exit 0.
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 146/146 across 14 files, exit 0. One suite at a time, `--maxWorkers` never
  passed, no coverage/typecheck locally (CI owns both; the workers-project
  targeted run covers the integration side because the diff touches
  tests/integration/**).
- `sgscan --base origin/main` → "No new security findings", exit 0.

## Rescue notes for the next agent on this lane

- The worktree starts WITHOUT a usable node_modules (0-bin shell):
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 npm ci
  --no-audit --no-fund` → 262 packages, 8s, then vitest works. The first
  `npx vitest` without it dies with ERR_MODULE_NOT_FOUND: RunnerError (npx
  pulls a foreign vite from the npx cache).
- The #3206/#3198 duplicate notice is informational only (cluster-size): #3198
  is the X slice, untouched here.
- Do NOT "fix" the missing PRESENCE_BLUESKY_ROLLOUT line in wrangler.jsonc —
  rss/gdelt/threads shipped dark the same way; activation (flag + the BSKY_*
  secret, which lives in the vault/wrangler secret, not the repo) is the
  epic's rollout decision, not this issue's.
