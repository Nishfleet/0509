# Share links — `/share/:token`

Route: `app/routes/share.$token.tsx` (a PDF sibling lives at `/share/:token/pdf`).
Anonymous by design — the one slice of workspace output a logged-out visitor can reach.

## How users reach it

A workspace member creates a share link inside the app (Deliver → shares) and sends the URL to
a client or teammate. The recipient opens it with no account.

## How to drive it

The negative path is always available and needs no session:

```bash
curl -s -o /tmp/verify-0509/share-404.html -w '%{http_code}\n' \
  'http://127.0.0.1:4179/share/not-a-real-share-token'
grep -c "This share link isn't available" /tmp/verify-0509/share-404.html
```

The loader throws a 404 `Response` for every terminal state — missing, expired, revoked — and
the route's `ErrorBoundary` renders the same copy for all three.

## What proves success

- HTTP status is exactly 404.
- Heading reads `This share link isn't available`.
- Body reads `The link may have expired or been switched off by whoever shared it. Ask them for
  a fresh link.`
- Any other failure (DB error, render error, outage) renders `Temporary error` instead — if you
  see that heading, the 404 path was not what you exercised.

## Honesty note — no positive path locally

`e2e/fixtures/e2e-local.sql` deletes `share_link` rows for the fixture users and seeds none, so
no valid token exists on the local server. Minting one requires a signed-in session, which
cannot be completed locally (see `auth-magic-link.md`). The positive path — an opened share
rendering a report, collection, watchlist, or weekly digest — is covered by the authenticated
Playwright journeys and by production smoke.
