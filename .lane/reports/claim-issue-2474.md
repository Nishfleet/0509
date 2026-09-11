# Lane evidence — claim/issue-2474

Issue: Nishfleet/0509#2474 — `f9_anon_search` cookie set without `Secure`.

## Change

- `app/routes/search.tsx` `buildAnonSearchSetCookie`: appended `Secure` to the
  attribute list (one token, per finding fix). Comment above the constant
  updated to list `Secure`.
- `tests/search.route.test.ts`: new test "marks the anonymous search cookie
  Secure" — runs the loader as a fresh anonymous search and asserts the
  `Set-Cookie` header matches `/\bSecure\b/`.

## Same-pattern sweep

- `app/routes/search.tsx`: `buildAnonSearchSetCookie` is the only cookie
  builder; both call sites (success `data()` headers and the anonymous-429
  response) route through it — fixed.
- Siblings already `Secure`-conditional on `request.url` protocol:
  `app/lib/better-auth.server.ts` `buildCookie`, `app/lib/signup-source.ts`
  `signupSourceCookieHeader`.
- `app/routes/auth.logout.ts` `f9_e2e_fixture` clear is a test-fixture
  `Max-Age=0` deletion, not a persistent identity cookie — not the pattern.

## Verification

- RED: `npx vitest run tests/search.route.test.ts -t "anonymous search cookie"`
  → 1 failed (`expected 'f9_anon_search=...; HttpOnly; SameSite=Lax; Path=/;
  Max-Age=2592000' to match /\bSecure\b/`).
- GREEN: `npx vitest run tests/search.route.test.ts` → 48/48 passed.
- GREEN: `npx vitest run tests/search` → 44 files, 592 tests passed.
- Typecheck: not run locally (fleet-ops#4891 — CI `codex-node-checks` owns
  `npm run typecheck`).
