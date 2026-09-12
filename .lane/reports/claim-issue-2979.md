# Review — issue #0509-2979 (branch `claim/issue-2979`): Better Auth session cookie-cache

Reviewer pass over `git diff origin/main...HEAD`. Verified against better-auth **1.7.1** source in `node_modules/better-auth/dist/api/dispatch.mjs` (returnHeaders shape) and `node_modules/better-auth` 1.7.1 installed, plus the full diff (3 files, +427/−6).

## Files Reviewed
- `app/lib/better-auth.server.ts` (lines 261–289, 300–389, 712–752)
- `workers/app.ts` (lines 154–174, 419–431)
- `tests/integration/better-auth-cookie-cache.integration.test.ts` (all 323 lines)

## Critical (must fix)

None. Change is sound and shippable.

## Warnings (should fix)

- `app/lib/better-auth.server.ts:384` — `new Response(response.body, ...)` is the standard preserve-identity pattern in Workers (streamed body passes through by reference) and is same-shaped as `workers/security-headers.ts:338`, so it's consistent with house style. Note only: if `response.body` ever arrives already-disturbed, the throw is caught by the app.ts wrapper and the response ships cookie-less — safe, worst case is a lost cache re-mint for one request.
- `app/lib/better-auth.server.ts:299-312` — The `as unknown as` cast is validated against better-auth 1.7.1 dispatch source and is **correct** (`returnHeaders` without `returnStatus` yields `{ headers, response }`, confirmed in `node_modules/better-auth/dist/api/dispatch.mjs:258-262`). But that version-pinned bool is invisible to the compiler — a future better-auth minor that changes the return shape would silently feed `session` = a Headers object or undefined and every user would be logged out at runtime. Cheap defense: one runtime `typeof session?.session?.userId === "string"` check before the cast-shaped use, or a typed helper that narrows without `as unknown`.
- `app/lib/better-auth.server.ts:341-362` — `rememberBetterAuthSessionCookies` deliberately plain-loses a second `getSession` call's headers within the same request (WeakMap overwrite, last-writer-wins). Fine today (React Router runs one loader/action per request; better-auth emits only the cache re-mint per call), but worth a comment before anyone "optimizes" by reusing the Map key across multiple auth calls — silent cookie loss is the failure shape, not an error.

## Suggestions (consider)

- `tests/integration/better-auth-cookie-cache.integration.test.ts:214-216` — `expect(cleared).toContain("better-auth.session_data=")` cannot distinguish an expiring (`Max-Age=0`) cookie from a fresh set, because a fresh set-cookie header also contains `name=`. Tighten to assert the expiry attribute (e.g. `toContain("better-auth.session_data=;")` + `toContain("Expires=Thu, 01 Jan 1970")` — match the actual better-auth clearing sentinel) so sign-out invalidation is actually proven, not coincidental.
- `tests/integration/...test.ts:250-323` — the timing probe outputs medians but no assertion on ordering; fine as labelled "not a gate", but it's the first thing to die in a slow CI runner. Consider `it.fails`-style flip or moving it behind an env flag so a noisy CI doesn't grow eyes on it.
- `workers/app.ts:160` — `replayBetterAuthSessionCookies` runs the dynamic import per request even when there's nothing buffered. If this module is already static-imported anywhere in the worker graph, consider hoisting to a top-level import; otherwise leave it.
- Consider asserting in the zero-D1-read test thatreads stay zero across **two consecutive** cached requests in the same test (the current single-request check can mask a one-shot fluke such as an in-memory memo at the fixture layer and still pass).

## Summary

After correction of an initial reading, verified by re-reading the diff: the try/catch in `workers/app.ts:161-166` wraps both the dynamic import AND the `applyBetterAuthSessionCookies` call, so all replay failures (including response reconstruction) degrade to "ship untouched". Verified sound against better-auth 1.7.1 upstream: `returnHeaders:true` returns `{ headers, response }` (dispatch.mjs:258), `cookieCache:{enabled,maxAge}` is the documented option, and the whole cached path runs without DB, as proven by the new integration test on real workerd + real D1 migrations (counting proxy shows 0 reads on the cached path, >0 on the uncached path, correct plan-change freshness because plan is DB-read not session-payload). Staleness is bounded to 45s including revocation — that's the explicit product of `maxAge`, not a bug, and sign-out clear-cookies are proven in test 2. `applyBetterAuthSessionCookies` is keyed on the same Request instance app.ts threads into `requestHandler`, with take-and-consume semantics: no cross-request/user leakage. Only replayer Set-Cookie (not Better Auth's private/no-store headers) avoids any clash with the security-headers layer (which also rebuilds via `new Headers(response.headers)` and cannot drop Set-Cookie). No correctness or security regression found. All four acceptance criteria met; main fix-up wanted is tightening the sign-out assertion and hardening the response-rebuild try/catch.
