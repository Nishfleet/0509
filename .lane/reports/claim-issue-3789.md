# Lane evidence — claim/issue-3789 (issue Nishfleet/0509#3789)

Scope: research AT Protocol clients, then swap the Bluesky presence connector's
hand-rolled XRPC layer for the winner. Research findings (full table with
numbers) posted on the issue: https://github.com/Nishfleet/0509/issues/3789#issuecomment-5749764572

## Decision

`@atcute/client` 5.1.2 (+ `@atcute/bluesky` 4.0.21 + `@atcute/atproto` 4.0.4 for
ambient call typing). Runners-up measured and rejected on this branch:

| candidate | wrangler deploy --dry-run delta (gzip) | verdict |
|---|---|---|
| baseline (raw fetch) | 3831.68 KiB | status quo |
| @atproto/api | +151.92 KiB | too heavy for 2 methods |
| @atproto/xrpc | +39.30 KiB | needs vendored lexicons anyway |
| @atproto/lex-client + lex-schema | +66.14 KiB | schema-first, 0.3.x moving API |
| @skyware/bot | +57.24 KiB | no fetch injection — fails ctx.fetchImpl/SSRF contract |
| @atcute/client | +3.06 KiB (probe) / +3.47 KiB (merged impl) | winner |

## Verification (all on this worktree, real workerd)

- `npx vitest run --configLoader runner --project workers tests/integration/bluesky-mention-connector.integration.test.ts`
  — 23/23 pass (21 existing + 2 new over-cap/unparseable-body parity tests)
- `npx vitest run --configLoader runner --project node --changed origin/main`
  — 731 files / 9130 tests pass
- `semgrep --config p/default --baseline-commit <merge-base>` — clean
- `wrangler deploy --dry-run` — Total Upload 14502.67 KiB / gzip 3835.15 KiB
  (delta +9.08 KiB raw / +3.47 KiB gzip vs baseline)
- Scoped `tsc` probe of the connector — 0 errors in bluesky.server.ts; ambient
  NSID types registered (keyof XRPCProcedures bound)

## Preserved invariants

- SSRF gate (`resolvePublicHttpUrl`) runs inside the injected fetch handler on
  every request the library makes; EndpointBlockedError maps to existing codes
- 10s fetchWithTimeout + ctx.fetchImpl injection unchanged
- Body caps enforced before the library parses: 16 KiB session / 512 KiB search
  (over-cap reads as a 502 ResponseTooLarge to the lib -> bluesky_api_error)
- Gating, phrase validation, PRESENCE_BLUESKY_MOCK, presenceContentHash,
  cursor pagination (MAX_PAGES=2), JWT-in-closure hygiene — all unchanged
- HTTP-error-body -> empty page parity preserved; unparseable/over-cap ->
  bluesky_api_error parity preserved (new tests pin both)
