# Lane evidence — claim/issue-3209

Issue: Nishfleet/0509#3209 — feat(mentions): capture mentions from review sites (G2/Capterra/Trustpilot public pages) into the mention table (split of #3171).

## What shipped

- `app/lib/presence-connectors/review-sites.server.ts` — new `review_sites` presence connector. First wired provider: Trustpilot public business-unit review pages (`trustpilot.com/review/<domain>`); the contract is the page's own published schema.org/Review JSON-LD — no account, no key, no vendor. Canonical mention URL = the published `/reviews/<uuid>` permalink (301-confirmed); dedup rides the `(source_target_id, url_hash)` UNIQUE constraint via `upsertPresenceItems`. Rate budget: exactly ONE serialized GET per poll, no pagination; the published ~20-review window is re-read and deduped.
- Fail-closed capture-validity gate: AWS-WAF/DataDome challenge pages (403 or 200-with-JS) and unparsable bodies record honest failures (`review_site_challenge` / `review_site_parse_failed` / `rate_limited`) — never fabricated mentions. A business unit with zero published reviews is an honest empty ok.
- Kill flag: `PRESENCE_REVIEW_SITES_ROLLOUT` (disabled default) via `evaluateConnectorAccessGate`; flag off = `connector_not_operational` with zero requests.
- `migrations/0103_widen_source_target_connector_review_sites.sql` — expand-only CHECK widen (table-rebuild convention of 0093/0098–0102); renumbered 0101→0103 after the 0102 podcast widen landed first.
- `docs/mentions/PLAN.md` — survey-table row + §8 research log (searched + rejected collectors, dated: GitHub star-sorted trustpilot/g2 scrapers, npm trustpilot packages — all rejected: stale, presentation-glue, Apify-actor exports, or key-gated Business-API clients). G2/Capterra documented-not-wired: public pages bot-verified (challenge fixture committed), documented APIs partner/paid; a g2/capterra target answers `provider_not_wired_yet`.
- `/status` per-source row via `presenceSourceCoverageForDocs` (gated) + `evaluatePresenceSourceCoverage` → `PUBLIC_WEB_BEST_EFFORT`.

## Shared interface

No edits to the shared interface — `presence-types.ts` gains only the `review_sites` enum entries; connector/PollResult/NormalizedPresenceItem shapes unchanged. Adapter interface + mention table reused from #3178.

## Verification (this unit, pi-issue-0509-3209, 2026-09-14)

- `npx vitest run --configLoader runner --project workers tests/integration/review-sites-mention-connector.integration.test.ts` → 9/9 passed (real workerd + real migrations: fixture e2e = 20 mentions, dedup on re-poll = 0 new, one-request budget proven, challenge/429/garbage fail-closed, kill-flag zero-request).
- `npx vitest run --configLoader runner --project node --changed origin/main` → 376 files / 4726 tests passed.
- This lane resumed from salvage: worktree arrived mid-merge with conflicts resolved-but-uncommitted plus a stray `{` syntax error in `presenceSourceCoverageForDocs` — merge concluded onto newest main, syntax fixed in commit b13bf2cb7.
