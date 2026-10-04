# 2026-10-04: "Your account is deleted" never appeared after deleting an account

## What customers saw

After deleting their account in the app, the sign-in page opened with no confirmation. The account was gone, but nothing said so and nothing showed the saved-files cleanup.

## Start and end (UTC)

Start: not looked up. It began when the confirmation shipped. It was found on 2026-10-04 by the J14 delete-account journey on production. End: when #6940 deploys.

## Root cause

The progress cookie was set with `Path=/login`. Browsers send a cookie only to URLs under its path, and `/login.data` is not under `/login`.

- Right after deleting, the app moves to `/login?deleted=<id>` by a client-side navigation. That navigation asks for `/login.data?deleted=<id>`, not the page itself.
- That request left the cookie behind, so the page's loader saw no matching cookie and returned no notice.
- Proof on production (two throwaway diagnostic runs): `GET /login?deleted=<id>` with the cookie in the jar rendered the notice, and `GET /login.data?deleted=<id>` with the same jar returned `id` and `progress` both null. A missing workflow instance would have returned an id with null progress, so the first guess (instance not found) was ruled out.
- A full page load worked, which is why the check by hand and the integration tests passed.

## How it was detected

J14 (delete-workspace journey) on production. No alert exists for a missing confirmation.

## The fix

#6940 sets the cookie path to `/`. The cookie is still http-only, signed and valid for an hour.

## What stops a repeat

- A test now checks that the cookie path covers both `/login` and `/login.data` (`tests/integration/account-delete.integration.test.ts`).
- J14 stays in the production suite and asserts the confirmation text after the redirect.
