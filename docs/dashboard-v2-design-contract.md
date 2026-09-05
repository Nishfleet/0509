> **SUPERSEDED (2026-08-08).** This contract described an IA that no
> longer exists (it disagreed with the shipped nav on five of seven
> labels). The ratified IA is the five destinations — Today, Watch,
> Library, Deliver, Settings — defined in `app/lib/dashboard-navigation.ts`.
> The real source of truth for program state is `docs/BACKLOG.md`,
> `DESIGN.md`, and `docs/design-system-ratchet.json` (the external
> `agent-state` ledger was formally retired 2026-08-25; reconciled here
> 2026-09-05, issue #1497). Retained as history only; do not plan from
> this file.

# Dashboard V2 — Design Contract

Locked IA, navigation, tokens, and state policy for the Five to Nine workspace.

## Information architecture

### Primary jobs

| Section | Customer label | Route | Job |
|---------|----------------|-------|-----|
| Home | Overview | `/app` | What to do next |
| Research | Search | `/search` | Find competitor ads |
| Monitor | Watchlists | `/app/watchlists` | Nightly change tracking |
| Monitor | Presence | `/app/presence` | Website/blog presence (entitled) |
| Library | Collections | `/app/collections` | Saved ads + proof |
| Review | Digests | `/app/digests` | Email digest history |
| Review | Reports | `/app/shares` | Shared links + exports |

### Settings (workspace rail)

| Label | Route | Job |
|-------|-------|-----|
| Notifications | `/app/notifications` | Email digests and alert delivery channels |
| Source access | `/app/source-access` | Backup Meta token and tracking reliability |
| Developer access | `/app/developer-access` | API keys, exports, and approved account actions |
| Team | `/app/team` | Members + invites |
| Client rooms | `/app/clients` | Agency client context |
| Billing & usage | `/app/billing` | Plan + Dodo portal |
| Account & security | `/app/account` | Profile, passkeys, delete |
| Help & support | `/app/support` | Cases + docs links |

Staff-only: **Ops** → `/app/ops`.

## Navigation rules

1. **One config** — `app/lib/dashboard-navigation.ts`; filter with `filterDashboardNav`.
2. **No route-level sidebars** — layout owns the rail.
3. **Search is first-class** — lives in PRIMARY nav, uses same shell when authenticated.
4. **URL stability** — `/app/sources` stays as a compatibility hub for legacy links and POSTs.

## Copy conventions

| Retire | Use |
|--------|-----|
| Boards | Collections |
| Briefs (as nav noun) | Digests |
| Integrations (page title) | Notifications, Source access, or Developer access by job |
| Agent / workflow / audit internals | Customer outcomes (follow-ups, delivery, proof) |
| Counter-move brief | Response brief / competitive response |

## Visual tokens (workspace)

- Shell: `f9-cursor-shell`, `f9-dash-page`, `f9-dash-mobile-nav` (BL-042 deleted the
  shell-owned `f9-dash-topbar` action row — every route carries its one action in
  its own `WorkingHeader`)
- Content stack: `f9-dash-content` > `f9-app-stack`
- Panels: `f9-app-panel`, `f9-app-kicker`, `f9-panel-toolbar`
- States: `f9-dash-state`, `f9-dash-state-*` modifiers

No Tailwind. No new fonts. Follow `DESIGN.md` Vercel workspace palette.

## Loading & error policy

| Situation | Component | Timeout |
|-----------|-----------|---------|
| Loader pending | `RouteSkeleton` | Show "Still loading…" after 8s via notice |
| Empty list | `EmptyState` | Always include next action link |
| Plan gate | `PlanLimitState` | Link to `/#pricing` or billing |
| Member denied | `PermissionState` | Owner-only copy |
| Partial backend | `PartialDataNotice` | Honest scope label |
| Hard failure | `ErrorState` | `mapCustomerRouteError` message |

## Internal leakage — forbidden in customer UI

- `auditedAgentActionGroups`, `AGENT_BLOCKED_CAPABILITIES` lists
- D1, workflow binding, tool-call vocabulary
- Agent memory keys / audit pagination internals
- "Internal canary" banners for non-staff users

API docs (`/api/docs`) and MCP may document agent capabilities; workspace pages may link out, not duplicate catalogs.
