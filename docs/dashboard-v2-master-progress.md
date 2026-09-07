# Dashboard V2 — Master Progress

**Integration branch:** `cursor/dashboard-v2-20260624`
**Started:** 2026-06-24
**Baseline main:** `7d08ed8` (Presence Website GA)

## Status

| Phase | Status |
|-------|--------|
| 0 Baseline | Green |
| 1 Route inventory | Done — `dashboard-v2-route-audit.md` |
| Stage A audits | Done — route, visual, design contract |
| Stage B foundation | Done — `DashboardShell`, nav, state primitives, `customer-route-error` |
| Stage C route migrations | **Partial** — overview, notifications, presence, collections copy, shares; watchlists/digests/onboard unchanged structurally |
| Stage G data reliability | Started — shared error mapping + tests |
| PR / deploy / smokes | PR opened |

## Root cause (verified)

`/search` inlined `f9-cursor-shell` + ad-hoc nav; `/app/*` used legacy `f9-app-shell` + `f9-app-sidebar` in `app-layout.tsx`. Unified via `DashboardShell` + `dashboard-navigation.ts`.

## Key changes

- Single shell: `app-layout.tsx`, `search.tsx` → `DashboardShell`
- Notifications (`/app/sources`): removed agent action catalog from customer UI
- Overview: action-oriented; no agent memory dump
- Collections copy unified (Boards → Collections)
- Presence migrated to `f9-app-stack` panels (was unstyled `f9-page`)
- Shared: `empty-state`, `error-state`, `route-skeleton`, `plan-limit-state`, `permission-state`, `dashboard-page`

## Remaining (post-PR)

- Wrap remaining `/app/*` routes in `DashboardPage` header pattern (watchlists, digests, team, etc.)
- Route-level error boundaries using `ErrorState`
- Remove dead `.f9-app-shell` layout CSS when safe
- Manual smoke: search ↔ overview nav, presence entitled user, notifications API keys

## Test / build

- `npm test` — 1258 passed
- `npm run typecheck` — pass
- `npm run build` — pass
