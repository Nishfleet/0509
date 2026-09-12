# Org-scoped ownership plan — agencies, roles, multi-membership

Epic: Nishfleet/0509#2993 (Nish decision 2026-09-11: "Build it, but not with duct tape obviously.")
Supersedes the *intent* of #2176 phase 1 (foundation, closed 2026-09-10) and completes it.

This document is the epic's table inventory, phase plan, and risk register. The
permission matrix lives in [`permission-matrix.md`](./permission-matrix.md). The
boundary test harness lives in `tests/integration/ownership/` — its manifest is
the machine-checked version of the inventory below (§2), and
`tests/integration/ownership-classification.integration.test.ts` fails the build
if any table in the real D1 schema is left unclassified.

## 1. Where the model stands today (verified against `origin/main` 2026-09-11)

- Product data is keyed by `user_id`, where the id is the **workspace owner's
  user id** ("workspace user id" proxy). `requireWorkspaceSession()`
  (`app/lib/auth.server.ts`) resolves members to the owner's id;
  `resolveWorkspace()` (`app/lib/workspace.server.ts`) does the resolution.
- `resolveWorkspace()` **silently falls back to the user's personal workspace**
  whenever the member has zero or **more than one** active membership, or the
  owner is not on the agency plan. That silent fallback is the exact behaviour
  the epic forbids once multi-membership lands.
- `workspace_member` (migration 0027) already carries a `role` column
  (`DEFAULT 'member'`) — **dead schema**: no query reads it, no route enforces
  it. Membership is also single: `acceptWorkspaceInvite()` refuses a user who
  already belongs to any workspace, and `scripts/check-workspace-member-invariants.mjs`
  enforces one active membership per member in prod.
- #2176 phase 1 shipped real foundations, unused since:
  - migration `0089_org_scoped_ownership.sql`: `org` table, deterministic
    personal-org backfill (`org_<user.id>`), **nullable `org_id` on exactly four
    tables** (watchlist, share_link, customer_api_key, client_room) + indexes.
  - `app/lib/data/org.server.ts`: `getOrCreatePersonalOrg()` seam.
  - `AGENCY_ORG_MODE_ENABLED` env flag (`app/lib/env.server.ts`): read by
    nothing. No code writes any `org_id`.
- 88 live tables exist after the full migration chain (shadow/backup tables are
  dropped in-migration). 44 reference a user column. §2 classifies all of them.

## 2. Table inventory (complete)

Classification of every live table. "Direct" = carries `user_id` (or
`workspace_user_id`) and must become org-keyed. "Via parent" = no direct owner
column; scoped transitively through a parent that is (or will be) org-keyed;
its enforcement is covered by the parent's probe. The live classification is
`tests/integration/ownership/ownership-manifest.ts`; the doc and the manifest
must agree — the classification test enforces manifest completeness against
`sqlite_master`, so a new product table cannot merge unclassified. The manifest
is authoritative when the two disagree; PRs that move a table update both.

### 2a. Direct product tables — move to `org_id`

| Table | Today's key | Probe now? | Phase |
|---|---|---|---|
| watchlist | user_id (+ nullable org_id from 0089) | yes (read+mutate) | P3 backfill, P4 dual-write |
| share_link | user_id (+ org_id from 0089) | yes (read+mutate) | P3, P4 |
| customer_api_key | user_id (+ org_id from 0089) | yes (read+mutate) | P3, P4 |
| client_room | user_id (+ org_id from 0089) | yes (read+mutate) | P3, P4 |
| collection | user_id | yes (read+mutate) | P3, P4 |
| saved_query | user_id | yes (read) | P3, P4 |
| agent_memory | user_id | yes (read+mutate) | P3, P4 |
| support_case | user_id | yes (read) | P3, P4 |
| tracked_entity | user_id | yes (read+mutate) | P3, P4 |
| source_target | user_id (+ tracked_entity_id) | yes (read+mutate) | P3, P4 |
| source_connection | user_id (+ tracked_entity_id) | no | P3, P4 (OAuth credentials — owner/admin) |
| support_case_event | user_id (+ case_id) | no | P3, P4 |
| tag | user_id | no | P3, P4 |
| client_room_resource | user_id (+ client_room_id) | via client_room | P3, P4 |
| watchlist_delivery_config | user_id (+ watchlist_id) | no | P3, P4 |
| workspace_delivery_config | user_id | no | P3, P4 |
| workspace_branding | user_id | no | P3, P4 |
| customer_meta_connection | user_id | no | P3, P4 (credential surface — owner/admin only) |
| digest_run | user_id | no | P3, P4 |
| digest_schedule_job | user_id | no | P3, P4 |
| delivery_target | user_id (+ watchlist_id) | no | P3, P4 |
| delivery_attempt | user_id (+ watchlist_id, digest_run_id) | no | P3, P4 |
| web_mention_target | user_id (+ watchlist_id) | no | P3, P4 |
| web_mention_observation | user_id (+ target_id) | no | P3, P4 |
| presence_item | user_id (+ tracked_entity_id) | no | P3, P4 |
| presence_entity_link | user_id | no | P3, P4 |
| presence_alert_cursor | user_id | no | P3, P4 |
| presence_domain_verification | user_id | no | P3, P4 |
| agent_action_audit | user_id (append-only audit) | no | P3, P4 |
| proof_usage_credit | user_id | no | P3, P4 |
| evidence_usage_period / evidence_usage_reservation / evidence_top_up_grant / evidence_top_up_ledger_entry / evidence_top_up_adjustment | workspace_user_id (already workspace-proxy keyed) | no | P3, P4 (add org_id for uniformity) |

