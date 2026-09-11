# Lane evidence — claim/issue-2439 (pi-issue-0509-2439)

Issue: Nishfleet/0509#2439 — `void handleGuardedBrowserRequest(request)` leaves
intercepted requests hanging and rejects unhandled on teardown races.

## What changed

- `app/lib/browser-run.server.ts` — wrapped the terminal
  `request.continue()` / `request.abort()` calls in
  `handleGuardedBrowserRequest` in try/catch so a lost target-closed race
  neither rejects unhandled nor stalls the page.
- `tests/browser-run.server.test.ts` — new `installPublicBrowserRequestGuard`
  describe: mock page captures the `request` handler; a `continue()`-rejecting
  request and an `abort()`-rejecting request each assert no
  `process.on("unhandledRejection")` fires.

## Pattern sweep

`setRequestInterception` / `request.continue()` / `request.abort()` appear
nowhere else in `app/lib/` — this file is the only instance. The only other
`void <promise>` in `app/lib/*.server.ts` (`fetch-timeout.server.ts:46`)
already ends in `.catch(() => undefined)`.

## Verification

- RED (before fix): `npx vitest run --configLoader runner --project node
  tests/browser-run.server.test.ts` — 2 failed / 7 passed; both new tests saw
  the rejection escape via `unhandledRejection`.
- GREEN (after fix): same command — 9 passed.
- Scope: `npx vitest run --configLoader runner --project node --changed
  origin/main` — 324 files / 4339 tests passed.
- `sgscan` — no new security findings.
- `crgate` — failed: "CodeRabbit is not signed in on this machine" (exit 3);
  auth is reserved, skipped.
- `npm run typecheck` not run locally per worker memory rule (fleet-ops#4891);
  CI `codex-node-checks` owns it.
