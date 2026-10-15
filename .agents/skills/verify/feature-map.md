# Feature map

What exists, how a user reaches it, what it does. Nothing else.

This file is the answer to "an agent can run the app but does not know what the
user meant" (Lauren Tan, _2,500 PRs_, 11:02). It is materialised memory: a route
that is not here cannot be reached, and a row here that no route serves is a
lie. `app/routes.ts` is the only registry — start there, not from a guess.

**Every PR that adds, removes or changes a route updates its row in the same
PR.** `app/routes.ts` is the only registry: no gate in this repo reads it
against this map, so keeping the two in step is the PR author's job.

**One row per file.** The rows live in `feature-map/<section>/<name>.md`, each
file a one-row table, so two PRs that change different routes never edit the
same lines. A new route adds a file; a removed route deletes its file; a
changed route edits only its own. Name the file for the route
(`/mcp` is `agents/mcp.md`) and search with
`grep -rn "app/alerts" .agents/skills/verify/feature-map.md .agents/skills/verify/feature-map/`. The sections below
hold only the prose that is true of the whole section. The table header is
repeated in every file so each one reads on its own.
`tests/unit/feature-map-proof.test.ts` fails a PR whose spec is named by no
Proof cell or whose Proof cell names a spec not on disk (#6133), that repeats a
Route + File row (#7016), or whose file holds anything other than one row
(the restructure after the 2026-10-14 conflicts,
`docs/incidents/2026-10-14-base-fresh-queue-churn.md`).

Legend: **Reach** is how a human gets there — the route or entry point, the
element's role and accessible name, and the keyboard path with no pointer.
**Does** is what it does. **Proof** is the e2e test or journey that asserts it.

---

## Public

Rows: `feature-map/public/`.

## Signed in

Rows: `feature-map/signed-in/`.

Every route below goes through `requireSession` (`app/lib/require-session.server.ts`),
which redirects to `/login` when there is no session. There is no half-authenticated
state.

Every route under `app/routes/app-layout.tsx` also runs `requireOnboarded` (`app/lib/require-onboarded.server.ts`) as layout middleware before its loader and action. An unfinished workspace is redirected to its resume point (`workspaceLanding` in `app/lib/workspace.server.ts`): no subject → `/onboarding`, subject but no confirmed card → `/onboarding/identity?subject=<first subject>`, confirmed card without Start watching → `/onboarding/competitors`, Start watching without a live subscription → `/onboarding/plan`. `/onboarding*`, `/app/changes/*` and `/oauth/authorize` never run it. The `/app/settings*` routes sit under `app/routes/app-settings-layout.tsx`, the same shell with `requireSessionMiddleware` (session only, no onboarding redirect), so a signed-in user can always reach Settings and delete their account before onboarding finishes. `/app/share.png` and `/app/logos/*` sit under `app/routes/app-session-layout.tsx`, the same session middleware with no shell. `/app/changes/*` stays outside that layout so a signed-out visitor can still load a public landing screenshot. A finished workspace that loads any route under `app-layout.tsx` has `workspace.last_seen_at` set to now at most once every 20 hours, written after the response is sent (`waitUntil`) so no page waits for it (`touchWorkspaceSeen` in `app/lib/data/workspace.server.ts`); no pixel, no email tracking. Proof: `tests/integration/workspace-seen.integration.test.ts`.

## Agents

Rows: `feature-map/agents/`.

The "AI agent native" surface: a remote MCP server and a small read-only REST API over the same reads (`app/lib/agent/read.server.ts`, shapes in `app/lib/agent/schemas.ts`). Every read takes a workspace id resolved from the caller's own user id at request time (`readWorkspaceIdForOwner`); nothing accepts a workspace id from the caller. `workers/app.ts` wraps the Worker in `@cloudflare/workers-oauth-provider` (`app/lib/agent/oauth.server.ts`), which owns `/oauth/token`, `/oauth/register`, `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource[/mcp]` and hands every other request to React Router with a `RouterContextProvider` (`app/lib/agent/context.server.ts`). `/oauth/token`, `/oauth/register` and the well-known documents are public on purpose so an MCP client can register and exchange tokens without Cloudflare Access; `/oauth/authorize` and `/login` stay behind Access. Dynamic client registration accepts https, loopback http and custom app schemes such as `cursor://` or `vscode://` (dangerous schemes like `javascript:` and remote http are refused); Claude, ChatGPT and Cursor still connect at `https://0509.io/mcp`. Both surfaces are behind the `AGENT_LIMIT` rate limit (120 a minute per user) and answer `Cache-Control: no-store`. A browser preflight from a foreign origin is 403 on `/mcp` and `/api/v1`.

## Not a route

Rows: `feature-map/not-a-route/`.

These surfaces have no user route: no URL in the app maps to them. Some are reached by a harness rather than a user — an e2e spec reads the e2e inbox (`e2e/inbox.ts`), an integration test renders the fixture site (`tests/integration/fixture-site.test.ts`) and the send lane (`tests/integration/send-lane.integration.test.ts`), the error page is thrown by a route, and the cron is triggered by the system. Their **Reach** cell says what reaches them. They are listed here so an agent driving the app does not conclude they must already exist somewhere it has not looked.

---

## What is deliberately missing

Five of the seven signed-in surfaces are stubs and this table says so rather
than implying coverage. They fill in with the engine packets under #3842. The
rule that keeps this file honest is the same one that keeps the product honest:
a row describes what a user can do **today**, never what is planned.

The four places — Home, Competitors, Alerts, Settings — are linked from
`app/components/nav.tsx`, drawn by `app/components/app-shell.tsx` once, in the
layout routes `app/routes/app-layout.tsx` and
`app/routes/app-settings-layout.tsx` in `app/routes.ts`. The first wraps the
gated `/app` routes and runs `requireOnboarded` as layout middleware on each,
so a new gated `/app` page gets the nav and the resume-point gate without
wiring either; the second wraps the `/app/settings*` routes with the
same shell and `requireSessionMiddleware`, so Settings stays reachable before onboarding
finishes. Both layouts draw `app/components/navigation-pending.tsx` (a 3px green bar at the top of the
viewport plus a screen-reader "Loading", shown while any navigation or revalidation is in flight, then the name of the page that arrived, e.g. "Alerts", so a screen-reader user hears where they are; `e2e/a11y-reflow.spec.ts` checks it) and both export an
`ErrorBoundary` (`app/components/app-route-error.tsx`) that keeps the nav and shows the error page inside the shell, so a
failure under `/app` no longer removes the nav.
`/app/competitors/:entityId` is opened by tapping a competitor's name on
`/app/competitors`. It is not a nav place.
