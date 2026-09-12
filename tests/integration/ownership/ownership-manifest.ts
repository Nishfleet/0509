/**
 * Machine-checked ownership inventory for the org-scoped ownership epic
 * (#2993). The prose inventory lives in `docs/org-scoped-ownership-plan.md`
 * (§2); this manifest is its executable counterpart.
 *
 * `tests/integration/ownership-classification.integration.test.ts` fails the
 * build if any table in the real D1 schema (sqlite_master) is left
 * unclassified by this manifest, so a new product table cannot merge without
 * being inventoried here. Probes for `owned-probe-pending` tables land in the
 * phase PRs referenced below; the boundary harness
 * (`tests/integration/workspace-ownership-boundary.integration.test.ts`)
 * executes every probe in OWNED_PROBES.
 */

export type OwnershipClassification =
  | { kind: "owned-probe"; table: string }
  | { kind: "owned-probe-pending"; table: string; phaseIssue: number }
  | { kind: "scoped-via-parent"; table: string; parent: string }
  | { kind: "membership"; table: string }
  | { kind: "ownership-unit"; table: string }
  | { kind: "platform"; table: string; reason: string };

/** Phase issue numbers for the epic's slice plan (one PR per phase). */
export const PHASE_ISSUES = {
  membershipRolesSchema: 3074, // P2
  orgIdCoverageBackfill: 3076, // P3
  dualWrite: 3077, // P4
  rolesEnforcement: 3078, // P5
  multiMembership: 3079, // P6
  readSwitchCutover: 3080, // P7
} as const;

/**
 * Tables with an executed boundary probe (wave 1). Each entry has a matching
 * probe in `./boundary-probes.ts`; the two lists must stay in sync (asserted
 * by the classification test).
 */
export const OWNED_PROBE_TABLES = [
  "watchlist",
  "collection",
  "share_link",
  "customer_api_key",
  "client_room",
  "agent_memory",
  "support_case",
  "saved_query",
  "tracked_entity",
  "source_target",
] as const;

/**
 * Direct product tables (carry user_id / workspace_user_id today) whose
 * boundary probes land with their phase PR. Every entry names the phase issue
 * that owns the probe so the pending set can never grow silently.
 */
