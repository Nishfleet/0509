# Dashboard V2 production hotfix — 2026-06-25

This file records the fixed-candidate June 25 hotfix and polish evidence. Its test, reviewer, runtime, and smoke results are historical; they are not a current Gate B/C candidate pass or Gate D external proof.

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

## Historical Validation (2026-06-25)

- `npm test` — 1275/1275
- `npm run typecheck` — pass
- `npm run build` — pass
- `node scripts/validate-d1-backup.mjs` — pass
- No new migrations

## Deployment

- **PR:** https://github.com/Nishfleet/0509/pull/246 (follow-up https://github.com/Nishfleet/0509/pull/247)
- **Merge commits:** `5edb1bf` (hotfix), `6cd62d5` (help copy)
- **Runtime commit:** `6cd62d58db85463b2bc5375f0c52519922ee3821`
- **Worker version:** `61e32596-383e-4c73-8ec3-cc4012b55c0a`
- **Rollback version:** `1f9ba087-50db-42a5-8c16-6c8556fbbd0c`
- **Domains:** `0509.io`, `www.0509.io`, `api.0509.io`, `0509.in`, `www.0509.in`, `api.0509.in`

## Historical Production Smokes (2026-06-25)

- Public: `/api/health`, `/`, `/search`, `/help`, `/status`, `/bots/presence`, `/auth/login` — OK
- `/help` — no Better Auth / internal workspace / MCP / Web mentions leakage (post #247)
- `/bots/presence` — Five to Nine brand header restored
- Authenticated mobile nav — requires signed-in session (not exercised with customer data)

## Remaining minor issues

- Marketing/compare pages still use “boards” in competitor positioning copy (out of hotfix scope).
- `agent-action-catalog.ts` retains internal MCP labels for API/MCP server routes only.

---

## Final polish — 2026-06-25 (PR #249)

### Baseline

- **Starting main commit:** `4bccc5e7181fc037ca08d834e844d656c25d7d05` (PR #248 docs merge)
- **Starting runtime commit:** `6cd62d58db85463b2bc5375f0c52519922ee3821`
- **Starting Worker version:** `61e32596-383e-4c73-8ec3-cc4012b55c0a`
- **Branch:** `cursor/dashboard-v2-final-polish-20260625`

### Fixes shipped

- **Mobile discoverability:** Team and Client rooms added to the fixed mobile utility strip (not bottom nav); utility strip hidden on desktop; bottom shell padding increased to `148px + safe-area` with utility offset `96px`.
- **Terminology:** Collections / Digests / Notifications aligned across app routes, onboarding, marketing, compare, docs, pricing preview features, public markdown, team invite copy, and search save flows. Counter-move follow-ups use “follow-up” (distinct from Digests).
- **Readiness CTAs:** “Open notifications” replaces “Open sources”.

### Team / Client Rooms decision

- **Client rooms:** Active for all signed-in owners (not plan-gated); discoverable via mobile utility strip.
- **Team:** Agency-gated (`team_workspace`); discoverable via mobile utility strip; server-side 403 for ineligible owners unchanged.

### Reviewer verdict

- **Reviewer D (post-fix):** APPROVE FINAL DASHBOARD V2

### Historical Validation (final polish)

- `npm test` — 1277/1277 (136 files)
- `npm run typecheck` — pass
- `npm run build` — pass
- `node scripts/validate-d1-backup.mjs` — pass (dry-run)
- Remote D1 — no migrations to apply (historical snapshot)
- `npm run canary:prod` — pass (post-deploy)

### Deployment

- **PR:** https://github.com/Nishfleet/0509/pull/249
- **Merge commit:** `321d7c9bbca16ff9da3c7c2d2ec620453a01338b`
- **Runtime commit:** `321d7c9bbca16ff9da3c7c2d2ec620453a01338b`
- **Worker version:** `2ff3c030-39c1-4977-87a2-dd6347f05081`
- **Rollback version:** `61e32596-383e-4c73-8ec3-cc4012b55c0a` (Dashboard V2 hotfix)

### Historical Production Smokes (final polish)

- Public: `/api/health`, `/`, `/search`, `/help`, `/status`, `/auth/login` — OK
- Marketing pricing: “Weekly digests”, “saved collections” live on `0509.io`
- Login proof list: “Collections” (not Boards)
- Authenticated mobile journey — requires signed-in internal session (not exercised in automation; owner sign-in at `/auth/login`)

### Provenance note (Git vs runtime)

| Artifact | Commit / version |
|---|---|
| Dashboard V2 hotfix runtime | `6cd62d58` / Worker `61e32596` |
| Hotfix provenance docs (PR #248) | `ae32da7` merged as `4bccc5e` — documentation only, no redeploy |
| Final polish runtime (PR #249) | `321d7c9` / Worker `2ff3c030` |
| This provenance update | documentation only — no redeploy |

### Remaining minor issues

- Mobile utility strip is dense on narrow phones (6 links + sign out); device spot-check recommended.
- Reports (`/app/shares`) still desktop-rail only.
- Client rooms scope enum labels (`customer`, `workspace`) still expose backend values in UI.
- `agent-action-catalog.ts` retains MCP/developer labels for API routes only.
- Marketing hero still says “morning brief” in stats belt (distinct from weekly Digests product noun).