### 2b. Via-parent product tables — scoped through an org-keyed parent

| Table | Parent | Phase |
|---|---|---|
| watchlist_run | watchlist | inherits parent scoping (P4) |
| watch_event | watchlist | inherits |
| event_candidate | watchlist | inherits |
| website_page_observation | watchlist (already also carries `workspace_id`) | inherits |
| website_site_scan | watchlist | inherits |
| website_site_scan_page | website_site_scan | inherits |
| source_snapshot | watchlist | inherits |
| proof_target | watchlist | inherits |
| proof_capture | proof_target | inherits |
| landing_page_snapshot * | (content-addressed artifact store, keyed by canonical_url hash) | stays shared (see reason) |
| digest_delivery | digest_run | inherits |
| digest_item | digest_run (+ watchlist_id) | inherits |
| ad_observation | watchlist_run | inherits |
| collection_item | collection | inherits |
| collection_item_tag | collection_item | inherits |
| presence_poll_cursor | source_target | inherits |

\* `landing_page_snapshot` is a shared, deduplicated capture cache keyed by
canonical-url identity — it has no owner column by design. Access still flows
only through watchlist-scoped parents; it never joins to a user directly.

### 2c. Platform tables — stay user-keyed / infra (never workspace data)

| Table | Why it stays |
|---|---|
| user, session, account, passkey, verification, better_auth_magic_link_ticket | auth identity |
| user_plan, dodo_webhook_event | billing, per-user subscription (seat pricing is Nish-reserved, out of scope) |
| workspace_member | the membership table itself — becomes role-bearing in P2, multi-membership in P6 |
| org | the ownership unit (P2 extends it) |
| presence_pilot_workspace | internal allowlist (hashed workspace ids) |
| presence_oauth_transaction | per-user OAuth handshake |
| pricing_region_preference | personal UI preference |
| signup_source_pending | marketing attribution |
| rate_limit_events, e2e_test_mode, retention_sweep_state, monitoring_concurrency_slot, cron_failure_alert_throttle, cron_failure_alert_accepted_window | infra/ops state |
| email_suppression | platform deliverability ledger (issue #2983), keyed by recipient address only — no user or workspace column, so one suppression applies to every sender |
| discovery_cache_entry, discovery_fetch_log, discovery_query_lease, discovery_provider_state, search_domain_identity_cache | globally shared caches/leases (dedup across workspaces is the point) |
| ad, meta_integration_log, browser_job_telemetry, ads_domain_publisher_state | shared provider corpus / provider logs / SEO ops |
| release_scheduled_observation, scheduled_observation_alert_state, scheduled_observation_health_state | release/observation ops state |
| error_report | ops error-report sink — route/reason telemetry rows, no customer data |
| analysis_field | polymorphic `scope_type`/`scope_id` — follows its parent surface; never user-joined directly |
| status_probe_samples | status-probe telemetry samples (issue #3186) — probe name, ok/latency, checked_at; ops observability, no customer rows |

## 3. Decision: adopt 0089, extend it — no replacement

`0089_org_scoped_ownership.sql` is adopted. It already follows the
expand/contract rule (nullable columns, deterministic idempotent backfill, no
drops) and its `org` table + `getOrCreatePersonalOrg()` seam are the right
shape. What it is not: complete. A follow-up migration adds nullable `org_id`
to the remaining direct product tables in §2a (P3), the backfill fills **all**
of them (not just the four 0089 touched), and the read-switch (P7) makes
`org_id` the ownership key. `user_id` is demoted to provenance ("created by"),
never dropped — rollback rolls back code, never data. No permanent dual-keying:
the read-switch is gated by one flag and the dual-write window closes in P7.

Correction noted: `app/lib/data/org.server.ts`'s header says the backfill is
"migration 0088"; the migration is 0089. Fixed in P2's PR touching that file.

## 4. Phases — one PR each, each shippable behind the flag

| Phase | PR scope | Issue |
|---|---|---|
| P1 (this PR) | this plan + permission matrix + boundary test harness (10 executed probes, full-table classification guard) | #2993 |
| P2 | `org_member(org_id, user_id, role)` schema with owner/admin/member roles + indexes; extend `org` (plan-tier snapshot for seat logic); expand `AGENCY_ORG_MODE_ENABLED` wiring seam. Expand-only migration. | #3074 |
| P3 | Complete `org_id` coverage: remaining §2a tables get nullable `org_id`; idempotent + resumable backfill script for ALL direct tables (org_id = personal org of the row's workspace user id); zero-orphan verification query; integration tests asserting new read+write paths on real D1. | #3076 |
| P4 | Dual-write behind `AGENCY_ORG_MODE_ENABLED`: every data-seam write sets `org_id` alongside `user_id`; backfill re-run in CI check; orphan canary. | #3077 |
| P5 | Roles enforced server-side: `requireWorkspaceSession` returns the effective role; permission-matrix enforcement helpers; a test per state-changing route under `/app/*` and `/api/v1/*` proving the matrix is enforced (not in the UI). | #3078 |
| P6 | Multi-membership: lift the single-membership constraint in invite/accept/revoke logic; explicit active workspace (session-stored, audited); workspace switcher; `resolveWorkspace()` never silently drops to personal — it errors or resolves explicitly. | #3079 |
| P7 | Read-switch + cutover: queries filter by `org_id` (membership-checked) instead of the workspace-user-id proxy; flag flip with rollback runbook that loses no data; dual-write window closes; `user_id` remains as provenance. | #3080 |

Each phase issue is agent-ready (acceptance criteria + pointers) and linked
back to #2993.

## 5. The boundary test harness (shipped in P1)

`tests/integration/ownership/` on the `workers` vitest project (real workerd,
real D1, real migrations — the only project where a D1 assertion means
anything):

- `ownership-manifest.ts` — the machine-checked inventory: executed probes,
  pending-probe tables (with phase issue refs), via-parent tables, platform
  tables with one-line reasons.
- `harness.ts` — the property executor. For every probe it seeds two
  independent workspaces (owner A + member of A, owner B), then asserts the
  cross-tenant property through the **real data seam** (the same helpers
  routes call):
  1. member-of-A listing returns workspace A's rows and never B's;
  2. a guarded get of B's row id in A's workspace context returns null;
  3. a scoped mutation against B's row id in A's context changes nothing;
  4. the same mutation in B's own context **does** apply (positive control —
     the guard is not just "everything fails").
- `workspace-ownership-boundary.integration.test.ts` — runs every executed probe.
- `ownership-classification.integration.test.ts` — every table in
  `sqlite_master` must be classified by the manifest; manifest entries must
  exist. A new product table cannot merge unclassified.

Wave 1 executes 10 direct probes (§2a "probe now?" column), of which
`support_case` and `saved_query` execute the guarded-get step only (no scoped
mutation helper exists yet — §6.3/§6.4; P3 adds those guards and mutate steps).
Phase PRs move tables from pending to executed as their seams gain scoped
mutation helper
(e.g. P3 adds the `touchSavedQueryRun` user guard finding in §6).

## 6. Risks and known gaps (found while building the inventory)

1. **`resolveWorkspace()` silent fallback** — with multi-membership this drops
   users to the wrong workspace without a trace. P6 makes the active workspace
   explicit and audited. Until P6, single-membership invariant keeps prod safe
   (enforced by `scripts/check-workspace-member-invariants.mjs`).
2. **Seat-count SQL assumes one workspace per member** — invite/accept SQL
   counts memberships globally ("already belongs to another workspace").
   Multi-membership (P6) rewrites these predicates against `org_member`.
   Agency seat limits themselves are untouched (pricing is Nish-reserved).
3. **`createSupportCaseEvent()` has no owner guard** — it inserts
   `(case_id, user_id=actor)` without checking the case belongs to the actor.
   Not route-reachable today (no customer-facing intent dispatches it with a
   foreign case id), but P3 adds the `user_id = owner` predicate to the seam
   and a probe.
4. **`touchSavedQueryRun()` is not user-scoped** (id-only UPDATE). Route paths
   resolve the saved query with the owner guard first, so it is not reachable
   cross-tenant today; P3 adds the guard so the seam itself is safe.
5. **`billingCanaryMutationGuardSql` threads through watchlist mutations** —
   dual-write (P4) must keep the guard predicates intact; the watchlist probe
   exercises them.
6. **Restore-evidence gate** — all migrations stay additive (no drops, no
   renames), so `backup:d1` / `restore:d1:transform` / restore-evidence flows
   are unaffected. P7's cutover runbook re-verifies a backup→restore drill
   before the flag flips.
7. **D1 has no down-migrations** — every phase migration is one-way; rollback
   is always a flag flip, never a schema revert.
8. **`@cloudflare/vitest-plugin` naming** — integration tests import from
   `cloudflare:workers` / `cloudflare:test`; never the pre-2026-08-19
   `vitest-pool-workers` name or `SELF.fetch`.

## 7. Out of scope (per #2993)

Seat pricing changes (Nish), agency marketing copy, dropping `user_id`
columns, and any prod D1 migration execution (write-the-migration only; prod
application stays behind the senior process gate).
