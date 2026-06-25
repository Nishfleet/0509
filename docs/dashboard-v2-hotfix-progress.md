# Dashboard V2 production hotfix — 2026-06-25

## Baseline

- **Starting runtime commit:** `cf6eca7e8067b0775ce8fe4fec29008025ac5046` (PR #245 merge on `main`)
- **Branch:** `cursor/dashboard-v2-production-hotfix-20260625`
- **Baseline tests:** 1275 passed (136 files) before hotfix; 1275 after integration
- **Domains:** `0509.in`, `www.0509.in`, `api.0509.in`

## Workstream ownership

| Workstream | Owner branch (logical) | Files |
|------------|------------------------|-------|
| A Mobile shell | `cursor/dashboard-hotfix-mobile-20260625` | `dashboard-shell.tsx`, `dashboard-navigation.ts`, `app.css`, `app-layout.tsx` |
| B Language / feature state | `cursor/dashboard-hotfix-language-20260625` | readiness, billing, status, account, team, dashboard, digests, clients, help, watchlists, `customer-billing-copy.ts`, `customer-terminology.ts` |
| C Error sanitization | `cursor/dashboard-hotfix-errors-20260625` | `customer-route-error.ts`, support/clients actions |
| D Public docs branding | `cursor/dashboard-hotfix-docs-20260625` | `app.css` (`.f9-app-brand`), `bots.presence.tsx` |

## Fixes shipped

### P0 — Mobile navigation

- **Root cause:** `@media (max-width: 760px)` set `.f9-cursor-main { order: 1 }` and `.f9-cursor-rail { order: 2 }`, pushing the rail below long page content.
- **Model:** Fixed bottom primary navigation (`f9-dash-mobile-nav`) with safe-area padding; desktop rail unchanged; rail hidden on mobile (`f9-cursor-rail-desktop`).

### P0 — Overview readiness / MCP leakage

- Removed `MCP agent context` readiness item; consolidated into customer-facing **Developer access** check.

### P0 — Internal workspace language

- Replaced customer-facing copy in billing, status, and `agencyCheckoutHeldCustomerCopy()` with scale-capacity language (no “internal workspace”).

### P0 — Web mentions stub

- Removed incomplete **Web mentions** panel from Watchlists.
- When Presence is entitled, shows **Website presence** entry linking to `/app/presence`.

### P1 — Duplicate topbar CTAs

- Secondary CTA is now **Overview** (`/app`); primary remains **Add competitor** (`/search`).

### P1 — Terminology

- Collections / Digests / Notifications / navigation menu / Sign-in security applied across account, team, dashboard, digests, clients, help.

### P1 — Error sanitization

- Expanded `mapCustomerRouteError` / `sanitizeCustomerFacingMessage` for JSON blobs, stack traces, UUIDs, infra tokens; action handlers sanitized in support and client rooms.

### P1 — Public docs branding

- Restored scoped `.f9-app-brand` styles (no `.f9-app-shell` resurrection).
- `/bots/presence` uses `PublicDocHeader` + legal shell branding.

## Reviewer verdicts

- **UX/accessibility (E):** APPROVE DASHBOARD HOTFIX — pending live screenshot pass after deploy
- **Product red-team (F):** APPROVE DASHBOARD HOTFIX — no critical/high customer leakage in `app/routes/app*.tsx` surfaces

## Validation

- `npm test` — 1275/1275
- `npm run typecheck` — pass
- `npm run build` — pass
- `node scripts/validate-d1-backup.mjs` — pass
- No new migrations

## Deployment

- **PR:** https://github.com/nish3451/0509/pull/246 (follow-up https://github.com/nish3451/0509/pull/247)
- **Merge commits:** `5edb1bf` (hotfix), `6cd62d5` (help copy)
- **Runtime commit:** `6cd62d58db85463b2bc5375f0c52519922ee3821`
- **Worker version:** `61e32596-383e-4c73-8ec3-cc4012b55c0a`
- **Rollback version:** `1f9ba087-50db-42a5-8c16-6c8556fbbd0c`
- **Domains:** `0509.io`, `www.0509.io`, `api.0509.io`, `0509.in`, `www.0509.in`, `api.0509.in`

## Production smokes (2026-06-25)

- Public: `/api/health`, `/`, `/search`, `/help`, `/status`, `/bots/presence`, `/auth/login` — OK
- `/help` — no Better Auth / internal workspace / MCP / Web mentions leakage (post #247)
- `/bots/presence` — Five to Nine brand header restored
- Authenticated mobile nav — requires signed-in session (not exercised with customer data)

## Remaining minor issues

- Marketing/compare pages still use “boards” in competitor positioning copy (out of hotfix scope).
- `agent-action-catalog.ts` retains internal MCP labels for API/MCP server routes only.
