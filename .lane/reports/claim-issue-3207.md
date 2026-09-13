# Lane evidence — claim/issue-3207 (Nishfleet/0509#3207)

Hacker News mentions → the mention table: closes this issue's acceptance on
the #3178 substrate. The public surface is the Algolia HN Search API
(`https://hn.algolia.com/api/v1/search_by_date`, free, no key, no auth —
docs/mentions/PLAN.md §2 source inventory, "Hacker News" row), captured
through the EXISTING `hn` connector (#3375, the #3253 presence/mention
adapter) — no new connector, no migration, no shared-interface edit.

Provenance: this unit's prior runs banked
`wip/pi-issue-0509-3207-20260913T183358Z` @ 90b4b508e (salvage, issue
comment); this session resumed it (claim/issue-3207, re-claimed
18:54:26Z), rebased onto origin/main (522c79d4c, clean), then finished the
acceptance and proved every line.

Delta only, per the disjoint-slice rule — diff is exactly 4 files (3 + this
record):

- MOD `tests/integration/hn-mention-connector.integration.test.ts` — a new
  describe (2 its, 23 total in the file), on the real-D1 workers project:
  (1) end-to-end capture — a seeded tracked brand's `source_target`
  (connector_id = 'hn') through the REAL data layer → `pollPresenceTarget`
  → `upsertPresenceItems` → `presence_item` rows, fixture returns >=1
  mention (the acceptance's "e2e fixture" clause); the rate budget THROUGH
  the orchestration (exactly ONE courtesy fetch per poll; two polls = two
  requests, never more); canonical-URL dedup (stored `url_hash` =
  `presenceUrlHash(canonicalUrl)`, asserted per row; re-poll inserts 0 —
  the app-level url_hash + content_hash skip; the 0055
  UNIQUE (source_target_id, url_hash) index is the concurrent-write
  backstop); reconcile never tombstones (`completeSnapshot: false` —
  search_by_date is a bounded, date-ordered window, absence from a page is
  not a deletion). (2) the kill flag: `PRESENCE_HN_ROLLOUT` unset → no
  capture, ZERO network hops, zero rows — and /status stays honest: the
  coverage reads UNAVAILABLE / `connector_disabled`, never "no data".
  Scope note: the capture-validity gate itself is proven on the full
  pipeline in tests/capture-validity-pipeline.test.ts — nothing here
  bypasses it.
- MOD `app/lib/presence-connectors/hn.server.ts` — the #3375 adapter gains
  the issue-REQUIRED research citation in its header (searched + rejected;
  see below). No code change in this file: #3375 shipped the whole adapter
  on the shared interface.
- MOD `app/lib/presence-source-coverage.server.ts` — the hn coverage note
  now states what the public surface covers: "Coverage: only public HN
  stories and comments whose stored text/URL/title matches the tracked
  phrase become mentions — the connector pins the Algolia query to
  tags=(story,comment) — while ranking metadata (points, comment counts,
  the story's external URL) rides raw_json, never the mention." This note
  renders verbatim on /status via the #3205 "Tracked sources" block. The
  issue's PLAN.md documentation duty (only for no-lawful-surface cases)
  does not trigger: the surface IS lawful.
- MOD `tests/status.route.test.ts` — the #3205/#3199 precedent pins,
  extended for this issue: the loader it() pins the hn row present-and-gated
  with "Hacker News" in its note; the render it() pins "Hacker News" +
  "rides raw_json, never the mention" reaching the /status markup.

Required research (this session, 2026-09-13): `gh search repos "hacker news
mentions"` → Bemmu/hnfirstmention ★0 (pushed 2018-02-28),
ltranco/TheHackerNewsBump ★0 (pushed 2014-08-22),
mihailgaberov/hacker-news-scraper ★0 (pushed 2021-02-01) — all dormant
one-shot scrapers, no dedup substrate; `npm search "hacker news" mentions`
→ generic command-line/parse libraries (liftoff, liftup, …), no live
HN-mention collector. All rejected: adopting a dormant 2014–2021 scraper
adds a dependency without removing anything, while the in-repo #3178
connector interface already provides the capture substrate. The rejected
OFFICIAL alternative remains the Firebase HN API (no search endpoint —
docs/mentions/PLAN.md, source inventory). Public surfaces only, $0, no
paid vendor, no edits to the shared interface.

Metric (issue `metric:` line, mapped the way #3206 pinned it for
bluesky — no new machinery): mentions/brand/day = `presence_item` rows
per tracked entity where `connector_id='hn'` (the integration test counts
exactly those rows, keyed by the canonical-URL `url_hash`); failure rate
= `presence_poll_cursor.last_error_code` / `last_error_message`, written
by the existing poll-cursor path (presence-data.server.ts).
