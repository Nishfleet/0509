# claim/issue-3775 — connector duplicate consolidation (issue #3775)

Scope: three dedup bullets from the #3772 app/lib audit. Consolidation only, no
behaviour change.

## What changed

- `app/lib/sources/capture-usage.server.ts` (new): one KV day-counter helper
  parameterised by source id (`<id>:captures:YYYY-MM-DD`, 35d TTL, today +
  yesterday union read, best-effort try/catch). Replaces the two identical
  counter implementations.
- `app/lib/sources/linkedin-ads/linkedin-ads-usage.server.ts` and
  `app/lib/sources/google-ads/google-ads-usage.server.ts`: thin wrappers over
  the shared helper; exported names, types, KV key prefixes unchanged.
- `app/lib/presence-quota-ledger.server.ts` (new): shared tumbling-window
  quota ledger — `parseCursorJson` + `readQuotaWindowLedger(db,
  {connectorId, cursorKey, windowMs}, targetId)` returning `{used,
  nextCursor(counted, extra)}`.
- `reddit.server.ts`, `threads.server.ts`: call the shared ledger directly;
  per-connector `readUsageWindow`/`parseCursorJson`/`*Usage` copies deleted.
- `youtube.server.ts`: `readYouTubeUsage` kept as a thin adapter — its
  `nextCursor(priorRecord, watermarkIso)` signature carries the
  `lastItemPublishedAt` watermark fold; maps onto the shared
  `nextCursor(counted, extra)` with identical spread order.
- `website.server.ts`: local `parseFeedItems`/`extractTag`/`stripHtml`
  deleted; imports the exported rss.server versions (pinterest precedent).

## Issue-text divergence (verified against code, not silently dropped)

- `x.server.ts` is NOT part of the shared ledger: it never touches
  `env.DB`/cross-target reads. Its `cursor.meteredReads` is a per-UTC-day
  `{requests, posts}` observability map pruned to 31 days — a different shape
  with no cap enforcement. Left untouched.
- website feed items now carry a real `contentHash` and `raw.format` (the rss
  parser is the "more complete" version the issue names); previously
  `contentHash: ""` and no `format` key.
- youtube no-DB `nextCursor` no longer stamps a vestigial `youtubeUsage`
  window — unobservable: without DB the cursor cannot persist.

## Verification (this worktree, claim/issue-3775 @ b14f7c7 base)

- `npx vitest run --project node` on the five touched-surface test files:
  5 files / 43 tests pass.
- `npx vitest run --project workers` on the 11 connector integration files
  (reddit, threads, youtube x2, website x4, rss x2, pinterest): 143 tests
  pass on real D1/workerd — cap enforcement, window rotation, and cursor
  persistence proven.
- `npx vitest run --configLoader runner --project node --changed origin/main`
  (vitest affected-tests mode): 144 files / 1743 tests pass.
- semgrep (canonical no-hand-built-orchestration ruleset @4738f06 +
  p/default) on all touched files: zero findings.
- typecheck: CI-owned (`codex-node-checks` runs `npm run typecheck`); not run
  locally per fleet-ops#4891 memory budget.
