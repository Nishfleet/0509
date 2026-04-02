# 0509

0509 is a Meta competitor analysis workspace for growth teams.

## Product shape

- `Analysis` is the public hook: search competitor ads, inspect the hook/offer/CTA/landing page, and save useful findings.
- `Monitoring` is the retention loop: watchlists, run history, change detection, and weekly digests.
- `Workspace memory` is the compounding layer: collections, notes, tags, exports, and share links.

## Current stack

- React Router v7 on Cloudflare Workers
- Better Auth
- D1
- R2 for landing-page artifacts
- Resend for digest delivery

## Routes

- `/` marketing site
- `/search` public analysis flow
- `/auth/login`
- `/auth/signup`
- `/app` workspace dashboard
- `/app/collections`
- `/app/watchlists`
- `/app/digests`
- `/share/:token`
- `/export/:resourceType/:resourceId`

## Environment

Important bindings and secrets:

- `DB`
- `LANDING_PAGE_ARTIFACTS`
- `BETTER_AUTH_SECRET`
- `META_AD_LIBRARY_TOKEN`
- `META_AD_LIBRARY_API_VERSION`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

## Notes

- If `META_AD_LIBRARY_TOKEN` is missing, the public search flow can still operate in explicit demo mode.
- The old `src/` Next.js app remains in the repo as legacy reference material and is not the current runtime path.
