# 0509 Memory

Last updated: 2026-03-30

## Product

- `0509` is a Meta competitor analysis workspace for growth teams.
- The product now has three layers:
  - public `analysis`
  - retained `monitoring`
  - reusable `workspace memory`
- India-first positioning is part of the current product truth, with region-aware pricing for India vs rest of world.

## Stack

- React Router v7 on Cloudflare Workers
- React 19
- TypeScript 6
- Better Auth
- D1
- R2
- Resend

## Durable Repo Notes

- Current app code lives under `app/` with the Worker entry in `workers/app.ts`.
- The current route tree is defined in `app/routes.ts`.
- Core product logic lives in:
  - `app/lib/meta-api.server.ts`
  - `app/lib/analysis.server.ts`
  - `app/lib/landing-pages.server.ts`
  - `app/lib/data.server.ts`
  - `app/lib/monitoring.server.ts`
- D1 schema lives under `migrations/`.
- `workers/app.ts` handles the HTTP runtime and scheduled monitoring/digest jobs.
- `app/root.tsx` handles session-aware pricing region defaults via Cloudflare country headers and persisted user/cookie preference.

## Working Conventions

- Prefer the Cloudflare app as the source of truth; treat the old `src/` tree as legacy reference only.
- Public search may operate in demo mode when no Meta token is configured, but monitoring should remain honest about live-vs-demo-vs-degraded state.
- Verify real browser behavior after changes to auth, search, watchlists, digests, or sharing flows.

## Useful Context

- `README.md` should describe the Cloudflare app, not the older Next.js prototype.
- The old Next/Supabase product shape is useful only as historical context for how the idea evolved.
