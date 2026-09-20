# claim/issue-3788 — presence OAuth onto Better Auth genericOAuth

Issue: Nishfleet/0509#3788 (from #3772 §5). Decision: Nish 2026-09-20, yes.

## What changed

- `app/lib/presence-oauth-transaction.server.ts` deleted. The D1
  `presence_oauth_transaction` record carried nothing the plugin cannot carry:
  connectorId is the providerId, workspaceUserId is re-derived from the session
  at finalize time, returnPath rides in the server-set `callbackURL`, and the
  single-use invariant is the plugin's own (the state row is deleted on parse;
  10-minute expiry matches the old TTL).
- `app/lib/better-auth.server.ts` registers `linkedin` through `genericOAuth`
  (PKCE on, `authentication: "post"`, `disableImplicitSignUp` +
  `disableSignUp`). `getUserInfo` answers the session user's email — the
  link-social contract requires `userInfo.email === link.email` and LinkedIn's
  granted scopes serve no email claim. The LinkedIn member id from `/v2/me`
  becomes the account subject.
- `api.presence.oauth.linkedin.ts` starts the flow through
  `POST /api/auth/link-social` (server-side `auth.handler` call); the entity id
  travels in `callbackURL` to the finalize route.
- `api.presence.oauth.linkedin.callback.ts` is now a finalize step: fresh
  `account` row for (session user, linkedin) within 10 minutes, token read back
  through `auth.api.getAccessToken` (encryptOAuthTokens decrypt), then the same
  encrypt + `upsertSourceConnection` as before. `externalAccountId` is now the
  LinkedIn member id instead of the token fingerprint.
- `buildLinkedInOAuthAuthorizeUrl` removed; `LINKEDIN_OAUTH_SCOPES` kept and
  shared by the provider config and the finalize upsert.
- Tests rewritten: route shape + security invariants (untrusted code/state,
  fresh-row requirement, cross-workspace entity, fail-closed).
- Table intentionally NOT dropped (one-way D1 rule); writes stop entirely.

## Ops note for review

The LinkedIn developer app's redirect URI must change to
`https://0509.io/api/auth/callback/linkedin` (Better Auth's core callback),
replacing `/api/presence/oauth/linkedin/callback`.

## Evidence

- `npx vitest run --configLoader runner --project node tests/presence-oauth-linkedin-route.test.ts tests/presence-oauth-security.test.ts` → 9/9 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main` → 386 files / 4689 tests pass.
- typecheck: deferred to CI per repo rule (CI owns `npm run typecheck`).
