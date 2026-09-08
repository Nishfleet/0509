# App workspace — `/app/*`

Session required. `requireSession` (`app/lib/auth.server.ts`) redirects an anonymous visitor to
`/auth/login?redirectTo=<pathname+search>`. Layout: `app/routes/app-layout.tsx`.

## How users reach it

Sign in through the magic link, then land on `/app`. Every workspace page hangs off that shell.

## Navigation (`app/lib/dashboard-navigation.ts`)

Primary rail — five destinations:

| Label | Path |
| --- | --- |
| Today | `/app` |
| Watch | `/app/watchlists` |
| Library | `/app/collections` |
| Deliver | `/app/deliver` |
| Settings | `/app/settings` |

Settings sub-nav: `Delivery` (`/app/notifications`), `Source access` (`/app/source-access`),
`Developer access` (`/app/developer-access`), `Team` (`/app/team`),
`Billing & usage` (`/app/billing`), `Account & security` (`/app/account`),
`Help & support` (`/app/support`).

Cmd/Ctrl+K anywhere in the shell toggles the quick-add palette (`isQuickAddShortcut` in
`app-layout.tsx`); the same dialog opens from the rail's `Search…⌘K` button.

## How to drive it

The only anonymous drive is the redirect guard:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://127.0.0.1:4179/app'
# 302 http://127.0.0.1:4179/auth/login?redirectTo=%2Fapp
```

## What proves success

- Anonymous `/app` 302s to `/auth/login?redirectTo=%2Fapp`, and any `/app/<page>` 302s with that
  page URL-encoded into `redirectTo`.
- Signed in: the URL is not `/auth/login` and the `Today` link is visible. That pair is the
  success signal the existing suite uses.

## Honesty note — authenticated drives

Real sign-in is an emailed magic link and cannot be completed locally, so a manual
authenticated drive is not possible on the 4179 server. Locally, authenticated coverage exists
only through the Playwright `local-auth` project, which installs the test-only fixture session —
never drive that by hand. Real authenticated verification runs against production through the
`prod-auth` project with stored session state (`.auth/0509-internal.json`).
