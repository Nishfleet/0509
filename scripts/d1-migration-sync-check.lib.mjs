import { createHash } from "node:crypto";

// Empty unless a future destructive cleanup must intentionally run after a
// schema-compatible Worker deploy. Completed cleanups should not remain here.
//
// 2026-08-26 AUDITOR FIX: 0077_competitor_site_monitoring.sql was added here
// as a "reconcile the production ledger fork" entry (PR #899), but it is NOT
// a destructive cleanup — the file still ships in migrations/ and is live in
// production. A non-cleanup entry in this set breaks the contiguous-suffix
// rule the moment a newer migration lands after it: with 0078 appended, the
// tail [0077, 0078] cannot be expressed as "cleanup only 0077", so
// allowedRemoteMigrationLedgers throws post_deploy_cleanup_migration_allowlist_invalid
// and every deploy after the 0078 merge blocks. The empty set restores the
// original design intent and matches the production ledger exactly (87 names
// ending 0077, sha 8703562f1d… proven by the 2026-08-26T16:57Z drill).
/** @type {Set<string>} */
export const POST_DEPLOY_CLEANUP_MIGRATIONS = new Set([]);

// Captured from the ordered production D1 migration ledger on 2026-07-30 by
// workflow run 30556997891. D1's ledger is append-only even when a historical
// migration file is intentionally retired from the repository.
export const PRODUCTION_MIGRATION_LEDGER_BASELINE = Object.freeze([
  "0000_auth.sql",
  "0001_app.sql",
  "0002_monitoring_trust.sql",
  "0003_creative_ocr.sql",
  "0005_onboarding.sql",
  "0006_plan.sql",
  "0007_proof_first_change_alerts.sql",
  "0008_commercial_ad_ingestion_replacement.sql",
  "0009_discovery_query_leases.sql",
  "0010_discovery_browserless_provider.sql",
  "0011_share_report_resource.sql",
  "0012_website_watch_targets.sql",
  "0010_rate_limit_events.sql",
  "0010_razorpay_billing.sql",
  "0011_customer_meta_connection.sql",
  "0012_rate_limit_events.sql",
  "0013_razorpay_webhook_events.sql",
  "0014_dodo_billing.sql",
  "0014_dodo_usage_bundles.sql",
  "0015_dodo_plan_access.sql",
  "0016_drop_region_pricing.sql",
  "0017_paid_work_queue.sql",
  "0018_dodo_webhook_events.sql",
  "0017_dodo_webhook_events.sql",
  "0017_share_link_report_resource.sql",
  "0018_customer_api_keys.sql",
  "0019_slack_delivery.sql",
  "0020_dodo_webhook_events.sql",
  "0021_share_link_expiry.sql",
  "0022_hot_path_indexes.sql",
  "0023_dodo_subscription_linkage.sql",
  "0024_watchlist_paused_reason.sql",
  "0025_watchlist_target_country.sql",
  "0026_workspace_branding.sql",
  "0027_workspace_members.sql",
  "0028_dodo_checkout_attempts.sql",
  "0029_dodo_checkout_attempt_user_fk.sql",
  "0028_tracking_roles_and_web_mentions.sql",
  "0030_artifact_lookup_indexes.sql",
  "0031_stytch_identity.sql",
  "0032_stytch_session.sql",
  "0033_stytch_auth_request_method.sql",
  "0034_passkeys.sql",
  "0035_agent_action_audit.sql",
  "0036_agent_memory.sql",
  "0037_client_rooms.sql",
  "0038_customer_api_key_actions.sql",
  "0039_support_cases.sql",
  "0040_agent_memory_client_room_index.sql",
  "0041_support_case_request_key.sql",
  "0042_better_auth_passkey.sql",
  "0043_workspace_brand_website.sql",
  "0044_better_auth_magic_link_tickets.sql",
  "0045_dodo_plan_lookup_indexes.sql",
  "0046_dodo_ledger_lease_and_capacity_skip_idempotency.sql",
  "0047_monitoring_fanout_orchestration.sql",
  "0048_monitoring_concurrency_slots.sql",
  "0049_evidence_usage_periods.sql",
  "0050_evidence_top_up_grants.sql",
  "0051_evidence_usage_reservations.sql",
  "0052_monitoring_queue_priority.sql",
  "0053_evidence_entitlement_anchor_and_ledger.sql",
  "0054_search_domain_identity_cache.sql",
  "0055_presence_tracking.sql",
  "0056_presence_oauth_transaction.sql",
  "0057_presence_pilot_workspace.sql",
  "0058_presence_sync_integrity.sql",
  "0059_presence_domain_verification.sql",
  "0060_remove_legacy_billing_provider.sql",
  "0061_support_case_events.sql",
  "0062_dodo_plan_change_pending_target.sql",
  "0063_watchlist_run_finished_at_index.sql",
  "0064_cron_failure_alert_throttle.sql",
  "0065_watchlist_active_partial_index.sql",
  "0066_workspace_brand_logo.sql",
  "0067_delivery_recovery_and_digest_jobs.sql",
  "0067_workspace_member_invariants.sql",
  "0068_evidence_reservation_ownership.sql",
  "0069_digest_cadence_preference.sql",
  "0070_release_scheduled_observations.sql",
]);

