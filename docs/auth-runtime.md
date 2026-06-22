# Auth Runtime

Last checked: 2026-06-16

## Decision

Use Stytch B2B for Five to Nine auth.

Keep Cloudflare D1 as the app data store. Do not move product data, billing links, watchlists, digests, collections, customer API keys, or delivery targets into Stytch.

## Current Active Runtime

- Active app code lives in `app/` and `workers/`.
- Auth is implemented through Stytch B2B discovery magic links, optional Google/Microsoft discovery OAuth starts, and organization member sessions.
- The app stores the opaque Stytch session token in an HTTP-only `f9_stytch_session` cookie.
- Magic-link and OAuth requests are stored in D1 with one-time state. OAuth starts use PKCE with an HTTP-only same-browser verifier cookie; email links confirm before token exchange. Callback tokens are exchanged server-side and are never rendered into HTML.
- On each protected request, `app/lib/auth.server.ts` authenticates the Stytch session and maps the Stytch member/org to the app-owned D1 `user.id`.
- `migrations/0031_stytch_identity.sql` stores the local `user_id` to Stytch organization/member mapping plus short-lived auth request state.
- Existing app-owned user IDs remain the owner key for Dodo billing, watchlists, digests, collections, delivery settings, and API keys.

## Current B2B Scope

The current app data model is still keyed by local `user.id`, not by a separate organization/workspace table. Because of that, this runtime supports one Stytch organization per email address. If Stytch discovery returns multiple organizations for one email, the app blocks sign-in and asks for support routing instead of risking cross-workspace data mixing.

Team invite links are supported by allowing the invitee's Stytch login flow to create a Stytch organization when no organization is discovered, then returning the user to `/team/accept`.

Do not enable Stytch settings that require an extra auth step, such as MFA-required flows or SSO-only primary authentication, until Five to Nine has a follow-up flow for those requirements. The app blocks those responses with an `unsupported_policy` auth error instead of silently failing.

## Required Runtime Values

- `APP_ORIGIN`
- `AUTH_PROVIDER=stytch`
- `STYTCH_API_BASE_URL`
- `STYTCH_PROJECT_ID`
- `STYTCH_PUBLIC_TOKEN` for Google/Microsoft OAuth discovery starts; store as runtime config/secret and do not render it into public HTML or client bundles
- `STYTCH_OAUTH_ENABLED_PROVIDERS` only after provider configs are live in Stytch
- `STYTCH_OAUTH_BRANDED_PROVIDERS` for the subset of OAuth providers whose Google/Microsoft account chooser and consent surfaces have been verified to show Five to Nine/0509, not Stytch. Providers must appear in both allowlists before the app renders or starts OAuth.
- `STYTCH_SECRET`
- `STYTCH_SESSION_DURATION_MINUTES` optional, defaults to 30 days
- `UNSUBSCRIBE_SIGNING_SECRET` for signed unsubscribe links. `BETTER_AUTH_SECRET` remains a legacy fallback only during migration.

## Optional Stytch Email Templates

- `STYTCH_DISCOVERY_SIGNUP_TEMPLATE_ID` for a branded signup/activation magic-link email.
- `STYTCH_DISCOVERY_LOGIN_TEMPLATE_ID` for a branded returning-user magic-link email.
- `STYTCH_DISCOVERY_EMAIL_TEMPLATE_ID` optional shared fallback if login and activation use the same template.

Stytch's B2B Discovery API sends these template IDs as `login_template_id`; create custom templates as `Magic Links - Login` templates in Stytch. Leave these unset while using Stytch's included pre-built email template.

## Cost Guardrail

Use Stytch B2B within the included/free setup first. Do not enable paid custom branding, fraud add-ons, or extra paid SSO/SCIM connections without an explicit product/cost decision.

Custom Stytch auth emails may require Stytch's full email customization add-on and a custom email domain before the sender, body, and "Powered by Stytch" footer can be fully branded. The app only passes template IDs; the template/domain setup remains in the Stytch dashboard.

## Supabase Status

Supabase appears only in `legacy/`, which is the old Next.js prototype reference.

Supabase is not part of the active Cloudflare Worker runtime. Do not move legacy Supabase code forward unless a future task explicitly migrates a specific useful idea into the active D1 model.

## Better Auth Status

Better Auth is no longer the active auth provider and is not an app dependency. The old `user`, `session`, `account`, and `verification` tables remain historical schema; the app still uses the `user` table as its local product-data owner record.

## Guardrail

`tests/auth-runtime.test.ts` checks that active runtime files use Stytch and do not import Better Auth or Supabase.
