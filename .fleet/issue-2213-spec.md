# route diet phase 1 — Nishfleet/0509 #2213

Implement PHASE 1 ONLY. Do NOT delete any route file in this phase (that is #2217).
You are on worktree `/home/nish/workspaces/agent-worktrees/0509-2213` (branch `claim/issue-2213`).

## Scope (binding)
Only edit: the logged-in navigation component + `app/lib/dashboard-navigation.ts`,
`app/routes.ts`, `app/routes/app.*.tsx` (redirect stubs + renames below),
`app/routes/app.dashboard.tsx` (Competitors index), the Competitor screen move
(keeps the seam's `<SourceSections/>` slot), `docs/route-diet.md`, tests for nav + redirects.
Do NOT touch `app/lib/sources/**` or any seam (#2218) file beyond wiring the new
`app/routes/app.c.$id.tsx`.

## 8 target screens (do:1)
1. `/app` = Competitors (list; today's dashboard) — stays at `app.dashboard.tsx`.
2. `/app/c/:id` = Competitor (evidence, sources status card, pinned items, share/export).
3. `/app/briefs` = Briefs (today's digests history). PHASE 1 RENAMES
   `app/digests.tsx` -> `app/briefs.tsx` and adds a thin `app/digests.tsx` redirect stub
   (judge edit, binding).
4. `/app/account` = Account & Billing (merged; `app/billing.tsx` 302s here).
5. `/app/team` = Team (stays `app/team.tsx`).
6. `/app/api` = API (developer-access -> `app/api.tsx`; `app/developer-access.tsx` becomes redirect stub).
7. `/app/settings` = Settings (stays `app/settings.tsx`; notifications/sources fold in via #hash).
8. `/app/help` = Help (support -> `app/help.tsx`; `app/support.tsx` becomes redirect stub).

## Navigation model (both desktop rail + mobile strip, via `app/lib/dashboard-navigation.ts`)
The rail shows the 7 static destinations that a logged-in user sees as nav items for the
8 screens (the Competitor detail `/app/c/:id` is a drill-in, NOT a rail row). New
`DASHBOARD_PRIMARY_NAV` items (all in one group, no section titles):
- `Competitors` -> `/app` (end), `activePaths: ["/app/c", "/app/watchlists", "/app/presence"]`
- `Briefs` -> `/app/briefs`
- `Account & Billing` -> `/app/account`
- `Team` -> `/app/team`
- `API` -> `/app/api`
- `Settings` -> `/app/settings` (`activePaths` covering folded settings homes)
- `Help` -> `/app/help`

Remove `DASHBOARD_SETTINGS_NAV` usage: every settings member route now 302s to its
`/app/settings#anchor` home, so the disclosure disappears. Keep the types.
`buildDashboardMobileNav` returns the same 7 items. Update
`tests/dashboard-v2.test.ts` and any other nav test to the new model.

## Routes (`app/routes.ts` under the existing `app` parent, line ~208)
New / changed child registrations:
- `c/:id` -> `routes/app.c.$id.tsx` (Competitor)
- `briefs` -> `routes/app.briefs.tsx`
- `api` -> `routes/app.api.tsx`
- `help` -> `routes/app.help.tsx`
Keep existing registrations for `account`, `team`, `settings`, `dashboard` (index).
Existing folded routes stay registered (their files are now redirect stubs):
`watchlists`, `watchlists/:watchlistId`, `collections`, `clients`, `deliver`, `shares`,
`billing`, `support` (now stub), `notifications`, `source-access`, `developer-access`
(now stub), `sources`, `presence`, `presence/:entityId`, `reports`, `reports/:id`,
`digests` (now stub), `ops` (unchanged).

## Redirect stubs (302 to new home, query preserved; POST -> 307)
Pattern = `app/routes/app.ops-redirect.ts`. Loader: `redirect(newHome + search, 302)`
where search is `new URL(request.url).search`. Keep a `hydrateFallback`/`default` if the
old file had one (render null). When the old route had an `action`, keep an `action` that
`redirect(newHome, 307)` so open forms/requests don't 405. Old -> new map (do:2):
- `/app/watchlists` -> `/app`
- `/app/watchlists/:watchlistId` -> `/app/c/:id`
- `/app/collections` -> `/app`
- `/app/presence` -> `/app/c/:id` when an entity id maps to a competitor, else `/app`
  (list screen -> `/app`)
- `/app/presence/:entityId` -> `/app/c/:id`
- `/app/clients`, `/app/deliver`, `/app/shares`, `/app/reports`, `/app/reports/:id` -> `/app/briefs`
- `/app/sources`, `/app/source-access` -> `/app/settings#sources`
- `/app/notifications` -> `/app/settings#notifications`
- `/app/billing` -> `/app/account`
- `/app/developer-access` -> `/app/api`
- `/app/support` -> `/app/help`
- `/app/digests` -> `/app/briefs`
- `/app/ops` unchanged (leave as-is)
DO NOT rewrite any folded route's loader/action business logic — a folded route file becomes
a redirect stub only. Rewriting handlers or deleting files is phase 2.

## Competitor screen move
`app/components/watchlists/competitor-detail.tsx` (with `<SourceSections/>`, seam #2218) is
currently rendered by `app/routes/app.watchlists.tsx`. Create `app/routes/app.c.$id.tsx`
that loads a competitor by `params.id` (follow the seam's competitor-page data access in
`app/routes/app.watchlists.tsx` / `app/lib/...`) and renders `CompetitorDetail`. Register
the old competitor home `/app/watchlists/:watchlistId` (that file's current role) as a
redirect to `/app/c/:id`. Keep the seam's slot intact. If moving this cleanly is architecturally
fraught, post a `blocked-on:` comment and stop — do NOT half-move shared cache.

## Moved buttons (do:3)
Move the actions those folded routes owned (share a brief, deliver to a client, export a
report) onto the Brief (`app/briefs.tsx`) and Competitor (`app/c.$id.tsx`) screens as
buttons that post to the EXISTING action handlers — no handler rewrites in this phase.
Find the existing share/deliver/export handlers (search `app/routes/app.shares.tsx`,
`app/deliver.tsx`, `app.reports.tsx` actions and any `~/lib/*` helper + the digests action)
and re-point the buttons to the same intent.

## docs/route-diet.md (do:5)
Write: the old -> new map (table above) and a list of the files #2217 will delete
(all folded route files + their `.ui`/`.ts` twins + components/tests only they import).

## Tests (do:6)
- nav renders the 7 rail destinations (+ Competitor detail reachable via drill-in);
- every old path in the map 302s to its documented new path (query preserved);
- moved share/deliver/export buttons post to the same action intents as before.
Name files `tests/app-nav*.test.ts` / `tests/app-redirects*.test.ts` (issue termination).
Update any now-broken existing nav/route test to the new model.

## Do NOT
- delete loaders/actions/route files (phase 2); change URLs of public routes; touch
  `/ads /timeline /compare /search`; remove onboarding; change what a screen shows beyond
  moving buttons; edit `app/lib/sources/**` or seam files; run coverage/typecheck.

## Verify
Termination per issue: `npx vitest run tests/app-nav*.test.ts tests/app-redirects*.test.ts`.
Also run the touched existing nav/redirect tests. Do NOT run `vitest --coverage`, `npm run
typecheck`, or `tsc`.

Report back: files changed, what each does, the nav decision, test results, and any judgment
call you had to make. Do NOT commit, push, or open a PR — the manager does that.