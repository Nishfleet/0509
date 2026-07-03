# Dashboard V2 — Route Audit

**Branch:** `cursor/dashboard-v2-20260624`
**Source:** `app/routes.ts` (baseline main `7d08ed8`)

## Legend

| Shell | Meaning |
|-------|---------|
| **Dash** | `DashboardShell` via `app-layout.tsx` or inline (search) |
| **Public** | Marketing / auth / legal surfaces |
| **None** | API, export, share token — no app chrome |

## `/app/*` workspace routes

| Path | File | Shell | Nav label | Stage C status |
|------|------|-------|-----------|----------------|
| `/app` | `app.dashboard.tsx` | Dash | Overview | Migrated — action-oriented overview |
| `/app/collections` | `app.collections.tsx` | Dash | Collections | Copy unified (Boards → Collections) |
| `/app/watchlists` | `app.watchlists.tsx` | Dash | Watchlists | Uses `f9-app-stack` (no duplicate sidebar) |
| `/app/clients` | `app.clients.tsx` | Dash | Client rooms | Copy unified |
| `/app/digests` | `app.digests.tsx` | Dash | Digests | Customer copy verified |
| `/app/shares` | `app.shares.tsx` | Dash | Reports | Shared links / reports |
| `/app/billing` | `app.billing.tsx` | Dash | Billing & usage | Uses layout shell |
| `/app/support` | `app.support.tsx` | Dash | Help & support | Uses layout shell |
| `/app/account` | `app.account.tsx` | Dash | Account & security | Uses layout shell |
| `/app/team` | `app.team.tsx` | Dash | Team | Uses layout shell |
| `/app/notifications` | `app.notifications.ts` | Dash | Notifications | Delivery-only settings |
| `/app/source-access` | `app.source-access.tsx` | Dash | Source access | Backup Meta token and tracking reliability |
| `/app/developer-access` | `app.developer-access.tsx` | Dash | Developer access | API keys and approved actions |
| `/app/sources` | `app.sources.tsx` | Dash | — | Compatibility hub for legacy links and POSTs |
| `/app/presence` | `app.presence.tsx` | Dash | Presence | Migrated to `f9-app-stack` panels |
| `/app/presence/:entityId` | `app.presence.$entityId.tsx` | Dash | Presence detail | Migrated to `f9-app-stack` panels |
| `/app/ops` | `app.ops.tsx` | Dash | Ops (staff) | Staff-only; unchanged surface |
| `/app/reports/:id` | `app.reports.tsx` | Dash | — | Proof report viewer |
| `/app/onboard` | `app.onboard.tsx` | **None** | — | Pre-layout onboarding (intentional) |

## Adjacent authenticated surfaces

| Path | File | Shell | Notes |
|------|------|-------|-------|
| `/search` | `search.tsx` | Dash (public or auth) | Unified `DashboardShell`; not under `/app` layout |
| `/team/accept` | `team.accept.tsx` | Public error card | Invite acceptance |
| `/share/:token` | `share.$token.tsx` | Public share | External viewers |
| `/export/...` | `export.*.tsx` | None | Download endpoints |

## Public / marketing

| Path | File |
|------|------|
| `/` | `marketing.tsx` |
| `/help`, `/docs`, `/status`, `/changelog`, `/trust` | doc routes |
| `/auth/*` | auth routes |
| `/privacy`, `/terms`, `/unsubscribe` | legal |
| `/compare/magicbrief` | comparison landing |

## API (no dashboard shell)

`api/auth`, `api/billing/*`, `api/v1*`, `api/mcp`, `api/webhooks/*`, `api/health`, `api/presence/oauth/*`, etc.

## Findings

1. **Single shell** — `app-layout.tsx` owns sidebar; child routes must not render `f9-app-shell` / duplicate nav.
2. **`/app/onboard`** correctly bypasses layout until onboarding completes.
3. **`/app/sources`** remains as URL compatibility, but the visible customer pages are split by job.
4. **Presence** previously used unstyled `f9-page` / `f9-card` classes; migrated to workspace panel tokens.
