## What
Extract the four watchlist agent handlers from the 2,436-line `app/lib/customer-agent-actions.server.ts` into a watchlist leaf file `app/lib/customer-agent-actions/watchlists.server.ts`, following the existing `customer-agent-actions/` leaf pattern (as `support-cases.server.ts` / `web-mentions.server.ts` do).

Moved:
- `createWatchlistFromAgent`
- `updateWatchlistFromAgent`
- `refreshWatchlistFromAgent`
- `setWatchlistActiveFromAgent`

Also relocated the shared `actionReversal` helper (used by the watchlist and delivery handlers) and the watchlist-refresh failure formatters (`formatWatchlistRefreshFailure`, `formatRetryAfterLabel`) into the leaf so there is no circular main<->leaf import. Heavy dependencies stay lazy-loaded (`await import(...)`) exactly as before; the leaf imports shared utilities from `customer-agent-actions/request.server`. The main dispatcher re-imports all four handlers and `actionReversal`.

net-positive-because: the four handlers and two helpers (428 lines) relocate out of the main file (-428), and the new standalone leaf adds a self-contained import header/top-level module glue (+441); the main file drops to ~2,007 lines and the moved code compiles the same. Net +20 lines is module-boundary overhead, not new logic.

## Verification
- `npx vitest run --configLoader runner --project node --changed origin/main` -> 6 files, 135 tests passed.
- `npx vitest run --configLoader runner --project node tests/customer-agent-actions.server.test.ts` -> 1 file, 78 tests passed.
- Main file: 2,436 -> 2,007 lines.

## run-proof
- Local affected `--project node` suite green (135 tests across 6 files). CI owns typecheck/coverage per fleet policy.

## Scope
Touches only the two files in `files:` (`app/lib/customer-agent-actions.server.ts`, new `app/lib/customer-agent-actions/watchlists.server.ts`). No new mechanism, script, or organ. No product copy. No test weakened.

## Reviewer round (one round, before arm)
Reviewer seat: `opencode/nemotron-3-ultra-free` (resolved via `find_senior_seat`).

- **Critical:** none.
- **Warning:** none.
- **Act on (Consider->fixed):** leaf had double blank lines between moved functions; collapsed to single blank lines to match codebase style.
- **Consider:** `setWatchlistActiveFromAgent` takes an unused `actorUserId` — **Noted**, pre-existing (unused in the original dispatcher too), not a regression; dropping it is out of the pure-move scope.
- **Noted:** the four `if (actionName === ...)` dispatch guards for watchlists could be a map/switch — pre-existing shape, out of the must-do scope (rewriting is out-of-bounds for this issue).

Reviewer verdict: diff is a pure move, only the two permitted files touched, no main<->leaf import cycle, test files unmodified (none weakened/skipped). Ship.

Closes #2341
