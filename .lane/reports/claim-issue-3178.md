# Lane evidence — claim/issue-3178 (mentions epic slice 2a, mainstream news)

Issue: Nishfleet/0509#3178 · Parent epic: #3171 · Data model documented by #3170 (merged PR #3256)

## What landed

- **Mention store**: no new table — `presence_item` (migration 0055) is the canonical mention store, established and documented by #3170. This PR's migration 0099 extends the store's target surface.
- **Adapter interface**: extends the shipped presence connector interface (`presence-types.ts` / registry / gates). New `gdelt` connector id wired through registry, coverage, and access gates (`PRESENCE_GDELT_ROLLOUT`, disabled by default; no credentials needed — public API).
- **Source 1 — GDELT DOC 2.1**: new connector `app/lib/presence-connectors/gdelt.server.ts`: query-target (brand phrase), artlist JSON, seendate parsing, honest parse failures, deterministic fixture mode (`PRESENCE_GDELT_MOCK=1`). Rate budget encoded + test-asserted: exactly ONE request per poll, `maxrecords=75`, `timespan=1d`. Terms: GDELT allows unlimited commercial use with citation (cited in raw payload + PR body).
- **Source 2 — Google News RSS**: rides the existing `rss` connector as a query feed; `news.google.com/rss/articles/...` redirect links resolve to canonical publisher URLs (base64url id decode first — zero network; bounded SSRF-validated fetch fallback) BEFORE hashing, so dedup keys are publisher-URL canonical.
- **Source 3 — publisher RSS**: rides the existing `rss` connector unchanged (already shipped), asserted by the new integration test.
- **Migration 0099**: expand-only CHECK widen (`source_target.connector_id` + 'gdelt'), same rebuild-with-child-snapshot pattern as 0093; one phase per PR; no DROP/NOT-NULL/rename.

## Verification (real runs)

- `npx vitest run --configLoader runner --project node tests/presence-connectors-gdelt.server.test.ts` → 13/13 passed.
- `npx vitest run --configLoader runner --project workers tests/integration/presence-migration-0099.integration.test.ts tests/integration/mention-news-sources.integration.test.ts` → 3/3 passed (real D1: gdelt row accepted, child rows preserved, fixture brand ≥1 mention per source, dedup on re-poll, Google News redirect resolution + dedup).
- Salvage resume 2026-09-12: rebased onto origin/main (was 37 behind), migration renumbered 0097→0098 (main took 0097), typecheck fixes (presence-display gdelt key, gdelt metadata query narrowing, seedTarget return type), `tests/d1-remote-restore-evidence.test.ts` updated for the new tail migration.
- `npx vitest run --configLoader runner --project node --changed origin/main` → 370 files / 4617 tests passed.
- `npx vitest run --configLoader runner --project workers` (8 presence/migration files incl. mention-news-sources, presence-migration-0099, presence-migration-0093, rss-mention-connector, presence-poll-targets, mention-source-activation, mention-digest-resweep, status-probe-samples) → 44/44 passed.
- `sgscan` on all touched files → no new security findings.
- Second rebase 2026-09-12: main took 0098 (`0098_email_delivery_canary.sql`); this PR's migration renumbered 0098→0099 (file + integration test + restore-evidence expectations). Post-rebase: node 86/86 (d1-remote-restore-evidence, gdelt connector, coverage, claim-surface), workers 7/7 (mention-news, presence-migration-0099, presence-migration-0093, status-probe-samples).

## Gate note

- capture-validity gate: mentions reuse the presence path already governed by the source coverage / rollout gates; every new source ships disabled (`PRESENCE_GDELT_ROLLOUT` default disabled) — no source can poll without its flag.
