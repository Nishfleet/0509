# Google Sign-In Decision

Google sign-in is not required for this E2E harness.

The current supported auth method remains Better Auth magic link. The QA blocker is that Codex/Cursor browser automation cannot reliably complete production email-link login without owner inbox access, not that customers need Google OAuth for GA.

Decision for this branch:

- Do not add Google sign-in.
- Do not use Google sign-in as a testing workaround.
- Use local non-customer fixture auth for local E2E.
- Use owner-captured Playwright storage state for production authenticated smoke, guarded by the expected internal-account email hash and file-bound local metadata.

If Google sign-in becomes a customer product requirement later, implement it in a separate PR with Better Auth Google provider config, Google OAuth credentials and redirect URI docs, account-linking behavior, same-origin redirect safety, missing-config fail-closed behavior, tests, and no customer lockout.