// The retire list: names the production ledger may still carry that the
// repository no longer ships. Baseline-resident entries document which
// recorded names left the repository; post-baseline entries explain ledger
// names inspectProductionMigrationLedger cannot otherwise derive.
export const RETIRED_PRODUCTION_MIGRATIONS = new Set([
  "0010_discovery_browserless_provider.sql",
  "0011_share_report_resource.sql",
  "0012_website_watch_targets.sql",
  "0010_rate_limit_events.sql",
  "0010_razorpay_billing.sql",
  "0013_razorpay_webhook_events.sql",
  "0014_dodo_billing.sql",
  "0017_paid_work_queue.sql",
  "0018_dodo_webhook_events.sql",
  "0017_dodo_webhook_events.sql",
  "0028_dodo_checkout_attempts.sql",
  "0029_dodo_checkout_attempt_user_fk.sql",
  "0031_stytch_identity.sql",
  "0032_stytch_session.sql",
  "0033_stytch_auth_request_method.sql",
  "0034_passkeys.sql",
]);

const MIGRATION_NAME_PATTERN = /^\d{4}_[A-Za-z0-9_]+\.sql$/u;
const MIGRATION_NAME_NUMBER_PREFIX = /^\d{4}_/u;

/** @param {string[]} names */
export function migrationLedgerNamesSha256(names) {
  if (
    !Array.isArray(names) ||
    names.length === 0 ||
    names.some((name) => !MIGRATION_NAME_PATTERN.test(name)) ||
    new Set(names).size !== names.length
  ) {
    throw new Error("migration_ledger_names_invalid");
  }
  return createHash("sha256")
    .update(JSON.stringify(names))
    .digest("hex");
}

export const PRODUCTION_MIGRATION_LEDGER_BASELINE_SHA256 =
  migrationLedgerNamesSha256([...PRODUCTION_MIGRATION_LEDGER_BASELINE]);

/**
 * A cleanup allowlist may remove only a contiguous migration suffix. Accept
 * both the pre-cleanup ledger and the fully applied ledger so the protected
 * deploy can land before destructive cleanup and closeout can follow safely.
 *
 * @param {string[]} repositoryMigrations
 * @param {Set<string>} cleanupMigrations
 * @returns {string[][]}
 */
