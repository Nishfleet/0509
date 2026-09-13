# Lane evidence — claim/issue-3201 (Nishfleet/0509 #3201)

feat(mentions): capture mentions from Pinterest into the mention table (split of #3171).

Unit: pi-issue-0509-3201. Disjoint slice, per the issue: this source's adapter
(`app/lib/presence-connectors/pinterest.server.ts`), its kill flag
(`PRESENCE_PINTEREST_ROLLOUT`), its tests, and its coverage note. The shared
interface (`presence-types.ts` gains only the new ids, the #3178 convention)
and the mention table are #3178's; #3178 landed first, this lane only rides it.

Prior art: this lane resumes the twice-died predecessor of the same unit —
salvage branch `wip/pi-issue-0509-3201-20260913T183412Z` @ `8e99906d7`
(see the issue comments), rebased onto origin/main (`522c79d4c`) by this lane
and finished. The predecessor's deaths were the worktree's missing
`node_modules` (its test run hit `ERR_MODULE_NOT_FOUND` before any test) and
StartLimitBurst; this lane re-verified everything from a clean state.

## What the slice ships

- `app/lib/presence-connectors/pinterest.server.ts` — the connector: reads the
  tracked profile's first-party public feed
  `https://www.pinterest.com/<handle>/feed.rss` (public RSS 2.0, no key, no
  auth, undocumented — same honesty posture as the PLAN.md Google News RSS
  row), emits `presence_item` rows whose `canonicalUrl` is the public
  `pinterest.com/pin/<id>/` page (the feed `<guid>` doubles as `externalId`).
  One network hop, through `presenceSafeFetch` (SSRF + redirect re-validation,
  `redirect: "manual"`), every URL re-validated via `normalizePublicHttpUrl`
  (the #3339 capture-validity precedent) — dropped, not compromised, on
  failure. Pinterest double-escapes its description HTML, so the connector
  re-strips after the shared parse (the shared `stripHtml` is idempotent on
  plain text — exported, not forked).
- `app/lib/env.server.ts` + `app/lib/presence-access-gates.server.ts` — the
  per-source kill flag `PRESENCE_PINTEREST_ROLLOUT` (disabled | internal |
  pilot | ga; defaults disabled — ships dark, activation is a separate rollout
  decision). No credentials exist: the surface is keyless (hasCredentials →
  true, like hn).
- `app/lib/presence-connector-registry.server.ts` — registration + the
  `pollPresenceTarget` dispatch (passes the WHOLE target — the #3386 lesson)
  + coverage label `VERIFIED_PUBLIC_FEED`.
- `app/lib/presence-types.ts` — `"pinterest"` in `PRESENCE_CONNECTOR_IDS` +
  `PRESENCE_SOURCE_IDS` (the #3178 union, extended in order).
- `app/lib/presence-source-coverage.server.ts` + `app/lib/presence-display.ts`
  — the coverage note: what the public surface covers (the tracked profile's
  own most recent ~25 pins, self AND competitor, no auth) and what it does not
  (keyword-wide search, boards off-profile, repins/comments, engagement
  counts — those sit behind the approval-gated OAuth-per-user API v5, parked
  in PLAN.md), `productionStatus: "gated"`, plus the human-readable copy.
- `migrations/0101_widen_source_target_connector_pinterest.sql` — expands the
  `source_target.connector_id` CHECK with `'pinterest'` (table-rebuild, the
  0093/0098/0099/0100 convention; child rows snapshotted to backup tables and
  restored inside the migration). Expand-only: every previously-accepted value
  is still accepted, old code unaffected — rollback rolls back code, never
  data. One migration, one PR, phase 1 only (the connector ships dark).
- `tests/integration/pinterest-mention-connector.integration.test.ts` — the
  proof: real workerd, real D1, the repo's real migrations.

## Research (issue-required: existing open-source collectors, searched + rejected)

Searched 2026-09-13 (this lane): GitHub repository search `pinterest rss`,
sorted by stars — iatek/jquery-socialist (626★, last pushed 2015-10;
browser-side jQuery widget, not a server-side collector — rejected),
didats/DTSocialMedia (6★, PHP, 2015 — dead — rejected),
pinLarge/pinLarge (4★, Go→Heroku, 2019 — dead — rejected),
xyonium/reach-mcp (6★, Python, pushed 2026-09-12; MCP server aggregating 33
sources — rejected: a second language and a running sidecar organ for one
public GET; the connector reuses the shared rss parser and the
`presenceSafeFetch` SSRF/redirect path instead). Also verified:
RSS-Bridge/RSS-Bridge (9,233★, active — pushed 2026-08-28; its
`bridges/PinterestBridge.php` confirmed present via the GitHub contents API
2026-09-13) — rejected: a PHP bridge-framework dependency that re-scrapes the
HTML profile page when Pinterest itself publishes the first-party `feed.rss`
this connector reads (fewer moving parts, no third-party trust, no new
dependency). Adopted: none — the platform's own public surface; the same
`research:`/`help-first:` header lives in the connector source.

Public surfaces only; no paid vendor; no edits to the shared interface
(the only shared-file touches are additive id-list/registry/coverage lines —
the #3178 extension convention). PLAN.md stays as written: its Pinterest row
(§sources) already parks the OAuth-gated API v5 at zero-spend, and the
connector's docblock explains why the feed, not the API, is the $0 surface —
the "no lawful public surface" exclusion (PLAN.md documentation + flag-off)
does not apply because a lawful public surface EXISTS and ships (flagged,
dark).

## Issue acceptance, evidenced

- "e2e fixture returns >=1 mention": the integration capture test
  ("returns the tracked profile's pins whose canonicalUrl is the public
  pinterest.com/pin/ URL — >=1 mention…") drives a captured- fixture feed
  (2 pins) through the real connector: `expect(result.items).toHaveLength(2)`,
  canonicalUrl = `pinterest.com/pin/<id>/`, excerpt stripped of the
  double-escaped HTML shell, fixed-date `publishedAt` (no wall clock).
- "rate budget tested": ONE serialized request per poll —
  `expect(result.costUnits).toBe(1)` and `expect(fetchImpl).toHaveBeenCalledTimes(1)`
  pinned in the capture test, the poll→upsert re-poll test, and the
  healthCheck test. No paging (the feed IS the bounded window), no second
  fetch; cadence stays with the poll orchestrator.
- "/status per-source row": the integration test "drives the /status
  per-source row from the kill flag" — flag unset → the row renders
  `unavailable` (connector_disabled); `internal` → `available` labelled
  `VERIFIED_PUBLIC_FEED`; competitor mode likewise — and the coverage note
  surfaced on /status states what the surface covers and what it does not.

Termination: a tracked brand or person gets mentions from Pinterest captured
(poll → upsert through the shared store), deduped by canonical URL ("poll →
upsert inserts each pin once; a second poll with the SAME pin URL under a NEW
title UPDATES the row instead of duplicating it"), behind the per-source kill
flag (`PRESENCE_PINTEREST_ROLLOUT`), capture-validity gate applies
(`presenceSafeFetch` + `normalizePublicHttpUrl`, the #3339 precedent; the
"drops items whose pin URL does not survive public-URL normalization" test),
coverage note states what the public surface covers (the
`presenceSourceCoverageForDocs` "pinterest" entry, pinned by test). The
migration + the registry/CHECK widen are proven by
"writes connector_id = 'pinterest' via the CHECK-widened migration and reads
it back" and "re-applies the 0101 migration cleanly and preserves child rows
and every predecessor connector's rows".

Metric ("mentions per tracked brand per day from Pinterest; failure rate"):
counts ride the shared `presence_item` rows (connector_id = 'pinterest',
canonicalUrl = pinterest.com/pin/*) gathered per tracked entity per day — the
same aggregation the #3206 precedent uses; failure rate =
`presence_poll_cursor.last_error_code` for the pinterest targets (honest
HTTP-error mapping test: 404/500 → failed poll, never fabricated items).

## Run-proof (this lane, 2026-09-13, this worktree)

- `npm ci` → exit 0 (262 packages; the fresh worktree had no node_modules —
  the first bare-`npx vitest` run died with `ERR_MODULE_NOT_FOUND` inside the
  vite module runner, a real failed command, fixed by the install; the
  predecessor unit's exit-code/1 death is consistent with the same cause).
- `npx vitest run --configLoader runner --project workers
  tests/integration/pinterest-mention-connector.integration.test.ts` →
  1 test file, 22/22 passed, 0 failed — re-verified LIVE by this lane's
  successor run on the rebased head (7.37s, the #3200/#3204-merged main),
  not just inherited from the note above.
- Affected node-project run (`--changed origin/main`) → 373/373 test files,
  4668/4668 tests passed (144.14s) — my shared-file touches (presence-types,
  registry, coverage) pull a wide import graph; every one green.
- `sgscan` → "No new security findings", exit 0.
- `crgate` → exit 3: CodeRabbit is not signed in on this machine (the
  skill's tell-Nish case; precedent #3399 shipped the same way — the remote
  CodeRabbit check still fires on the PR via the GitHub app).
- Rebase receipts: the salvage implementation rebased onto #3200/#3204-merged
  main; the two shared-organ conflicts (access-gates poll-path predicate,
  registry dispatch) resolved as the UNION (linkedin's #3204 whole-target
  call kept, pinterest's #3386-convention dispatch added); the merged unions
  (connector ids, source ids, registry, coverage) statically verified before
  any test ran.
