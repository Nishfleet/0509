# lane evidence — claim/issue-3778 (issue #3778: platform crypto + installed-lib swaps)

## Scope

Three file-level swaps from the #3772 §4 audit, one PR:

- `app/lib/constant-time-token.server.ts`: hand-rolled SHA-256-then-XOR compare
  → `crypto.subtle.timingSafeEqual` (workerd primitive, `worker-configuration.d.ts`).
  The SHA-256 prehash stays so the compare always runs on fixed-length digests.
- `app/lib/competitor-handoff.server.ts`: hand-rolled `base64url(payload).hexsig`
  → jose HS256 compact JWT (`SignJWT`/`jwtVerify`). Same compact claims
  `{d, ctry, cand}`; expiry moved to the registered `exp` claim (seconds),
  enforced by `jwtVerify`. Error mapping: `JWTExpired`→`expired`,
  `JWSSignatureVerificationFailed`→`invalid`, everything else→`malformed`.
- `app/lib/better-auth.server.ts` magic-link ticket envelope: hand-rolled
  `v1.<b64-iv>.<b64-ct>` AES-GCM → jose `EncryptJWT`/`jwtDecrypt`
  (JWE `dir`+`A256GCM`, same SHA-256-derived key). **Deliberate deviation from
  the audit's "HS256 JWT" wording**: the payload carries the redeemable
  magic-link `token`, so it must stay encrypted, not merely signed — a JWS
  would leak it to any cookie holder / DB reader. Same claims, same expiry:
  `expiresAt` (ms) ↔ `exp` (s). Hand-rolled `base64Url*` helpers deleted;
  ticket storage-id HMAC and `randomBetterAuthState` now use jose `base64url`.
- `app/lib/public-stable-id.ts`: hand-rolled FNV-1a → `@noble/hashes` sha256,
  first 4 bytes → u32 → base36. Same `prefix_<base36>` shape and length range;
  callers (report-builder rows, resource-export ids) mint ids at render time —
  nothing re-derives them for lookup, so value changes are safe.

## Test-env bridge (not glue)

`crypto.subtle.timingSafeEqual` is a workerd-only extension absent from plain
Node, where the `node` vitest project runs — the raw swap red'd 50 tests in 9
files. `tests/setup-runtime-primitives.ts` (registered via the node project's
`setupFiles` in `vite.config.ts`) installs it backed by Node's real
`node:crypto.timingSafeEqual` — same constant-time semantics, no hand-rolled
fallback in shipped code, no `node:` import in `app/` (codebase is
web-standard-only). The moved-then-reverted integration test run proved the
real primitive passes on real workerd (7/7 green).

## In-flight format break (accepted)

Old handoff tokens / magic-link envelopes issued before deploy fail verify →
callers degrade (re-request / re-sign-in). Worst case: one expired
double-confirmation within the 15/30-min TTL windows. Documented in PR body.

## Proof

- `npx vitest run --configLoader runner --project node tests/competitor-handoff.test.ts tests/auth.server.test.ts tests/auth-validation.test.ts tests/report-builder.test.ts tests/export.route.test.ts` → 89/89
- `npx vitest run --configLoader runner --project workers tests/integration/constant-time-token.integration.test.ts` → 7/7 on real workerd (then file moved back; node pool now covers it via the bridge)
- `npx vitest run --configLoader runner --project node tests/constant-time-token.server.test.ts tests/launch-readiness.route.test.ts tests/search.route.test.ts tests/stripe-checkout.route.test.ts` → 78/78 (the exact files the raw swap broke)
- `npx vitest run --configLoader runner --project node --changed origin/main` → 736 files / 9175 tests, 0 failures
- `semgrep --config p/default --baseline-commit $(git merge-base HEAD origin/main)` → clean
- `npm run typecheck` → left to CI per the worker memory budget (fleet-ops#4891)
