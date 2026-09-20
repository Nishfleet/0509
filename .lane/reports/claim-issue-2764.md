# Lane evidence — claim/issue-2764 (issue Nishfleet/0509#2764)

Scope: `emailVerification.sendVerificationEmail` in `app/lib/better-auth.server.ts`
wrapped `sendEmailVerificationEmail` in `promiseWithTimeout(..., 10_000)` — the
same duration as the provider's inner `CLOUDFLARE_EMAIL_SEND_TIMEOUT_MS` inside
`sendCloudflareEmail`. The outer timer starts earlier (before the suppression
consult + render), so it always won the race: Better Auth saw a thrown
`PromiseTimeoutError` while `env.EMAIL.send` was still in flight, and a user
retry could send a second verification email. The inner bound resolves a slow
send as a recorded `"pending"` — the graceful path was unreachable from this
call site.

## Change

`BETTER_AUTH_EMAIL_SEND_TIMEOUT_MS` is now `CLOUDFLARE_EMAIL_SEND_TIMEOUT_MS +
5_000` (15s) — strictly larger by construction, covering the D1 suppression
read, render, bounce bookkeeping and post-send attempt record around the
provider send. One line plus the import of the provider constant into
`better-auth.server.ts` (module already imported from there; no new edge).

Sibling call sites sharing the constant:

- `sendBetterAuthMagicLink` wraps a raw `env.EMAIL.send` with no inner bound —
  the constant remains its sole timeout (10s -> 15s).
- `maybeSendWelcomeEmail` nests the same way through `sendWelcomeEmail`; the
  race there is now fixed too (errors were already swallowed, claim
  idempotency owns exactly-once).

## Verification

- New test `tests/auth.server.test.ts` > "lets a send slower than the provider
  bound resolve instead of racing it": mocks `~/lib/delivery.server`'s
  `sendEmailVerificationEmail` to resolve at inner-bound+1s under fake timers
  and drives the captured `emailVerification.sendVerificationEmail` callback.
  Fails pre-fix with `PromiseTimeoutError: Better Auth verification email
  timed out.` (stash-proven), passes post-fix.
- `npx vitest run tests/auth.server.test.ts` — 50/50 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main`
  — 381/385 files green on first run; the 4 red suites were `Cannot find
  package '@atcute/client'` after the mid-run rebase pulled in #3819's dep.
  Re-ran those files post-`npm install`: 110/110 pass.
- `semgrep --config p/default --baseline-commit $(git merge-base HEAD
  origin/main) --quiet --metrics=off` — clean, no findings.
- Typecheck/coverage left to CI per the worker memory-budget rule
  (fleet-ops#4891).

## Preserved invariants

- Provider send bound and its `"pending"` outcome in `sendCloudflareEmail`
  unchanged; `sendEmailVerificationEmail` still throws only on
  `status === "failed"`.
- Magic-link send remains bounded (sole bound, now 15s) and still feeds
  definite provider failures to the bounce ledger.
- Better Auth still sees a thrown error on a definite verification-send
  failure; only the premature race-throw is gone.
