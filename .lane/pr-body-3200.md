## Summary

Closes the #3200 acceptance on top of the #3250 rss mention backbone (#3283, verified ancestor of origin/main): proves the end-to-end Medium mention capture — fixture → `pollPresenceTarget` → `upsertPresenceItems` → `listPresenceItems` — into the `presence_item` mention table, deduped by canonical URL, rate-budgeted, behind the surface's kill flag with the capture-validity fail-closed posture, and publishes the /status per-source row.

Delta only, per the disjoint-slice rule: this issue's proof + this source's coverage note. NO connector edit, NO registry edit, NO `presence-types.ts` edit (the shared interface — untouched), NO migration (`connector_id = 'rss'` accepted since 0093), NO new flag, NO wrangler.jsonc change. Medium rides the documented publication-feed path ("today — rides `rss` connector", docs/mentions/PLAN.md §2); the connector ships dark exactly like rss/gdelt/threads/hn/bluesky — activation stays the epic's rollout decision.

- `tests/integration/medium-mention-connector.integration.test.ts` (NEW, workers project, real workerd/D1, real migrations, IP-literal fixture host — no DNS, no real network) — 6 its:
  - the e2e fixture (a Medium publication feed: channel = the publication, items bylined) dispatched through the REAL `pollPresenceTarget` path → 2 raw items → `upsertPresenceItems` inserts 1: the story naming the tracked brand, matched `matchedPhrase "Acme"` / `matchField "title"`, `canonicalUrl` = the story's own link, never the feed URL; the weekend-roundup item that does not name the entity never becomes a row;
  - dedup by canonical URL: a second identical dispatched poll + upsert inserts 0 — the UNIQUE (source_target_id, url_hash) key via `presenceUrlHash(canonicalUrl)`; identical content hash → no revision; exactly one live mention remains;
  - rate budget: exactly ONE bounded fetch serves the full dispatched poll — the single hop IS the stored `metadata.feedUrl` (no discovery: `feedDiscovery "direct"`; the publication-feed branch of `resolveQueryFeedItemUrls` is a no-op);
  - the 25-item poll bound: a 30-item publication feed yields exactly 25 items from that SAME single fetch — item 26+ never surface — and 25 mentions land;
  - capture-validity: `PRESENCE_RSS_ROLLOUT` (the surface's kill flag; rss needs no credentials, so #3384's credentials-missing leg has nothing to be missing) unset stops the FULL dispatched path BEFORE any request — `connector_not_operational`, zero hops, zero rows;
  - the /status-graded note: the `presenceSourceCoverageForDocs` rss entry states what the Medium public surface covers, `productionStatus` pinned `"gated"`.
- `app/lib/presence-source-coverage.server.ts` — the rss note, ONE string, raised to the honest-coverage parity the #3386 bluesky note set: what the public surface covers (publisher RSS, Substack /feed, Medium /feed/... — named profiles, publications and tags, there is no global free search — and Google News /rss/search query feeds built from the tracked match phrase; public surfaces cited in docs/mentions/PLAN.md §2/§8), the in-connector rate budget (one bounded fetch per feed per poll, at most 25 items, polls serialized upstream), the unchanged gate sentence. Nothing else in the catalog moves.
- `tests/status.route.test.ts` — +1 it: the rss tracked-source row renders the catalog verbatim on /status ("publication-feed mention backbone", "Medium /feed/", "one bounded fetch per feed per poll", gated) — the #3200 acceptance, test-pinned, #3384's mechanism.

Termination, clause by clause: captured (integration it 1) · deduped by canonical URL (it 2) · behind a per-source kill flag (it 5; `PRESENCE_RSS_ROLLOUT`, disabled default, fail-closed) · capture-validity applies (it 5: gated polls never fetch; it 1: an honest 1-of-2 — the no-match item filtered, nothing fabricated) · the coverage note states what the public surface covers (its 6 + the /status route pin) · no lawful-surface exclusion needed (Medium HAS one — its own feeds, cited — so the flag-off exclusion stays unused).

Verification:
- `npx vitest run --configLoader runner --project workers tests/integration/medium-mention-connector.integration.test.ts` → 6/6, exit 0, FIRST RUN (real workerd, real D1, real migrations).
- `npx vitest run tests/status.route.test.ts tests/public-tree-phrase-ban.test.ts` → 15/15, exit 0 (14 shipped + 1 new).
- `npx vitest run --configLoader runner --project node --changed origin/main` → 103/103 across 8 files, exit 0. One suite at a time, `--maxWorkers` never passed, no coverage/typecheck locally — CI owns both; the targeted workers-project run covers the integration side because the diff touches tests/integration/**.
- `sgscan --base origin/main` → "No new security findings", exit 0.
- Test accounting: +7 it (6 integration + 1 route), +~30 expect, −0 removed, no skips/`.only` — net positive, no `test-removal-justified` owed.
- Metric: mentions/brand/day from Medium = `presence_item` rows per tracked entity via its registered Medium publication feed; failure rate = `presence_poll_cursor.last_error_code`. Both observable today — no new machinery.

run-proof: this PR adds no unit/timer/workflow; the proofs above are the run evidence — 6/6 workers-project integration (FIRST RUN, real workerd/D1), 15/15 route+phrase-ban (1 new it), 103/103 affected node sweep across 8 files, sgscan clean, all exit 0

research: the issue-required collectors search, this lane (2026-09-13) — `gh search repos "medium rss feed"`: ByteSchneiderei/medium-rss-api ★6 (REST wrapper + HTML tokenizer — rejected: Node-service shape, bypasses the SSRF-hardened `presenceSafeFetch`/bounded-response path), Pinjasaur/meed ★5 (npm last publish 2019 — rejected: stale), jeziellago/rustium ★4 (rejected: study project), ykocaman/astro-medium-loader ★4 (rejected: Astro-specific), richechab/n8n-rss-to-sheets-automation ★5 (rejected: an n8n flow, not a collector); `npm search "medium rss"`: meed@1.0.1 (2019), medium-rss-parser@1.0.2 (2021), vue-rss-parser@0.1.0 — all rejected: stale, single-purpose, or framework/Node-bound, each would ADD a dependency. PLAN.md §8's 2026-09-12 survey (openstream/open-social-media-monitoring 132★, news-r/auritus 31★, gdelt/gdelt.github.io 79★ — none adopted) already concluded: reuse the shipped connector pattern + proven parsers. Adopted: NOTHING — the #3250 rss backbone IS the collector; this issue adds its missing proof, not a second implementation.

help-first: no new bin/ file; existing organs used — the #3250 rss backbone connector + its mention-stamp path, the #3384 /status tracked-source rows mechanism, the #3386 dispatched-poll precedent (its integration-test shape, this time for the surface that was already wired), and the coverage module's docs catalog. Nothing new was built.

organ-heartbeat: no organ paths touched (diff: app/lib/presence-source-coverage.server.ts notes string, two test files, the .lane report) — nothing scheduled added.

net-positive-because: 4 files, +458/−1 — the acceptance evidence the #3200 termination demanded (capture, dedup, rate budget, kill flag, coverage note, /status row), plus the last legacy-style coverage note raised to honest-coverage parity; nothing deleted, zero behavior change while `PRESENCE_RSS_ROLLOUT` is unset (the rollout gate answers before the dispatch runs, exactly as before).

loose-ends: medium-activation — production `PRESENCE_RSS_ROLLOUT` stays the epic's rollout decision (rss shipped dark through #3250; #3199's Substack shares this surface and flag) — tracked on #3171, not this PR.

Closes #3200
