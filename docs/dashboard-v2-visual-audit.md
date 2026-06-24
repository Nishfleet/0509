# Dashboard V2 — Visual Audit

## Root cause: dual shell (verified)

Before Dashboard V2, the logged-in workspace had **two incompatible chrome implementations**:

| Surface | Shell classes | Navigation source |
|---------|---------------|-------------------|
| `/search` | `f9-cursor-shell`, `f9-cursor-rail`, `f9-cursor-main` | Inline ad-hoc `NavLink` list in `search.tsx` |
| `/app/*` | `f9-app-shell`, `f9-app-sidebar`, `f9-app-main` | Duplicate hand-maintained links in `app-layout.tsx` |

### Symptoms

- Jumping Search → Overview changed layout width, rail styling, and nav labels.
- Nav IA drifted (e.g. "Boards" in sidebar vs "Collections" in product copy).
- Top actions only on some pages; sidebar footer inconsistent.
- Presence routes used a third pseudo-system (`f9-page`, `f9-card`) with **no CSS definitions** in `app/app.css`.

### Fix (Dashboard V2)

1. **`app/components/dashboard-shell.tsx`** — canonical shell wrapping `f9-cursor-shell` rail + main.
2. **`app/lib/dashboard-navigation.ts`** — single nav config (PRIMARY / SETTINGS / staff Ops).
3. **`app/routes/app-layout.tsx`** — renders `DashboardShell` + `<Outlet />`; no legacy sidebar.
4. **`app/routes/search.tsx`** — same `DashboardShell` (public minimal rail vs full workspace rail).
5. **`app/app.css`** — `.f9-dash-*` utilities for page content, states, topbar.

### Remaining legacy CSS

`.f9-app-shell` / `.f9-app-sidebar` rules remain in `app/app.css` for panel tokens (`.f9-app-panel`, `.f9-app-stack`) used inside the main content area. The **layout** no longer mounts `f9-app-shell` as a page wrapper.

## Design systems boundary (unchanged)

- **Public** (`/`, `/search` logged out, auth): "Caught in the act" — bone ground, ink borders (`DESIGN.md`).
- **Workspace** (`/app/*`, authenticated search): Vercel-inspired calm tool UI inside `f9-cursor-shell`.

## State coverage policy

All workspace routes should use shared primitives:

- `EmptyState` — zero data, clear CTA
- `ErrorState` — loader/action failure with retry hint
- `RouteSkeleton` — deferred loader pending UI
- `PlanLimitState` / `PermissionState` — gating copy
- `PartialDataNotice` — honest degraded data

Mapped errors via `app/lib/customer-route-error.ts`.
