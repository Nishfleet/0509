# Disable the workers.dev duplicate origin and pin Better Auth trusted origins

## Summary

Closes #2350

1. **`wrangler.jsonc`** — add `"workers_dev": false`. The Worker routes six
   custom domains (`0509.io/.in` + `www.`/`api.`) but previously had no
   `workers_dev` key, so the unassigned
   `<account-subdomain>.workers.dev` hostname could still serve the full app.
   Disabling the workers.dev route means that origin is no longer served, so
   it cannot be auto-trusted.
2. **`app/lib/better-auth.server.ts`** — remove the unconditional
   `new URL(request.url).origin` entry from `betterAuthTrustedOrigins`.
   The trusted list is now pinned to the canonical origin list only:
   `BETTER_AUTH_URL`/`APP_ORIGIN` plus any explicitly configured
   `BETTER_AUTH_TRUSTED_ORIGINS`. An arbitrary caller-supplied request origin
   (e.g. a workers.dev host) is never folded in for auth redirects/CORS.
   `betterAuthTrustedOrigins` is exported so the list can be pinned by a test.
3. **`tests/auth.server.test.ts`** — add a unit test pinning trusted origins
   to the canonical list and asserting an unlisted request host
   (e.g. `0509.example.workers.dev`) is never auto-trusted.

## Termination

`npm test` standalone (node project below; the `workers` project is skipped
because the diff does not touch `migrations/**` or `tests/integration/**`).

## Verification

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → `Test Files 182 passed (182)` / `Tests 2246 passed (2246)`.
- `npx vitest run --configLoader runner --project node tests/auth.server.test.ts`
  → `Test Files 1 passed (1)` / `Tests 48 passed (48)`, including the new
  "pins trusted origins to the canonical list without the request origin".
- `wrangler.jsonc` `workers_dev` key validated against
  `node_modules/wrangler/config-schema.json`.

run-proof: vitest node project, 182 files / 2246 tests, 2026-09-10
net-positive-because: the +23 net lines are the new pinned trusted-origins
  unit test; the production change is net-zero (`workers_dev: false` row plus
  removal of one request-origin entry from the trusted list).

## Note on the curl probe

The issue asked to resolve the workers.dev hostname via `wrangler whoami` and
`curl -I` it. The worker environment has no durable wrangler/Cloudflare
credentials (`wrangler whoami` → "not authenticated"), so the exact account
subdomain cannot be resolved from this unit. The durable fix is
`workers_dev: false`, which deterministically disables the workers.dev route
(the workers.dev URL then answers with an error instead of serving the app),
and the added unit test pins the auth-side trusted list to the canonical
origin list. This satisfies the acceptance criteria without a live probe.
## Review

Reviewer seat: `cursor/cursor-grok-4.6-high` (reviewer-senior, one round).

Review-adjudication buckets:
- **Act on** — none. No Critical findings.
- **Consider** — `betterAuthTrustedOrigins` still includes `appOrigin()`, which falls back to `new URL(request.url).origin` only when both `APP_ORIGIN` and `BETTER_AUTH_URL` are unset. Not a prod hole: `wrangler.jsonc` always sets both, and `isBetterAuthConfigured` already gates Better Auth on one of them. Not changed; a test asserting the pin under that misconfiguration would fail by design.
- **Noted** — workers.dev URL not live-probed (no durable wrangler credentials in the worker; `workers_dev: false` is the deterministic switch; post-deploy check remains the real proof). `isSameOriginAuthFormPost` keeps its request-origin line (correct CSRF behavior, separate from CORS/redirect trust). `workers/primary-domain.ts` correctly unchanged (the judge's "or 308 it" was resolved to `workers_dev: false`; a workers.dev 308 would never run once the hostname is unassigned).
- **Dismissed-with-reason** — none.
