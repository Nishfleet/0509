# Lane report — issue #3200: Medium mentions into the mention table (split of #3171)

Branch: `claim/issue-3200`
Base: `origin/main` at `ac5602d4` (merge of #3387)
Unit: `pi-issue-0509-3200`

## What the issue needed, and what main actually had

Both blocked-ons were resolved before pickup: #3178 (mention table + adapter
interface + mainstream news) merged as #3339 on 2026-09-13T04:50Z;
fleet-ops#5806 (the split-release gate) closed 2026-09-13T16:37Z. The claim
branch existed from two earlierpi claims at 16:38Z/17:52Z with ZERO commits
(`rev-list --count origin/main..claim/issue-3200` = 0) — nothing to salvage;
re-entrancy satisfied by fast-forwarding the branch to origin/main.

Deletion-first survey: the #3200 slice needs NO new machinery. The #3250 rss
backbone (PR #3283, "publisher RSS + Substack + Medium + Google News query
feeds", commit-verified) already carries Medium `/feed/...` publication feeds
end to end: `medium.com/feed/...` registers as an rss `source_target`
(`connector_id` accepted since migration 0093), the dispatched poll fetches
the feed once through the SSRF-hardened `presenceSafeFetch` path, and
`upsertPresenceItems` runs `buildMentionStampPlan` →
`filterAndStampPublicationItems` — only items naming the tracked entity
(label + canonical domain + notes aliases) survive, stamped with
`mention.matchedPhrase`/`matchField` in `raw_json`. The kill flag
(`PRESENCE_RSS_ROLLOUT`, fail-closed, disabled default) shipped with the
connector. What was MISSING on main was the #3200 acceptance evidence:

- No integration test proves a MEDIUM-shaped publication feed captures a
  mention through the real dispatched path (`pollPresenceTarget` with a
  seeded `connector_id='rss'` row) — rss-mention-backbone proves the match
  mechanics on a generic publisher fixture but never dispatches the
  capture→dedup→bound→flag chain for this source;
- No second-identical-poll dedup proof (the UNIQUE (source_target_id,
  url_hash) key) for ANY feed — the #3386 Bluesky lesson, just over here;
- The documented rate budget (1 fetch per feed per poll, ≤25 items) was never
  pinned as a test;
- The rss coverage note was the last legacy-style note — it did not state
  what the public surface covers, unlike the bluesky/threads/hn/gdelt notes
  their own slices extended.

## What shipped (the smallest durable delta — tests + the coverage note, nothing else)

- `tests/integration/medium-mention-connector.integration.test.ts` (NEW,
  workers project, real workerd/D1, real migrations, IP-literal fixture host
  — no DNS, no real network) — 6 its:
  1. capture: the Medium publication-feed fixture (channel = the publication,
     items bylined) dispatched through `pollPresenceTarget` → 2 raw items →
     `upsertPresenceItems` inserts 1 — the story naming the entity, matched
     `matchedPhrase "Acme"` / `matchField "title"`, canonicalUrl = the story's
     own link; the weekend-roundup item that does not name the entity never
     becomes a row. THE "e2e fixture returns >=1 mention" clause.
  2. dedup: a second identical dispatched poll + upsert inserts 0 (same
     `presenceUrlHash(canonicalUrl)` → the UNIQUE (source_target_id,
     url_hash) key; identical content hash → no revision) — exactly one live
     mention remains, still matched. THE "deduped by canonical URL" clause.
  3. rate budget: exactly ONE bounded fetch serves the full dispatched poll —
     the single hop IS the stored `metadata.feedUrl` (no discovery, the
     publication-feed branch of `resolveQueryFeedItemUrls` is a no-op).
  4. the 25-item poll bound: a 30-item publication feed yields exactly 25
     items from the SAME single fetch — item 26+ never surface — and 25
     mentions land. (The 25-cap + 1-fetch: both documented, now pinned.)
  5. capture-validity: `PRESENCE_RSS_ROLLOUT` unset stops the FULL dispatched
     path BEFORE any request — `connector_not_operational`, zero hops, zero
     rows. THE "behind a per-source kill flag" clause (the flag = the
     surface's; rss needs no credentials, so the credentials_missing leg of
     #3384 does not apply — there is nothing to be missing).
  6. the /status-graded note: the `presenceSourceCoverageForDocs` rss entry
     states what the Medium public surface covers (the publication-feed
     backbone, named profiles/publications/tags, no global free search) with
     the in-connector rate budget, `productionStatus` pinned "gated". THE
     "coverage note states what the public surface covers" clause.
- `app/lib/presence-source-coverage.server.ts` — the rss note, ONE string,
  extended to the honest-coverage parity the #3386 note set: what the public
  surface covers (publisher RSS, Substack /feed, Medium /feed/... — named
  profiles, publications, tags, no global free search — and Google News
  /rss/search query feeds built from the tracked match phrase; surfaces
  cited in PLAN.md §2/§8) + the in-connector rate budget (one bounded fetch
  per feed per poll, ≤25 items, polls serialized upstream) + the unchanged
  gate sentence. No other coverage entry, no `SOURCE_LABELS`/seam edit.
- `tests/status.route.test.ts` — +1 it: the rss tracked-source row renders
  the catalog verbatim on /status ("publication-feed mention backbone",
  "Medium /feed/", "one bounded fetch per feed per poll", gated). THE
  "/status per-source row" clause — #3384's mechanism, #3200's row.
- NO edits to: the rss connector, the registry, `presence-types.ts` (the
  shared interface — untouched), any migration, any flag, wrangler.jsonc.
  The connector ships dark exactly like rss/gdelt/threads/hn/bluesky;
  activation stays the epic's rollout decision.

## Issue acceptance, evidenced

- "e2e fixture returns >=1 mention (or the documented no-surface entry)":
  integration it #1 — 1 mention from the Medium fixture through the REAL
  dispatch; (no-surface entry N/A: Medium HAS the lawful public surface —
  its own feeds, cited in PLAN.md §2/§8, so the flag-off exclusion does not
  apply).
- "rate budget tested": its #3 + #4 — exactly 1 bounded fetch per
  dispatched poll; 30-item feed → 25 items, same single fetch.
- "/status per-source row": status.route.test.ts's new it — the rss row
  renders the extended note verbatim; productionStatus pinned "gated" (both
  in the route test and in integration it #6 via the catalog).
- "termination": captured (it 1) + deduped by canonical URL (it 2) + behind
  the per-source kill flag (it 5; `PRESENCE_RSS_ROLLOUT`, disabled default,
  fail-closed) + capture-validity (it 5: gated polls never fetch; it 1: an
  honest 1-of-2 — the no-match item filtered, nothing fabricated) + the
  coverage note (its 6 + the route pin).
- "required — research existing open-source collectors first (cite searched
  + rejected)": PLAN.md §8's 2026-09-12 survey (openstream/
  open-social-media-monitoring 132★ stale, news-r/auritus 31★,
  gdelt/gdelt.github.io 79★ — none adopted) + THIS lane's fresh 2026-09-13
  search: `gh search repos "medium rss feed"` →
  ByteSchneiderei/medium-rss-api ★6 (REST wrapper + HTML tokenizer),
  Pinjasaur/meed ★5 (Medium RSS→JSON, npm last publish 2019),
  jeziellago/rustium ★4 (Rust study project), ykocaman/astro-medium-loader
  ★4 (Astro-specific), richechab/n8n-rss-to-sheets-automation ★5 (an n8n
  flow, not a collector); `npm search "medium rss"` → meed@1.0.1 (2019),
  medium-rss-parser@1.0.2 (2021), vue-rss-parser@0.1.0 — all rejected: stale,
  single-purpose, or Node/framework-bound, and every one would ADD a
  dependency and bypass the SSRF-hardened `presenceSafeFetch`/bounded-
  response path every 0509 connector rides. Adopted: NOTHING — the #3250 rss
  backbone IS the collector; this issue adds its missing proof, not a second
  implementation.
- "no edits to the shared interface": `presence-types.ts` untouched; the
  registry untouched; zero migrations.
- "public surfaces only; no paid vendor": Medium's own feeds (official RSS
  help 214874118), $0, no key, no auth — PLAN.md §2's Medium row, carried.
