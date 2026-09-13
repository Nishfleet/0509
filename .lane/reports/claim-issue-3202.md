# Lane report — issue #3202: Reddit mentions into the mention table (split of #3171)

Branch: `claim/issue-3202`
Base: `origin/main` at `56a3e3f1` (merge of #3399) — the 3 prior `wip(salvage)` commits rebased onto it CLEAN (no conflicts)
Unit: `pi-issue-0509-3202`

## What the issue needed, and what the salvage trail had

Both blocked-ons were resolved before pickup: #3178 (mention table + adapter
interface + the mention-query adapter that feeds this connector) merged as
#3339 on 2026-09-13T04:50Z; fleet-ops#5806 (the split-release gate) closed
2026-09-13T16:37Z — the same resolutions #3200's lane recorded, and #3200
plus #3204 (the sibling slices) landed through the same gate as #3399/#3402.

Re-entrancy by salvage: this unit died 3 times post-build, pre-PR
(success/0 → exit-code/1 → StartLimitBurst → success/0, 16:38Z–19:50Z).
Each death banked a `wip/pi-issue-0509-3202-*` branch; the cumulative diff
survived in 3 `wip(salvage)` commits on the claim branch:

- `app/lib/presence-connectors/reddit.server.ts` (+550) — the connector;
- `tests/integration/reddit-mention-connector.integration.test.ts` (+590, 17 its);
- `app/lib/presence-source-coverage.server.ts` — the honest coverage note;
- `app/lib/presence-connector-registry.server.ts` — 1 call-site line;
- `tests/status.route.test.ts` — the /status row pin.

Missing when this run picked up: the PLAN.md collector research (the issue's
`required:` line), this lane-evidence record, any push, any PR, any
verification. This run inherited the diff, did NOT re-derive it, verified it
on the real artifact (below), and shipped those four missing pieces.

## What shipped (the smallest durable delta — the adapter, its proof, its note, its row)

- `app/lib/presence-connectors/reddit.server.ts` — the Reddit Data API
  mention connector: POST `https://www.reddit.com/api/v1/access_token`
  (OAuth2 `client_credentials`, env-held `REDDIT_CLIENT_ID`/`SECRET` = ONE
  fleet principal, 10s timeout, 401 drops the cached token and re-grants),
  then GET `https://oauth.reddit.com/r/<sub>/new?limit=100&raw_json=1` for a
  tracked subreddit target. The documented **1,000 reads / 10 minutes**
  (100 QPM averaged over a 10-minute window — Data API Wiki) is enforced
  IN-CONNECTOR: the usage counters live in `presence_poll_cursor.cursor_json`
  (`redditUsage`), are summed across EVERY reddit target before any fetch
  (one env-held client = one fleet principal), and exceed → the poll is
  refused with `reddit_rate_budget` WITHOUT sending a read. It is a
  10-minute TUMBLING window; every attempted read counts (successes AND
  failures — no documented empty-results exemption; Threads precedent: a
  dropped request is counted); the grant request itself is not counted (the
  allowance meters Data API reads). 429 → `rate_limited`, 5xx →
  `reddit_api_error`, never fabricated items. Capture-validity by the house
  convention (gdelt/threads precedent): only a normalizable public http(s)
  `www.reddit.com` post permalink becomes the `canonicalUrl`
  (`normalizePublicHttpUrl`); anything else is skipped, never stored, never
  bot-fetched; `presenceContentHash` for revision-identity;
  `raw` carries the free engagement signals (score, num_comments). Free
  engagement rides the item; the mention table's `raw_json` carries it.
  `PRESENCE_REDDIT_MOCK=1` keeps the ORCHESTRATED warm-up hops on a fixture —
  they ride `pollOnce` without usage accounting; the dispatched polls are
  what the ledger meters.
- `app/lib/presence-connector-registry.server.ts` — ONE call-site line: the
  reddit dispatch now hands the target, `poll(ctx, target)`, because the
  usage ledger (`readRedditUsage`) is keyed by `source_target_id`. The
  shared interface (`presence-types.ts`) untouched; ZERO migrations. The
  #3204 precedent's registry line, same class.
- `app/lib/presence-source-coverage.server.ts` — the reddit docs note, ONE
  string, to honest-coverage parity: what the public surface covers (the new
  posts of tracked subreddit targets — engagement rides the item; NOT
  covered: comments, PMs, historicals, non-post votes), the enforced
  1,000-reads/10-minutes budget (100 QPM averaged, Data API Wiki) and that
  it is shared by the one fleet OAuth client, the unchanged gate sentence
  (`PRESENCE_REDDIT_ROLLOUT` + `REDDIT_CLIENT_ID/SECRET` +
  `REDDIT_COMMERCIAL_ACCESS=approved` — off by default; activation is a
  separate rollout decision). The #1378 access-gate trio already governs
  reddit — this diff does NOT touch `presence-access-gates.server.ts`.
