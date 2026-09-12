# Permission matrix — workspace roles for org-scoped ownership

Epic: Nishfleet/0509#2993 · plan: [`org-scoped-ownership-plan.md`](./org-scoped-ownership-plan.md)

Roles: **owner** (workspace owner, agency subscriber) · **admin** (delegate
trusted with credentials and delivery) · **member** (works the data). Roles are
stored on the membership (`org_member.role` from P2; `workspace_member.role`
exists since migration 0027 but is dead schema today) and enforced **server-side
on every action** (P5) — never in the UI.

Rule of thumb: members work the data; admins additionally hold credentials and
outbound delivery; owners additionally hold the team and the workspace identity.
Billing and account surfaces are **personal** (the owner's own session) and are
never workspace-scoped.

Enforcement status: today every workspace member effectively acts as the owner
(`requireWorkspaceSession` swaps the member's id for the owner's with no role
check); team management is owner-only because it runs on the owner's own
session. P5 lands the enforcement named below; this matrix is the spec those
tests assert. Every row here gets a route-level test in P5 (one per state
changing action: member → denied, admin/owner → allowed, per column).

## 1. Workspace data — every role (member and up)

| Surface | Action / intent | member | admin | owner |
|---|---|---|---|---|
| POST /app/dashboard | `create-watchlist`, `run-saved-query`, `track-saved-query`, `close-counter-move`, `finish`, `create-market-desk-import`, `preview-market-desk-import` | ✓ | ✓ | ✓ |
| POST /app/watchlists, /app/watchlists/:id | `update-watchlist`, `pause-watchlist`, `resume-watchlist`, `refresh-watchlist`, `bulk-watchlists`, `accept-suggested-competitor`, `bulk-accept-suggested-competitors`, `share-watchlist`, `share-archive` | ✓ | ✓ | ✓ |
| POST /app/collections | `create-collection`, `update-item`, `remove-item`, `add-external-proof`, `share-collection`, `delete-collection` | ✓ | ✓ | ✓ |
| POST /app/clients | `upsert-client-room`, `set-client-room-status`, `upsert-agent-memory`, `approve-client-room` | ✓ | ✓ | ✓ |
| POST /app/presence, /app/presence/:id | `create-entity`, `add-source`, `poll-source`, `delete-entity` | ✓ | ✓ | ✓ |
| POST /app/shares | `revoke-share` | ✓ | ✓ | ✓ |
| POST /app/reports/:id | `share-report`, `download-pdf` | ✓ | ✓ | ✓ |
| POST /app/briefs | `share-digest` | ✓ | ✓ | ✓ |
| POST /app/account | `save-brand-profile`¹, `save-report-branding`¹ | ✓* | ✓ | ✓ |
| POST /api/v1/actions, /api/mcp | `watchlist.create/update/refresh/pause/resume`, `collection.create`, `proof.add_external`, `share.create`, `report.create`, `report.share`, `counter_move_brief.create`, `memory.upsert`, `memory.list`, `client_room.upsert`, `client_room.list`, `support_case.create`, `support_case.list`, `get_workspace_readiness`, `get_change_history`, `get_offer_state_at`, `diff_offer`, `list_suppressed`, `web_mentions.list` | ✓ (write actions need a write-enabled key) | ✓ | ✓ |

\* `save-brand-profile` / `save-report-branding` write `workspace_branding` —
the workspace's outward identity. P5 tightens these to admin+ (owner sets the
brand, admins/members inherit it); they sit at ✓* until then. Decided: **admin
+ owner only at enforcement time**.

## 2. Delivery and credentials — admin and owner

| Surface | Action / intent | member | admin | owner |
|---|---|---|---|---|
| POST /app/watchlists, /app/watchlists/:id | `add-delivery-target`, `toggle-delivery-target`, `save-delivery-config`, `send-test-email` | ✗ | ✓ | ✓ |
| POST /app/dashboard | `capture-delivery-timezone` | ✗ | ✓ | ✓ |
| POST /app/notifications | `save-slack-webhook`, `pause-slack-webhook`, `resume-slack-webhook`, `save-teams-webhook`, `pause-teams-webhook`, `resume-teams-webhook`, `save-whatsapp-target` | ✗ | ✓ | ✓ |
| POST /app/api | `create-api-key`, `revoke-api-key` | ✗ | ✓ | ✓ |
| POST /app/source-access | `connect-meta-token`, `disconnect-meta-token`, `retest-meta-token` | ✗ | ✓ | ✓ |
| POST /api/v1/actions, /api/mcp | `delivery_targets.list`, `delivery_settings.update`, `delivery_target.update`, `source.meta.retest` | ✗ | ✓ | ✓ |

Rationale: delivery targets and notification webhooks send outbound mail /
Slack / Teams / WhatsApp as the workspace, and API keys + the Meta token are
credentials. Members never hold or steer them.

## 3. Team and workspace identity — owner only

| Surface | Action / intent | member | admin | owner |
|---|---|---|---|---|
| POST /app/team | `invite`, `resend-invite`, `revoke` | ✗ | ✗ | ✓ |
| POST /app/account | `save-brand-profile`, `save-report-branding` (enforced from P5) | ✗ | ✓ | ✓ |

Seat limits and plan-gating of invites stay as shipped (Agency seats; pricing
untouched — Nish-reserved per #2993).

## 4. Personal surfaces — never workspace-scoped (out of the role matrix)

These run on `requireSession` (the actor's own session) by design; scoping them
to the workspace would leak or mutate another person's identity or money:

- `/app/account`: `request-email-change`, `resend-verification`,
  `revoke-session`, `revoke-other-sessions`, `request-account-deletion`.
- `/app/billing` and `/api/billing/*` (checkout, cancel, plan change, portal,
  reconciliation): the owner's subscription. A member's session can never act
  on it — not even read it.
- `/app/onboard` (first-run), auth routes, `/app/settings` (read-only index),
  public token-gated surfaces (`/share/:token`, `/export/:type/:id`, public
  marketing) — token/plan-gated, not role-gated.

## 5. Enforcement notes for P5

- Enforcement point: `requireWorkspaceSession` gains the effective role
  (resolved from the membership row of `session.user.id` against the active
  workspace); route actions consult the matrix via a single helper
  (`requireRole(...)` / `assertCan(...)`), so the matrix is data, not scattered
  `if`s.
- The active-workspace resolution keeps today's property until P6: member
  sessions resolve to the workspace owner's id. P6 replaces the silent
  fallback with explicit resolution; P5's role check rides the same context.
- Deny response shape follows the existing canonical action result
  (`withWorkspace` / `planLimit` 402/403 conventions) — no new error channel.
- API-key surfaces resolve the role from the **key owner's** membership, and
  write-enabled keys remain Agency-only (catalog requirement unchanged).
- Tests: one per state-changing action per matrix row — member denied,
  admin/owner allowed, personal surfaces untouched by workspace context — plus
  the cross-tenant property harness in `tests/integration/ownership/` which is
  independent of roles (a member of workspace A can never touch workspace B
  with *any* role).
