# Lane evidence — claim/issue-3173 (unit pi-issue-0509-3173)

Issue: Nishfleet/0509#3173 — onboarding epic #3172 slice 1: one-input identity
resolution + confirm card (`/join`).

## What shipped

- `app/lib/join-identity.server.ts` — classify (domain/person/brand), resolve
  the card inside one 3 s wall-clock budget (never throws; whatever resolved
  ships), D1 ad evidence + advertiser candidates (LIKE-escaped), one bounded
  homepage probe via the shared public-URL guard. Person-profile URLs never
  pin the platform as the user's domain.
- `app/routes/join.tsx` — `/join` one-field route; resolve intent returns the
  card JSON (fetcher or document POST, pre-hydration safe via actionData);
  confirm intent folds into `/auth/signup?competitor=&name=&redirectTo=`
  (existing #2414/#2415 prefill contract — verified in `auth.signup.tsx`);
  `join_identity_confirm` structured log carries `confirm_latency_ms` from a
  first-touch cookie (time-to-first-confirm metric source).
- `app/routes.ts` — `route("join", ...)`.
- `app/app.css` — join form/card/candidate styles on existing f9 tokens.
- `e2e/join-identity-card.spec.ts` + `playwright.config.ts` `join-flow`
  project — domain / brand / person-profile / ambiguous-person / JS-off
  document-POST cases, 5 s card budget asserted submit→visible.
- `scripts/local-release-server.mjs` — shared e2e server now launches with
  `E2E_JOIN_LIVE_LOOKUP=0` so the card is deterministic (the earlier
  `process.env` line in the spec ran in the Playwright worker, not the
  server — fixed to the real mechanism).

## Verification

- `npx vitest run --configLoader runner --project node tests/join-identity.test.ts tests/local-release-server.test.ts` — 28/28 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main` — 27 files pass; 2 failures in `tests/deploy-production-gate.test.ts` reproduced identically on clean `origin/main` (75b2c0315) — pre-existing, filed as #3257.
- `git diff origin/main..HEAD` — 9 files, +1660/-0: only the join slice.

## Notes for the next lane

- The remote claim branch was reset to the main tip when the prior unit hit
  StartLimitBurst; local work was intact and was merged forward + pushed.
- A prior commit had deleted `.lane/reports/claim-issue-3003.md` (another
  lane's evidence present on main); restored in fa28a3e88.
