# Auth Runtime

Last checked: 2026-06-22

## Decision

Use Better Auth for Five to Nine auth.

Cloudflare D1 remains the app data store. Product data, billing links, watchlists, digests, collections, customer API keys, and delivery targets stay keyed by the app-owned `user.id`.

## Current Active Runtime

- Active app code lives in `app/` and `workers/`.
- Better Auth is mounted at `/api/auth/*` through `app/routes/api.auth.$.ts`.
- Better Auth uses the Cloudflare D1 binding directly for `user`, `session`, `account`, `verification`, and `passkey`.
- Magic-link email is the primary auth path. The app sends links through the Cloudflare Email binding, not a third-party email API key.
- Magic-link emails open `/auth/better/magic-link`, a non-redeeming app confirmation URL built from Better Auth's generated token URL. The email URL contains only a short-lived app ticket (`?ticket=`); the raw Better Auth token and callback URLs are encrypted server-side in D1 and indexed by an HMAC identifier. GET requests on ticket links only stage an HTTP-only confirmation cookie and redirect to a same-origin confirmation page — they do not verify or consume the token (email security scanners cannot burn links). The confirmation button issues a same-origin POST that calls Better Auth's documented verify handler server-side, then clears the temporary cookie. Better Auth still owns token verification, expiry, single-use consumption, session cookie issuance, and the final redirect to `callbackURL` or `newUserCallbackURL`. Legacy pre-deploy `?token=` links still stage via GET and redeem via POST until those 15-minute links expire.
- Google and Microsoft OAuth are optional. Buttons render only when their Better Auth client ID and secret are configured and the provider is present in `BETTER_AUTH_OAUTH_BRANDED_PROVIDERS`. Microsoft also requires `BETTER_AUTH_MICROSOFT_ACCOUNT_LINKING_TRUSTED=true` before it is registered for same-email account linking.
- Passkeys use `@better-auth/passkey`; the app no longer owns WebAuthn challenge or credential verification routes.
- Protected routes call `app/lib/auth.server.ts`, which reads the Better Auth session and maps it into the app `AppSession` shape.
- Login links are sign-in only: `/auth/login` checks for an existing local `user` before sending a link. `/auth/signup` is the account creation path.

## Required Runtime Values

- `APP_ORIGIN`
- `AUTH_PROVIDER=better-auth`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `EMAIL_FROM_EMAIL`
- Cloudflare `EMAIL` send binding
- Cloudflare `DB` D1 binding
- `UNSUBSCRIBE_SIGNING_SECRET` for signed unsubscribe links

## Optional Runtime Values

- `BETTER_AUTH_GOOGLE_CLIENT_ID`
- `BETTER_AUTH_GOOGLE_CLIENT_SECRET`
- `BETTER_AUTH_MICROSOFT_CLIENT_ID`
- `BETTER_AUTH_MICROSOFT_CLIENT_SECRET`
- `BETTER_AUTH_MICROSOFT_ACCOUNT_LINKING_TRUSTED`, set only after accepting same-email Microsoft account linking
- `BETTER_AUTH_MICROSOFT_TENANT_ID`, defaults to `common`
- `BETTER_AUTH_OAUTH_BRANDED_PROVIDERS`, comma-separated `google,microsoft` after account chooser branding is verified
- `BETTER_AUTH_TRUSTED_ORIGINS`, comma-separated preview origins

## OAuth Callback URLs

Configure provider dashboards with the Better Auth callback paths:

- Google: `https://0509.io/api/auth/callback/google`
- Microsoft: `https://0509.io/api/auth/callback/microsoft`

OAuth must stay hidden until each provider's account chooser and consent surface shows Five to Nine or 0509 branding.

## Database Schema

Pre-launch auth state is clean cut over to Better Auth. There is no account/session migration layer.

The base auth schema is in `migrations/0000_auth.sql`:

- `user`
- `session`
- `account`
- `verification`
- `passkey`

`migrations/0042_better_auth_passkey.sql` creates the same passkey table for any existing pre-launch D1 database whose base migration has already run.

The `user` table remains the owner key for Dodo billing, watchlists, digests, collections, delivery settings, and API keys.

## Supabase Status

Supabase appears only in `legacy/`, which is the old Next.js prototype reference.

Supabase is not part of the active Cloudflare Worker runtime. Do not move legacy Supabase code forward unless a future task explicitly migrates a specific useful idea into the active D1 model.

## Guardrail

`tests/auth-runtime.test.ts` checks that the active runtime uses Better Auth and does not reintroduce legacy auth provider files.