export const OWNED_PROBE_PENDING: ReadonlyArray<{ table: string; phaseIssue: number }> = [
  { table: "tag", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "client_room_resource", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "source_connection", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "watchlist_delivery_config", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "workspace_delivery_config", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "workspace_branding", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "customer_meta_connection", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "digest_run", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "digest_schedule_job", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "delivery_target", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "delivery_attempt", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "web_mention_target", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "web_mention_observation", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "presence_item", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "presence_entity_link", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "presence_alert_cursor", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "presence_domain_verification", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "agent_action_audit", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "proof_usage_credit", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "support_case_event", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "evidence_usage_period", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "evidence_usage_reservation", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "evidence_top_up_grant", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "evidence_top_up_ledger_entry", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
  { table: "evidence_top_up_adjustment", phaseIssue: PHASE_ISSUES.orgIdCoverageBackfill },
];

/**
 * Product tables with no direct owner column: scoped transitively through a
 * parent that is (or will be) org-keyed. Their cross-tenant enforcement is
 * covered by the parent's probe plus the parent's scoped queries.
 */
export const SCOPED_VIA_PARENT: ReadonlyArray<{ table: string; parent: string }> = [
  { table: "watchlist_run", parent: "watchlist" },
  { table: "watch_event", parent: "watchlist" },
  { table: "event_candidate", parent: "watchlist" },
  { table: "website_page_observation", parent: "watchlist" },
  { table: "website_site_scan", parent: "watchlist" },
  { table: "website_site_scan_page", parent: "website_site_scan" },
  { table: "source_snapshot", parent: "watchlist" },
  { table: "proof_target", parent: "watchlist" },
  { table: "proof_capture", parent: "proof_target" },
  { table: "digest_delivery", parent: "digest_run" },
  { table: "digest_item", parent: "digest_run" },
  { table: "ad_observation", parent: "watchlist_run" },
  { table: "collection_item", parent: "collection" },
  { table: "collection_item_tag", parent: "collection_item" },
  { table: "presence_poll_cursor", parent: "source_target" },
  { table: "presence_item_revision", parent: "presence_item" },
];

/** The membership table itself — becomes role-bearing (P2) and multi (P6). */
export const MEMBERSHIP_TABLES = ["workspace_member"] as const;

/** The ownership unit introduced by migration 0089 (adopted, epic #2993). */
export const OWNERSHIP_UNIT_TABLES = ["org"] as const;

/**
 * Platform/infra tables that stay user-keyed or ownerless by design. Every
 * entry carries a one-line reason; a vague reason is a rejected review.
 */
export const PLATFORM_TABLES: ReadonlyArray<{ table: string; reason: string }> = [
  { table: "user", reason: "auth identity" },
  { table: "session", reason: "auth identity" },
  { table: "account", reason: "auth identity (OAuth links)" },
  { table: "passkey", reason: "auth identity" },
  { table: "verification", reason: "auth identity" },
  { table: "better_auth_magic_link_ticket", reason: "auth identity" },
  { table: "user_plan", reason: "per-user billing subscription; seat pricing is Nish-reserved" },
  { table: "dodo_webhook_event", reason: "billing provider event log" },
  { table: "presence_pilot_workspace", reason: "internal allowlist keyed by hashed workspace ids" },
  { table: "presence_oauth_transaction", reason: "per-user OAuth handshake state" },
  { table: "pricing_region_preference", reason: "personal UI preference" },
  { table: "signup_source_pending", reason: "marketing attribution" },
  { table: "rate_limit_events", reason: "infra rate-limit log" },
  {
    table: "email_suppression",
    reason:
      "platform deliverability ledger keyed by recipient address only, not by owner (issue #2983); no user or workspace column, so an address suppressed once is suppressed for every sender",
  },
  { table: "e2e_test_mode", reason: "infra test sentinel" },
  { table: "retention_sweep_state", reason: "ops sweep state" },
  { table: "monitoring_concurrency_slot", reason: "infra concurrency lease" },
  { table: "cron_failure_alert_throttle", reason: "ops alert throttle state" },
  { table: "cron_failure_alert_accepted_window", reason: "ops alert dedupe state" },
  { table: "discovery_cache_entry", reason: "globally shared discovery cache (dedup is the point)" },
  { table: "discovery_fetch_log", reason: "shared provider fetch log" },
  { table: "discovery_provider_state", reason: "shared provider circuit state" },
  { table: "discovery_query_lease", reason: "shared query lease (dedup is the point)" },
  { table: "search_domain_identity_cache", reason: "shared domain identity cache" },
  { table: "ad", reason: "shared ad reference corpus (platform-fetched, not customer-owned)" },
  { table: "meta_integration_log", reason: "provider integration log" },
  { table: "browser_job_telemetry", reason: "infra job telemetry" },
  { table: "ads_domain_publisher_state", reason: "SEO ops state" },
  { table: "release_scheduled_observation", reason: "release ops state" },
  { table: "scheduled_observation_alert_state", reason: "ops alert state" },
  { table: "scheduled_observation_health_state", reason: "ops health state" },
  {
    table: "analysis_field",
    reason: "polymorphic scope_type/scope_id — follows its parent surface, never user-joined directly",
  },
  {
    table: "landing_page_snapshot",
    reason: "content-addressed shared capture cache keyed by canonical-url identity; access flows only through watchlist-scoped parents",
  },
  { table: "cta_pipeline_stage_counts", reason: "per-day pipeline telemetry aggregates (no customer rows)" },
  { table: "cta_pipeline_bail_reason_counts", reason: "per-day pipeline telemetry aggregates (no customer rows)" },
  { table: "demo_brand_proof_hole_state", reason: "demo-brand marketing infrastructure state, not customer data" },
  { table: "error_report", reason: "ops error-report sink (route/reason telemetry, no customer rows)" },
  { table: "status_probe_samples", reason: "status-probe telemetry samples (probe name, ok/latency, checked_at) — ops observability rows, no customer data" },
];

/** Shadow/backup table-name shapes that migrations must never leave behind. */
export const LEGACY_SHADOW_TABLE = /^(mig\d+_|.*_bk_\d+|.*_new|.*_next|.*_migration)$/;

/**
 * Known legacy shadow leftovers that predate the classification guard and are
 * tracked for cleanup — each entry names its cleanup issue. New shadow leaks
 * still fail the guard; this list may only shrink.
 */
export const LEGACY_SHADOW_ALLOWED: ReadonlyArray<{ table: string; cleanupIssue: number }> = [
  { table: "proof_usage_credit_migration", cleanupIssue: 3084 },
];

/** Tables created by the D1 migration tooling itself, never product data. */
export const D1_INTERNAL_TABLES = /^(d1_migrations|sqlite_\w+|_cf_\w+)$/;

/** Everything, flattened — what the classification test walks. */
export const OWNERSHIP_CLASSIFICATION: OwnershipClassification[] = [
  ...OWNED_PROBE_TABLES.map((table) => ({ kind: "owned-probe", table }) as OwnershipClassification),
  ...OWNED_PROBE_PENDING.map(
    (entry) => ({ kind: "owned-probe-pending", ...entry }) as OwnershipClassification,
  ),
  ...SCOPED_VIA_PARENT.map(
    (entry) => ({ kind: "scoped-via-parent", ...entry }) as OwnershipClassification,
  ),
  ...MEMBERSHIP_TABLES.map((table) => ({ kind: "membership", table }) as OwnershipClassification),
  ...OWNERSHIP_UNIT_TABLES.map(
    (table) => ({ kind: "ownership-unit", table }) as OwnershipClassification,
  ),
  ...PLATFORM_TABLES.map(
    (entry) => ({ kind: "platform", ...entry }) as OwnershipClassification,
  ),
];
