# Lane evidence: claim/issue-2404

Ship the Google OAuth button on signup by setting
`BETTER_AUTH_OAUTH_BRANDED_PROVIDERS=google` in production vars.

## Changes

- `wrangler.jsonc`: added `"BETTER_AUTH_OAUTH_BRANDED_PROVIDERS": "google"`
  to `vars` with a comment naming the branding gate and the rollback;
  updated the secrets comment block to record the flag now lives in vars.

## Why vars, not `wrangler secret put`

The value `"google"` is not secret, and the issue's `do:` step is a repo
change. The flag is the brand-verified allowlist read by
`isBetterAuthOAuthProviderBrandVerified`; the provider still requires the
`BETTER_AUTH_GOOGLE_CLIENT_ID`/`BETTER_AUTH_GOOGLE_CLIENT_SECRET` secrets, so
it fails closed — without the secrets nothing is exposed.

## Branding gate status

The documented gate (`docs/auth-runtime.md`): the account chooser/consent
must show Five to Nine or 0509 branding. That check is only observable by
starting the real Google flow, which requires the flag plus the secrets —
so verification is post-deploy: POST `/auth/better/oauth` with
`provider=google`, follow the redirect to `accounts.google.com`, and read
the app name. If it is not Five to Nine / 0509, rollback is removing
`"google"` from the list. If the button does not render post-deploy, the
secrets are absent and the issue needs the owner-side Google Auth Platform
setup.

## Verification

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → no affected test files (config-only change), exit 0.
- `npx vitest run --configLoader runner --project node` on the 12 suites
  that read `wrangler.jsonc` or the auth provider gating
  (search-rollout-config, funnel-measurement, fullsite-watch-enablement,
  env.server, auth.server, auth-form-signup-guidance, deploy-production-gate,
  worker-schedule, market-signal-snapshot,
  scheduled-observation-health.server, customer-claim-surface-registry,
  customer-readiness-candidate) → 223 passed, 0 failed.
- Live pre-change probe: `curl -sS https://0509.io/auth/signup` renders no
  OAuth button — consistent with the flag being unset.
