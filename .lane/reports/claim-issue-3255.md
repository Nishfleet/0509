# Lane evidence — claim/issue-3255 (unit pi-issue-0509-3255, issue #3255)

X mention-search activation wiring — PARKED under the MONEY flag. Code-side
connector work only; no paid X usage activated and no money spent.

## What shipped

- `app/lib/presence-connectors/x.server.ts` — query-type source targets
  (`metadata_json.targetType === "query"` + `matchPhrase` + optional
  `canonicalUrl`) alongside the existing handle targets. Query targets build the
  search through the canonical `buildMentionQuery` (`"Label" OR "domain"`) plus
  `-is:retweet`; handle targets ride `from:<handle> -is:retweet` on the same
  metered endpoint. Poll issues `GET /2/tweets/search/recent` (X API v2) through
  `presenceSafeFetch` (SSRF re-validation + bounded response); the bearer token
  is injected by wrapping `fetchImpl`. Results normalize to presence items:
  `https://x.com/<user>/status/<id>` canonical URL, `@author`, `created_at` →
  `publishedAt`, `presenceContentHash` → `contentHash`. Empty results →
  `{ ok: true, items: [] }`.
- Metered reads persist in `presence_poll_cursor.cursor_json` under
  `meteredReads` — `{ requests, posts }` per UTC day, merged forward across
  polls, pruned to 31 day keys. `since_id` incremental polling via cursor
  `sinceId`. `costUnits` = posts read.
- MONEY flag: `X_PAID_ACCESS=approved` is the spend-decision clearance
  (`paid_source_pending_nish` until set). While unset, `validateTarget`,
  `poll`, and `healthCheck` all report the pending reason and **no network
  request is issued** — asserted by the suite (`calls.length === 0`). Rollout
  (`PRESENCE_X_ROLLOUT`) and `X_API_BEARER_TOKEN` gating unchanged and still
  checked first. `PRESENCE_X_MOCK=1` short-circuits before all gates (existing
  mock tests unaffected).
- `app/lib/env.server.ts` — `X_PAID_ACCESS` + `X_API_BASE_URL` (test/ops base
  override; still SSRF-checked per request).
- `app/lib/presence-connector-registry.server.ts` — `options.cursor.record`
  added (prior `cursor_json` passed to connectors that meter); `xConnector.poll`
  now receives `target` + `cursor` like rss/website.
- `app/lib/presence-service.server.ts` — `pollPresenceSourceTarget` passes
  `record: cursor.cursor` through.
- `app/lib/presence-source-coverage.server.ts` — with rollout+token but no paid
  approval, X coverage reports `gated` + `paid_source_pending_nish` +
  `UNAVAILABLE` (never implied live); docs row notes updated to say paid
  pay-per-use reads are metered and pending.
- `app/lib/presence-customer-copy.ts` — `paid_source_pending_nish` maps to
  honest "paid source, not active yet" customer copy.
- `tests/presence-source-coverage.test.ts` — existing "x available" test gained
  `X_PAID_ACCESS: "approved"` (fully-enabled env now includes spend clearance);
  new test pins the gated/paid-pending state.
- NEW `tests/integration/x-mention-search.integration.test.ts` — 16 tests on
  real workerd + real migrations/D1. Network is hermetic:
  `X_API_BASE_URL=https://1.1.1.1` (IP literal → `resolvePublicHttpUrl` skips
  DNS) + mock `fetchImpl` serving the search payload, while asserting the
  request still flows through `presenceSafeFetch` with the bearer header.

## Termination command

```bash
npx vitest run tests/integration/x-mention-search.integration.test.ts
# 16 passed | exit 0
```

## Other verification

- `npx vitest run --configLoader runner --project node --changed origin/main`:
  4547 passed / 3 failed — all 3 in `tests/launch-readiness-guard.route.test.ts`
  and **pre-existing on base 351f011a1** (reproduced on a clean detached
  worktree with the same node_modules; identical failures). My diff is
  presence-only and cannot reach that route's error serialization.
- `mention-source-activation` + `presence-poll-targets` integration suites:
  10/10 pass (existing X mock path + service plumbing unaffected).
- verify-0509: `npm run e2e:serve:local` → `/api/health` 200,
  `/api/health/deep` `d1:ok`, `/app/presence` 302→login (module chain compiles),
  `/` `/brands` `/bots/presence` render.

## Scope notes

- No migration needed: `source_target.connector_id` CHECK already allows `x`
  (migration 0055).
- Untouched per issue constraints: `.github/**`, `scripts/ci-*`,
  `migrations/**`, plan/entitlement files, competitor-site-monitor, other
  connectors.
- `X_PAID_ACCESS` is unset everywhere — production stays parked; activation is
  a separate spend decision recorded in `docs/mentions/PLAN.md`.

## Round 2 — CI verdict + fix (same session, 2026-09-12)

CI ran on head ae8addfe9: 3 of 20 checks failed. Two root causes, both
worker-owned, both fixed:

1. **`codex-node-checks` + `preview-assert`: TS4058** —
   `app/lib/presence-connector-registry.server.ts(25,17)/(29,17)` "Return type
   of exported function has or is using name 'XPollCursor' from external
   module .../x.server but cannot be named". Cause: the prior round typed
   `xConnector.poll(ctx, target?: XPollTarget, cursor?: XPollCursor)` with
   non-exported named interfaces; declaration emit could not import them into
   the registry's inferred return type. Fix: `export type XPollTarget` /
   `export interface XPollCursor` from `x.server.ts` (type-only, no runtime
   change). rss/website avoid this by inlining; here the shapes are also used
   by module-internal helpers, so exporting the named contract is the smaller,
   truthful fix.
2. **`codex-node-checks-shard-4`: no-time-bomb gate (issue #3215)** —
   "tests/integration/x-mention-search.integration.test.ts: 3 absolute
   timestamp literal(s) in a file that reads Date.now()/new Date()". Cause: 3
   ISO literals (2 in the mocked X payload, 1 in the publishedAt assertion)
   in a file that also reads `new Date()` (metering "today" key). Fix: hoisted
   both instants into module consts, each carrying `// fixed-date: <why>` on
   the line above — the gate's documented escape for genuinely historical
   fixtures; the payload instants are asserted verbatim and never compared
   against the wall clock.

Proof after the fix:

- Termination command: `npx vitest run tests/integration/x-mention-search.integration.test.ts` → **16 passed, exit 0**.
- `npx vitest run tests/no-time-bomb-fixtures.test.ts` → **1 passed, exit 0**.
