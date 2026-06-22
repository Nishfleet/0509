---
title: "fix: Gate branded OAuth providers"
type: "fix"
date: "2026-06-19"
---

# fix: Gate branded OAuth providers

## Summary

Prevent Five to Nine from showing or starting Google/Microsoft OAuth unless the provider is explicitly enabled and its user-facing OAuth branding has been verified for 0509. Email-link and passkey sign-in remain unchanged.

## Problem Frame

The Google account chooser currently says users are continuing to the former hosted auth provider. That means the active Google OAuth provider is not presenting 0509/Five to Nine as the relying app, which is unacceptable for a trust-critical login surface. Current docs say hosted Google OAuth needs an app-owned Google OAuth client configured in the auth provider, and Google says the OAuth consent surface uses the app branding configured in Google Auth Platform.

## Requirements

- R1. Hide OAuth buttons unless each provider has a separate branded-verification gate, not just the generic auth-provider public token.
- R2. Reject direct OAuth POSTs for providers that are not branded-verified, even if the older provider-enabled flag is present.
- R3. Preserve current email-link and passkey sign-in behavior.
- R4. Document that provider OAuth is only enabled after Google/Microsoft dashboards show Five to Nine/0509 branding.

## Key Technical Decisions

- **Use a second runtime gate:** Keep the provider allowlist, but require a branded-provider allowlist before rendering or starting OAuth. This makes the dangerous state fail closed.
- **Do not hardcode Google-only behavior:** Apply the same gate to Microsoft because both are third-party OAuth surfaces and both can leak wrong provider branding.
- **Do not change the OAuth protocol flow:** Keep hosted discovery OAuth, PKCE, and same-origin checks as-is; the issue is readiness gating, not token handling.

## Implementation Units

### U1. Add branded provider gate

- **Goal:** Only return OAuth providers that are both enabled and branded-verified.
- **Requirements:** R1, R2, R3.
- **Dependencies:** None.
- **Files:** `app/lib/env.server.ts`, the auth-provider server module, and `tests/auth.server.test.ts`.
- **Approach:** Add a new optional env field and parse it with the existing provider allowlist pattern. Update the enabled OAuth provider helper so the old broad flags are insufficient without the branded allowlist.
- **Patterns to follow:** Existing provider parsing in the auth-provider server module.
- **Test scenarios:** With only `STYTCH_OAUTH_ENABLED_PROVIDERS=google`, OAuth is disabled. With both enabled and branded provider lists containing `google`, Google is enabled. A direct Microsoft POST remains rejected when Microsoft is not branded-verified.
- **Verification:** Focused auth tests pass.

### U2. Document the provider-brand requirement

- **Goal:** Make the operational rule explicit for future deploys.
- **Requirements:** R4.
- **Dependencies:** U1.
- **Files:** `docs/auth-runtime.md`, `wrangler.jsonc`.
- **Approach:** Add the branded-provider allowlist to required runtime values with a short note that it is set only after the auth-provider and provider dashboards show Five to Nine/0509 branding.
- **Patterns to follow:** Existing auth runtime value list.
- **Test expectation:** none -- documentation only.
- **Verification:** The docs no longer imply that the legacy provider-enabled flag alone is enough.

## Risks & Dependencies

- The real branded Google surface still depends on dashboard configuration in Google Cloud and the auth provider. This code fix prevents the bad option from being exposed before that external configuration is verified.

## Sources & Research

- Hosted-auth Google OAuth docs: create/configure an app Google OAuth client and add the provider redirect URI.
- Hosted-auth Google discovery docs: the provider starts the Google flow and redirects back to the app's discovery callback.
- Google Identity docs: OAuth/Sign in with Google consent surfaces use the app branding configured in Google Auth Platform.
