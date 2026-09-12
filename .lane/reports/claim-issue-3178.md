# Lane report — issue #3178 mentions slice 2a (salvage resume)

Branch: `claim/issue-3178`
Base: `origin/main` at `63809b48f` (2026-09-13 resume: rebased onto `1447ae4cc`; neither salvaged file touched by the 68 intervening main commits, re-verified green — see Verification below)
Unit: `pi-issue-0509-3178`

## 2026-09-13 resume verification (rebase onto current main)

- `npx vitest run --configLoader runner --project node tests/presence-connectors-gdelt.server.test.ts` → 9/9
- `npx vitest run --configLoader runner --project node --changed origin/main` → 11 files / 97 tests, all green
- `sgscan --base origin/main` → no new security findings
- Both integration tests unchanged since the salvage base (0 new main commits), so their evidence below remains current; workers-project rerun skipped per the memory-budget rule (diff touches neither migrations/** nor tests/integration/**).

## What shipped (after the salvage)

Deletion-first salvage: the parallel #3250 (RSS mention backbone: publisher
RSS + Substack + Medium + Google News query feeds) and #3251 (GDELT DOC 2.1
connector) lanes landed their mention stack on `main` while this lane was
dead. Their code is richer than this lane's earlier implementation, so the
rebase keeps ONLY what main lacks:

- `app/lib/presence-connectors/gdelt.server.ts` — the surviving hardening,
  ported verbatim from this lane's reviewed work:
  - `normalizeQueryPhrase()` (new, exported): the match phrase cannot break
    out of the GDELT quoted-phrase wrapper or smuggle DOC 2.1 operator syntax
    (`sourcelang:`, `domain:`, `(` `)` OR groups, `|` alternation) — quotes
    stripped, whitespace collapsed, remainder fails closed, 256-char bound
    kept. Wired into `validateTarget` (stores the NORMALIZED phrase in
    `metadata.matchPhrase`) and re-enforced in `poll` (fail-closed, honest
    degraded result, fair-use budget untouched).
  - Stored `article.url` must now survive `normalizePublicHttpUrl` to become
    canonical — GDELT rows are third-party data; loopback/localhost/unparseable
    URLs are skipped, never stored or rendered (was: only `startsWith("http")`).
- `tests/presence-connectors-gdelt.server.test.ts` (new) — the guard pins:
  quote stripping, operator fail-closed (validateTarget AND poll, no fair-use
  spend), length contract preserved, one-request-per-poll rate budget, and
  public-URL canonicalization (loopback + unparseable honestly skipped).

## What main already had (dropped from this lane, deleted not kept)

- The gdelt connector file, registry/gates/coverage/CONNECTOR_COPY wiring
  (#3251, reviewed by nebius GLM-5.3-Flash + presence-source drift pins).
- Google News redirect resolution in `rss.server.ts` (#3250, network-fetch
  resolution; this lane's decode-first variant NOT ported — #3250's approach
  is landed + reviewed; filed as follow-up consideration).
- The `source_target.connector_id = 'gdelt'` CHECK widen — main's
  `0098_widen_source_target_connector_gdelt.sql` with the child-row
  snapshot/restore convention (this lane's duplicate 0099 migration dropped).
- Integration coverage: `tests/integration/gdelt-mention-connector
  .integration.test.ts` (16/16 green after the port) and
  `tests/integration/rss-mention-backbone.integration.test.ts`.

## Verification (this lane, on the rebased diff)

- `npx vitest run --configLoader runner --project node tests/presence-connectors-gdelt.server.test.ts` → 9/9
- `npx vitest run --configLoader runner --project workers tests/integration/gdelt-mention-connector.integration.test.ts` → 16/16 (real workerd, real D1, real migrations)
- `npx vitest run --configLoader runner --project node --changed origin/main` → 11 files / 97 tests, all green
- `sgscan --base origin/main` → no new security findings

## Issue acceptance, evidenced on main + this diff

- fixture brand ≥1 mention per source in e2e: `gdelt-mention-connector
  .integration.test.ts` + `rss-mention-backbone.integration.test.ts` (real D1).
- dedup test: rss-mention-backbone.integration.test.ts (UNIQUE
  (source_target_id, url_hash) + redirect resolution before hashing).
- rate budgets per source: gdelt = 1 serialized request/poll (pinned here);
  rss query feeds = documented bounded resolution budget (#3250).
- no ToS-violating access: public surfaces only; GDELT terms + citation
  carried in the connector header and every item's raw payload (#3251).