export function allowedRemoteMigrationLedgers(
  repositoryMigrations,
  cleanupMigrations = POST_DEPLOY_CLEANUP_MIGRATIONS,
) {
  if (
    !Array.isArray(repositoryMigrations) ||
    repositoryMigrations.length === 0 ||
    repositoryMigrations.some(
      (name) => !/^\d{4}_[A-Za-z0-9_]+\.sql$/u.test(name),
    ) ||
    new Set(repositoryMigrations).size !== repositoryMigrations.length ||
    JSON.stringify([...repositoryMigrations].sort()) !==
      JSON.stringify(repositoryMigrations) ||
    !(cleanupMigrations instanceof Set)
  ) {
    throw new Error("migration_repository_ledger_invalid");
  }
  const cleanupNames = [...cleanupMigrations];
  if (cleanupNames.length === 0) return [[...repositoryMigrations]];
  const firstCleanupIndex = repositoryMigrations.findIndex((name) =>
    cleanupMigrations.has(name),
  );
  if (
    firstCleanupIndex < 1 ||
    cleanupNames.some((name) => !repositoryMigrations.includes(name)) ||
    repositoryMigrations
      .slice(firstCleanupIndex)
      .some((name) => !cleanupMigrations.has(name)) ||
    cleanupNames.length !== repositoryMigrations.length - firstCleanupIndex
  ) {
    throw new Error("post_deploy_cleanup_migration_allowlist_invalid");
  }
  return [
    [...repositoryMigrations],
    repositoryMigrations.slice(0, firstCleanupIndex),
  ];
}

/**
 * Decide whether a production migration ledger is explainable from the
 * repository and report the repository migrations still pending on it.
 *
 * D1's `d1_migrations` ledger is append-only and
 * `wrangler d1 migrations apply` appends pending migrations in repository
 * sort order, so the ORDER of names applied after the recorded baseline is
 * production-side apply history the repository cannot re-enumerate: a file
 * may land while it sorts anywhere in migrations/ and is still appended at
 * the tail. Enumerating allowed orders is what re-staled this check on
 * every added or renumbered migration (0509#3174/#3184/#3315, then
 * 0509#3512). The derived contract instead:
 *
 *   1. the ledger begins with `baseline` exactly — the recorded prefix is
 *      the single fixed-history anchor and already carries every retired
 *      name at its applied position, so no order-exception list is needed;
 *   2. every later name is explained by the repository alone: a repository
 *      migration, a declared retired migration, or a rename alias of
 *      exactly one repository file (same name body after the NNNN_ prefix);
 *   3. no name repeats.
 *
 * `pending` is every repository name absent from the ledger — the exact set
 * a forward apply appends, in repository order — and `blockingPending` is
 * that minus the post-deploy cleanup allowlist.
 *
 * @param {string[]} ledgerNames
 * @param {string[]} repositoryMigrations
 * @param {Set<string>} cleanupMigrations
 * @param {{ baseline?: readonly string[], retiredMigrations?: Set<string> }} options
 * @returns {{ ok: true, pending: string[], blockingPending: string[] } | { ok: false, reason: "invalid" | "baseline_prefix" | "unexplained", unexplained?: string[] }}
 */
