# Auth Runtime

Last checked: 2026-05-13

## Decision

Keep Five to Nine on Better Auth with Cloudflare D1 for launch and pilots.

Do not migrate to Stytch for this launch-readiness slice.

## Current Active Runtime

- Active app code lives in `app/` and `workers/`.
- Auth is implemented with `better-auth`.
- User, session, plan, onboarding, workspace, and product data are stored in Cloudflare D1.
- `BETTER_AUTH_SECRET` is the required production auth secret.
- The `/api/auth/*` route is handled by Better Auth.

## Supabase Status

Supabase appears only in `legacy/`, which is the old Next.js prototype reference.

Supabase is not part of the active Cloudflare Worker runtime. Do not move legacy Supabase code forward unless a future task explicitly migrates a specific useful idea into the active D1 model.

## Stytch Status

Stytch is a deferred option, not a current dependency.

Consider Stytch later if Five to Nine needs:

- B2B organizations as a first-class auth model
- SSO or SCIM
- enterprise RBAC/admin portals
- outsourced auth migration support

Until then, Stytch would add migration cost without solving the current launch blocker: fresh commercial discovery.

## Guardrail

`tests/auth-runtime.test.ts` checks that active runtime files do not import Supabase or Stytch and that package dependencies stay on Better Auth without active Supabase/Stytch packages.