- Metric: mentions/brand/day from Medium = `presence_item` rows per tracked
  entity via its registered Medium publication feed; failure rate =
  `presence_poll_cursor.last_error_code`. Both observable today — no new
  machinery.

## Verification (this lane, on the diff)

- `npx vitest run --configLoader runner --project workers
  tests/integration/medium-mention-connector.integration.test.ts` → 6/6, exit
  0, FIRST RUN (real workerd, real D1, real migrations).
- `npx vitest run tests/status.route.test.ts
  tests/public-tree-phrase-ban.test.ts` → 15/15, exit 0 (14 shipped + 1 new).
- `npx vitest run --configLoader runner --project node --changed
  origin/main` → 103/103 across 8 files, exit 0. One suite at a time,
  `--maxWorkers` never passed, no coverage/typecheck locally — CI owns both;
  the targeted workers-project run covers the integration side because the
  diff touches tests/integration/**.
- `sgscan --base origin/main` → "No new security findings", exit 0.
- Test accounting: +7 it (6 integration + 1 route), +~30 expect, −0 removed,
  no skips/`.only` — net positive, no `test-removal-justified` owed.

## Rescue notes for the next agent on this lane

- The worktree starts WITHOUT usable node_modules:
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 npm ci
  --no-audit --no-fund` → 262 packages, 6s, then vitest works.
- Do NOT "fix" the missing PRESENCE_RSS_ROLLOUT line in wrangler.jsonc —
  rss shipped dark through #3250; activation (the epic's rollout call) is
  #3171's, not this issue's. #3199 (Substack) shares the SAME surface and
  the SAME flag — its note duty lands on the same rss coverage note; this
  note's clauses are worded so theirs can sit beside them.
- The mention triple to assert is on the stored row's `raw_json.mention`
  (readMentionRow), NOT on the `listPresenceItems` payload — the list
  projection does not carry the mention stamp.