export function inspectProductionMigrationLedger(
  ledgerNames,
  repositoryMigrations,
  cleanupMigrations = POST_DEPLOY_CLEANUP_MIGRATIONS,
  {
    baseline = PRODUCTION_MIGRATION_LEDGER_BASELINE,
    retiredMigrations = RETIRED_PRODUCTION_MIGRATIONS,
  } = {},
) {
  // Validation only — throws on a malformed repository list or cleanup
  // allowlist before any ledger is judged.
  allowedRemoteMigrationLedgers(repositoryMigrations, cleanupMigrations);
  migrationLedgerNamesSha256([...baseline]);
  if (
    !(retiredMigrations instanceof Set) ||
    [...retiredMigrations].some(
      (name) =>
        !MIGRATION_NAME_PATTERN.test(name) ||
        repositoryMigrations.includes(name),
    )
  ) {
    throw new Error("retired_production_migration_set_invalid");
  }
  if (
    !Array.isArray(ledgerNames) ||
    ledgerNames.length === 0 ||
    ledgerNames.some((name) => !MIGRATION_NAME_PATTERN.test(name)) ||
    new Set(ledgerNames).size !== ledgerNames.length
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (
    ledgerNames.length < baseline.length ||
    JSON.stringify(ledgerNames.slice(0, baseline.length)) !==
      JSON.stringify([...baseline])
  ) {
    return { ok: false, reason: "baseline_prefix" };
  }
  const repositorySet = new Set(repositoryMigrations);
  /** @type {Map<string, number>} */
  const nameBodyCounts = new Map();
  for (const name of repositoryMigrations) {
    const body = name.replace(MIGRATION_NAME_NUMBER_PREFIX, "");
    nameBodyCounts.set(body, (nameBodyCounts.get(body) ?? 0) + 1);
  }
  const unexplained = ledgerNames.slice(baseline.length).filter(
    (name) =>
      !repositorySet.has(name) &&
      !retiredMigrations.has(name) &&
      nameBodyCounts.get(name.replace(MIGRATION_NAME_NUMBER_PREFIX, "")) !== 1,
  );
  if (unexplained.length > 0) {
    return { ok: false, reason: "unexplained", unexplained };
  }
  const ledgerSet = new Set(ledgerNames);
  const pending = repositoryMigrations.filter(
    (name) => !ledgerSet.has(name),
  );
  return {
    ok: true,
    pending,
    blockingPending: pending.filter((name) => !cleanupMigrations.has(name)),
  };
}

/**
 * The rule object the restore-evidence drill and the deploy gate share
 * (0509#3512): the recorded baseline anchor, the live repository list, and
 * the declared retire/cleanup lists — everything
 * `inspectProductionMigrationLedger` needs to judge a recorded production
 * ledger. Both consumers build it through this one path so the derived set
 * can never drift between evidence generation and verification.
 *
 * @param {string[]} repositoryMigrations
 * @param {Set<string>} cleanupMigrations
 * @param {{ baseline?: readonly string[], retiredMigrations?: Set<string> }} options
 */
export function productionMigrationLedgerRule(
  repositoryMigrations,
  cleanupMigrations = POST_DEPLOY_CLEANUP_MIGRATIONS,
  {
    baseline = PRODUCTION_MIGRATION_LEDGER_BASELINE,
    retiredMigrations = RETIRED_PRODUCTION_MIGRATIONS,
  } = {},
) {
  allowedRemoteMigrationLedgers(repositoryMigrations, cleanupMigrations);
  const baselineSha256 = migrationLedgerNamesSha256([...baseline]);
  if (
    !(retiredMigrations instanceof Set) ||
    [...retiredMigrations].some(
      (name) =>
        !MIGRATION_NAME_PATTERN.test(name) ||
        repositoryMigrations.includes(name),
    )
  ) {
    throw new Error("retired_production_migration_set_invalid");
  }
  return Object.freeze({
    baselineSha256,
    baseline: Object.freeze([...baseline]),
    repositoryMigrations: Object.freeze([...repositoryMigrations]),
    retiredMigrations: Object.freeze([...retiredMigrations]),
    cleanupMigrations: Object.freeze([...cleanupMigrations]),
  });
}

/**
 * @param {string} output
 */
export function pendingMigrationNames(output) {
  return [...new Set(output.match(/\b\d{4}_[A-Za-z0-9_]+\.sql\b/g) ?? [])];
}

/**
 * @param {string} output
 */
export function blockingPendingMigrationNames(output) {
  return pendingMigrationNames(output).filter(
    (migrationName) => !POST_DEPLOY_CLEANUP_MIGRATIONS.has(migrationName),
  );
}

/**
 * @param {string} output
 */
export function hasOnlyPostDeployCleanupMigrations(output) {
  const pending = pendingMigrationNames(output);
  return pending.length > 0 && blockingPendingMigrationNames(output).length === 0;
}