- `tests/integration/reddit-mention-connector.integration.test.ts` (NEW, 17
  its, workers project, real workerd/D1, real migrations, hermetic fixture
  fetch via the registry's `options.fetchImpl` — no DNS, no real network):
  registration + the docs-coverage note; `validateTarget` (accepts a
  subreddit, strips `r/`, stays offline; rejects a missing one); the REAL
  dispatched path (grant → read → `pollPresenceTarget` →
  `upsertPresenceItems` → >=1 mention into `presence_item`, the stored row's
  `connector_id`/`external_id`/`canonical_url` = the post's www.reddit.com
  permalink, and a SECOND identical dispatched poll still leaves exactly 1
  live row — urlHash dedup by canonical URL); the token cache (grant once,
  reuse across polls; 401 → drop + re-grant); 429/5xx mapped, never
  fabricated; the rollout-off refusal BEFORE any fetch (zero hops, zero
  rows); the budget (a closed window older than 10 minutes is ignored;
  counted usage recorded in the cursor and enforced; an EMPTY listing still
  counts — no documented free-read exemption; the block WITHOUT a read; the
  fleet-wide share — another workspace's usage counts);
  `healthCheck` (pending while the rollout is unset, degraded when the API
  does not answer); the presence substrate on real migrations.
- `tests/status.route.test.ts` — the /status reddit tracked-source row:
  `productionStatus` pinned `"gated"`, the note rendered verbatim ("tracked
  subreddit targets") — the #3202 acceptance, test-pinned, #3384's
  mechanism.
- `docs/mentions/PLAN.md` — §8 gains "Reddit, #3202 (2026-09-13)": the
  required searched + rejected collector research (see `research:` in the
  PR; adopted NOTHING — the official Data API the connector's app-only
  client-credentials grant already authenticates).

## Issue acceptance, evidenced

- "e2e fixture returns >=1 mention (or the documented no-surface entry)":
  integration it "captures >=1 mention into presence_item through the real
  registry dispatch" — the hermetic fixture dispatched through the REAL
  `pollPresenceTarget` → `upsertPresenceItems` inserts >=1, exactly 1 live
  row, `canonical_url` = the post's permalink. (No-surface exclusion N/A:
  Reddit HAS a lawful public surface — the Data API, cited in PLAN.md §2/§8
  — so the flag-off exclusion stays unused.)
- "rate budget tested": the six-its budget describe — expiry of a closed
  window, counted usage recorded + enforced, the empty listing counts, the
  block without a read, the fleet-wide share (another workspace's usage
  counts).
- "/status per-source row": the status.route.test.ts pins (gated + the note
  verbatim) + integration it #2 (the catalog note, `productionStatus`
  "gated").
- "termination": captured (substrate it) + deduped by canonical URL (same
  it: second identical dispatched poll → still exactly 1) + behind a
  per-source kill flag (`PRESENCE_REDDIT_ROLLOUT`, disabled default,
  fail-closed — the rollout-off it: the poll refuses BEFORE any fetch;
  healthCheck pending) + capture-validity applies (gated polls never fetch;
  the house convention: non-`www.reddit.com`-permalink items are skipped,
  never stored, never fabricated) + the coverage note (its #2 + the route
  pin).
- "required — research existing open-source collectors first (cite searched
  + rejected)": PLAN.md §8's 2026-09-12 log (Data API Terms, Data API Wiki
  rate limits, Responsible Builder Policy) + THIS lane's fresh 2026-09-13
  searches, quoted in the PR's `research:` line and landed in PLAN.md §8 —
  adopted NOTHING.
- "no edits to the shared interface": `presence-types.ts` untouched; the
  #3178 mention-query adapter and the `presence_item` table REUSED, not
  edited; zero migrations; the flag gates pre-existed (#1378) and are not
  edited.
- "public surfaces only; no paid vendor": the Data API, $0 free tier, OAuth
  client-credentials, no paid vendor — PLAN.md §2's Reddit row, carried.
- Metric: mentions/brand/day from Reddit = `presence_item` rows per tracked
  entity via its registered subreddit targets (score/num_comments ride the
  item's `raw_json`); failure rate = `presence_poll_cursor.last_error_code`
  (`rate_limited` / `reddit_api_error` / `reddit_rate_budget`). Both
  observable today — no new machinery.

## Verification (this lane, on the diff — THIS session, post-rebase)

- `npx vitest run --configLoader runner --project workers
  tests/integration/reddit-mention-connector.integration.test.ts` → 17/17,
  exit 0, FIRST RUN (real workerd, real D1, real migrations). 11.76s.
- `npx vitest run --configLoader runner --project node --changed
  origin/main` → 192/192 across 17 files, exit 0. 14.20s. One suite at a
  time, `--maxWorkers` never passed (`VITEST_MAX_WORKERS=2` respected by
  environment), no coverage/typecheck locally — CI owns both; the targeted
  workers-project run covers the integration side because the diff touches
  tests/integration/**.
- `sgscan --base origin/main` → "No new security findings", exit 0.
- Test accounting: 17 integration its + 2 route-test extensions (the reddit
  row + the markup note) — 0 removed, no skips/`.only` — net positive, no
  `test-removal-justified` owed.

## Rescue notes for the next agent on this lane

- The 3 prior deaths were post-build, pre-PR: the work lived in the
  `wip(salvage)` bank. Pickup = rebase onto the updated claim branch +
  verify on the real artifact + ship the missing paper — NOT a rebuild.
- The worktree HAD usable node_modules this run (a prior run installed).
  If bare: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1
  npm ci --no-audit --no-fund`.
- The budget its persist FLEET-WIDE usage in `presence_poll_cursor` (test
  storage is per-FILE, not per-test): the substrate it() deletes the reddit
  ledger rows first to isolate. Keep that if you touch the file.
- Do NOT "fix" the missing `PRESENCE_REDDIT_ROLLOUT` line in
  wrangler.jsonc — the connector ships dark exactly like every prior source
  (rss #3250, #3200's precedent); activation (the epic's rollout call) is
  #3171's, not this issue's. A powered poll also needs
  `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` AND
  `REDDIT_COMMERCIAL_ACCESS=approved` (the #1378 written-approval gate).
- The mention stamp triple to assert lives on the stored row's
  `raw_json.mention` for the STAMPED connectors — the reddit connector is a
  target-registered source (the tracked subreddit IS the target), so its
  proof is the stored row's identity triple
  (`connector_id`/`external_id`/`canonical_url`) + the engagement signals
  in `raw`, NOT a `matchedPhrase` stamp.
