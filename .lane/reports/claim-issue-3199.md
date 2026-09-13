# Lane evidence — claim/issue-3199 (Nishfleet/0509#3199)

Substack public feeds → the mention table: closes this issue's acceptance on
the #3178 substrate. The Substack public surface is the publication's own
syndication feed (`https://<pub>.substack.com/feed`, official help doc cited
in docs/mentions/PLAN.md §2/§8), captured through the EXISTING `rss` connector
(#3250) — no new connector, no migration, no shared-interface edit.

Provenance: this unit's first run banked
`wip/pi-issue-0509-3199-20260913T171953Z` @ a9dd2c66d (salvage, issue
comment); this session resumed it (claim/issue-3199, re-claimed 17:52:34Z),
rebased onto origin/main (368f761f9, clean), then finished the acceptance.

Delta only, per the disjoint-slice rule — diff is exactly 3 files:

- MOD `tests/integration/rss-mention-backbone.integration.test.ts` — a new
  describe (2 its, 17 total in the file): the kill flag (PRESENCE_RSS_ROLLOUT
  unset → `connector_not_operational` BEFORE any network hop), the rate
  budget (exactly ONE fetch per feed per poll; Substack item links are direct
  publication URLs — no Google-News-style redirect hop), >=1 mention captured
  at the post's canonical Substack URL, exactly 1 live presence_item row, and
  canonical-URL dedup on re-poll (app-level url_hash + content_hash skip;
  the 0055 UNIQUE index is the concurrent-write backstop). Second it() pins
  the coverage note: the rss /status row names Substack and its honest limit
  ("no free global keyword search"), still gated. Scope note: the
  capture-validity gate itself is proven on the full pipeline in
  tests/capture-validity-pipeline.test.ts — nothing here bypasses it.
- MOD `app/lib/presence-source-coverage.server.ts` — the rss coverage note
  now states what the public surface covers: "Covers the publication feeds
  the sources themselves syndicate — publisher RSS, Substack, Medium, YouTube
  channel feeds (named feeds you register; those platforms have no free
  global keyword search)." This note renders verbatim on /status via the
  #3205 "Tracked sources" block. The issue's PLAN.md documentation duty (only
  for no-lawful-surface cases) does not trigger: the surface IS lawful.
- MOD `tests/status.route.test.ts` — the #3205-precedent pins, extended for
  this issue: the loader it() pins the rss row present-and-gated with
  "Substack" in its note; the render it() pins "Substack" +
  "no free global keyword search" reaching the /status markup.

Required research (this session, 2026-09-13): `gh search repos "substack"` +
`npm search substack` — `timf34/Substack2Markdown` ★522 (bulk post→Markdown
exporter, not a poll-able mention source — rejected); `NHagar/substack_api`
★223 (unofficial wrapper of Substack's private web API — not the documented
public surface — rejected); `ma2za/python-substack` ★173 (write-side draft
management — rejected); npm `substack-api` (private-webservice client —
rejected). PLAN.md §8's 2026-09-12 survey stands: the collector is the shipped
rss connector; no new implementation, no dependency. Public surfaces only,
$0, no paid vendor.

Reviewer round (product repo, one round, seat `litellm/senior` via
`find_senior_seat` — the reviewer extension pinned through
`~/.pi/agent/agents/reviewer-3199.md`): 0 Critical, 0 Warnings, 4
Suggestions. Adjudication: Act on — dedup-mechanism comment corrected to
name the app-level skip (the UNIQUE index only backstops concurrent writes);
dead duplicate `expect(poll.ok)` removed; the describe header now records
where the capture-validity gate and the "e2e fixture" proof live. Noted —
the third `productionStatus: "gated"` pin kept: the Substack describe stays
self-contained. Acted findings were re-proven: integration 17/17 after the
edits.

Run receipts (all exit 0):

- `npx vitest run --configLoader runner --project workers
  tests/integration/rss-mention-backbone.integration.test.ts` → 17/17
  (re-run after adjudication edits, still 17/17);
  `--testNamePattern=Substack` → 2 passed | 15 skipped.
- `npx vitest run --configLoader runner --project node --changed
  origin/main` → 8 files, 102/102 (incl. the extended status-route and
  coverage-catalog tests).
- `sgscan --base origin/main` → "No new security findings."

First-run note: the initial integration run failed (ERR_MODULE_NOT_FOUND —
this worktree had no node_modules, so `npx vitest` resolved a cached foreign
vitest); `npm ci` fixed it; every run after is green.
