# Route diet — 26 logged-in routes to 8 screens

Phase 1 of Nishfleet/0509#2213. The logged-in app keeps eight screens and one
seven-row rail; every other logged-in route stops being a screen and becomes a
302 to its new home. Nothing is deleted here — deletion is phase 2
(Nishfleet/0509#2217).

## The 8 screens, 7 rail rows

| Screen | Path | Rail row |
|---|---|---|
| Competitors (list; today's dashboard) | `/app` | Competitors |
| Competitor (evidence, source status, pinned items, share/export) | `/app/c/:id` | — (drill-in) |
| Briefs (today's digest history) | `/app/briefs` | Briefs |
| Account & Billing | `/app/account` | Account & Billing |
| Team | `/app/team` | Team |
| API (developer access) | `/app/api` | API |
| Settings (pause, delete workspace, exports, notifications) | `/app/settings` | Settings |
| Help (support) | `/app/help` | Help |

`/app/c/:id` is a surface, not a rail row: it is opened from the Competitors
list. The rail is built from `DASHBOARD_PRIMARY_NAV` in
`app/lib/dashboard-navigation.ts` and renders exactly seven items.

## Old route to new home

| Old path | New home | State |
|---|---|---|
| `/app/digests` | `/app/briefs` | shipped — 302 (`app.digests.tsx`) |
| `/app/developer-access` | `/app/api` | shipped — 302 (`app.developer-access.tsx`) |
| `/app/support` | `/app/help` | shipped — 302 (`app.support.tsx`) |
| `/app/watchlists?watchlist=<id>` | `/app/c/<id>` | shipped — same screen also served at the new path |
| `/app/watchlists` | `/app` | deferred to phase 1b |
| `/app/watchlists/:watchlistId` | `/app/c/:id` | deferred to phase 1b |
| `/app/collections` | `/app` (section "Pinned") | deferred to phase 1b |
| `/app/clients`, `/app/deliver`, `/app/shares`, `/app/reports` | `/app/briefs` | deferred to phase 1b (buttons first, #2213 do:3) |
| `/app/billing` | `/app/account` | deferred to phase 1b (needs the account+billing merge) |
| `/app/notifications` | `/app/settings#notifications` | deferred to phase 1b (needs the settings section) |
| `/app/sources`, `/app/source-access` | `/app/settings#sources` | deferred to phase 1b (needs the settings section) |
| `/app/presence`, `/app/presence/:entityId` | `/app/c/:id`, else `/app` | deferred to phase 1b (needs the entity-to-competitor mapping) |
| `/app/onboard` | unchanged | first-run flow, never a rail row |
| `/app/ops` | `/ops` | unchanged |

### Why the deferred folds are deferred

A 302 is only honest when the destination already shows what the old route
showed. Three of the deferred destinations do not exist yet:

- `/app/settings` has no `#sources` and no `#notifications` section, so
  redirecting there would delete the delivery and backup-source configuration.
- `/app/account` does not yet carry the billing screens, so redirecting
  `/app/billing` there would delete plan, usage and invoice management.
- `/app` is today's dashboard, which owns the first-run setup checklist and
  the POST intents behind it (`create-watchlist`, `preview-market-desk-import`,
  `finish`). Swapping the index route to the competitor board would take the
  onboarding surface offline, which #2213's `must-not` list forbids.

Each of those is a content move, not a redirect. They are filed as one
follow-up (phase 1b) so they land with the section merge, not as three separate
redirect shims that quietly drop screens.

## Files phase 2 (#2217) deletes

Route files that are pure redirect stubs once phase 1b lands, with the `.ui`
twin and the test that only they import:

- `app/routes/app.digests.tsx` — renamed to `app.briefs.tsx`
- `app/routes/app.developer-access.tsx` (and `app.developer-access.ui.tsx`) —
  renamed to `app.api.tsx`
- `app/routes/app.support.tsx` — renamed to `app.help.tsx`
- `app/routes/app.sources.tsx` — legacy compatibility redirect
- `app/routes/app.source-access.tsx` (and `app.source-access.ui.tsx`)
- `app/routes/app.notifications.ts` (and `app.notifications.ui.tsx`)
- `app/routes/app.clients.tsx`, `app.deliver.tsx`, `app.shares.tsx`,
  `app.reports.tsx`, `app.reports.index.ts` (and `app.reports.index.ui.tsx`)
- `app/routes/app.collections.tsx`
- `app/routes/app.billing.tsx`
- `app/routes/app.presence.tsx`, `app.presence.$entityId.tsx`
- `app/routes/app.watchlists.tsx`, `app.watchlists.$watchlistId.tsx` — once the
  competitor board and drill-in are fully owned by `app.dashboard.tsx` and
  `app.c.$id.tsx`
- `app/routes/workspace-settings-actions.server.ts` — the legacy `/app/sources`
  POST dispatcher, dead once nothing posts to it
