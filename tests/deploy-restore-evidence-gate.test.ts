import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// 0509#3314. On 2026-09-12 the deploy pipeline's "Generate D1 remote restore
// evidence" job failed run 34705843153 with `source_backup_migration_ledger_stale`:
// it compared the production backup's applied-migration ledger against the
// repo's migration filenames as SET EQUALITY. A real restored backup always
// carries historical, renamed and superseded names the current tree has
// dropped (the 16 below), and the repo carries names the backup never applied
// (the 1 below) — so the gate could never pass, and 100 merged PRs reached no
// user. The 2026-09-20 rebuild (#3679 design A) deleted the evidence-job class
// entirely: point-in-time restore is D1 Time Travel, the cold copy is the
// weekly `wrangler d1 export` to R2 in d1-backup-weekly.yml, and
// deploy-production.yml is verify → migrate → deploy → smoke → rollback.
// This file pins the fault out: any workflow step that reads an applied or
// backup migration ledger to diff it against the repo tree fails the build.
// If restore evidence ever returns, the order+hash+dated-allowlist contract
// from #3314 must be asserted here — update this file deliberately.

const workflowsDirectory = ".github/workflows";

// The comparison primitives the failed gate needed: a read of the applied or
// backup migration ledger (`d1 migrations list`, the internal `d1_migrations`
// table, a `migration ledger`/`list-migrations` phrasing, the sync-check token
// set) or the deleted script chain that performed it.
// `wrangler d1 migrations apply` is the deploy step, not a ledger read, and is
// deliberately not matched.
const LEDGER_COMPARISON =
  /d1\s+migrations\s+list\b|list[-\s]migrations|\bd1_migrations\b|migration[\s_-]?ledgers?|source_backup_migration|repository_migration_names|verify-remote-restore-evidence|d1-remote-restore-evidence|d1-migration-sync-check/i;

type Workflow = { jobs?: Record<string, unknown> };

// Scans each job's whole serialized surface — name, run, env, uses, with, and
// job-level fields — not just step name+run, so a composite action or an
// env-carried ledger read cannot slip the tripwire. YAML comments are dropped
// by `parse` before scanning, so prose can never false-positive.
function ledgerComparisonSteps(workflowText: string): string[] {
  const parsed = parse(workflowText) as Workflow;
  const offenders: string[] = [];
  for (const [jobId, job] of Object.entries(parsed.jobs ?? {})) {
    const match = `${jobId}\n${JSON.stringify(job)}`.match(LEDGER_COMPARISON);
    if (match) offenders.push(`${jobId} › …${match[0]}…`);
  }
  return offenders;
}

// The exact two lists printed by run 34705843153's failed step
// (`source_backup_migration_ledger_names` / `repository_migration_names`,
// 2026-09-12T16:41:59Z) — the fixture the issue's acceptance names.
const BACKUP_LEDGER_NAMES = [
  "0000_auth.sql", "0001_app.sql", "0002_monitoring_trust.sql",
  "0003_creative_ocr.sql", "0005_onboarding.sql", "0006_plan.sql",
  "0007_proof_first_change_alerts.sql", "0008_commercial_ad_ingestion_replacement.sql", "0009_discovery_query_leases.sql",
  "0010_discovery_browserless_provider.sql", "0011_share_report_resource.sql", "0012_website_watch_targets.sql",
  "0010_rate_limit_events.sql", "0010_razorpay_billing.sql", "0011_customer_meta_connection.sql",
  "0012_rate_limit_events.sql", "0013_razorpay_webhook_events.sql", "0014_dodo_billing.sql",
  "0014_dodo_usage_bundles.sql", "0015_dodo_plan_access.sql", "0016_drop_region_pricing.sql",
  "0017_paid_work_queue.sql", "0018_dodo_webhook_events.sql", "0017_dodo_webhook_events.sql",
  "0017_share_link_report_resource.sql", "0018_customer_api_keys.sql", "0019_slack_delivery.sql",
  "0020_dodo_webhook_events.sql", "0021_share_link_expiry.sql", "0022_hot_path_indexes.sql",
  "0023_dodo_subscription_linkage.sql", "0024_watchlist_paused_reason.sql", "0025_watchlist_target_country.sql",
  "0026_workspace_branding.sql", "0027_workspace_members.sql", "0028_dodo_checkout_attempts.sql",
  "0029_dodo_checkout_attempt_user_fk.sql", "0028_tracking_roles_and_web_mentions.sql", "0030_artifact_lookup_indexes.sql",
  "0031_stytch_identity.sql", "0032_stytch_session.sql", "0033_stytch_auth_request_method.sql",
  "0034_passkeys.sql", "0035_agent_action_audit.sql", "0036_agent_memory.sql",
  "0037_client_rooms.sql", "0038_customer_api_key_actions.sql", "0039_support_cases.sql",
  "0040_agent_memory_client_room_index.sql", "0041_support_case_request_key.sql", "0042_better_auth_passkey.sql",
  "0043_workspace_brand_website.sql", "0044_better_auth_magic_link_tickets.sql", "0045_dodo_plan_lookup_indexes.sql",
  "0046_dodo_ledger_lease_and_capacity_skip_idempotency.sql", "0047_monitoring_fanout_orchestration.sql", "0048_monitoring_concurrency_slots.sql",
  "0049_evidence_usage_periods.sql", "0050_evidence_top_up_grants.sql", "0051_evidence_usage_reservations.sql",
  "0052_monitoring_queue_priority.sql", "0053_evidence_entitlement_anchor_and_ledger.sql", "0054_search_domain_identity_cache.sql",
  "0055_presence_tracking.sql", "0056_presence_oauth_transaction.sql", "0057_presence_pilot_workspace.sql",
  "0058_presence_sync_integrity.sql", "0059_presence_domain_verification.sql", "0060_remove_legacy_billing_provider.sql",
  "0061_support_case_events.sql", "0062_dodo_plan_change_pending_target.sql", "0063_watchlist_run_finished_at_index.sql",
  "0064_cron_failure_alert_throttle.sql", "0065_watchlist_active_partial_index.sql", "0066_workspace_brand_logo.sql",
  "0067_delivery_recovery_and_digest_jobs.sql", "0067_workspace_member_invariants.sql", "0068_evidence_reservation_ownership.sql",
  "0069_digest_cadence_preference.sql", "0070_release_scheduled_observations.sql", "0071_release_observation_redispatch_failures.sql",
  "0072_scheduled_observation_health_state.sql", "0073_cron_failure_alert_attempt_evidence.sql", "0074_provider_neutral_discovery_failures.sql",
  "0075_teams_delivery.sql", "0076_browser_job_telemetry.sql", "0077_competitor_site_monitoring.sql",
  "0078_landing_page_snapshot_canonical_index.sql", "0079_backfill_demo_brand_offer_timelines.sql", "0080_signup_source.sql",
  "0081_backfill_sitemap_brand_offer_timelines.sql", "0082_website_page_kind_careers_legal.sql", "0083_cta_pipeline_stage_counts.sql",
  "0084_proof_capture_plan_diagnostics.sql", "0085_retention_sweep_state.sql", "0086_landing_page_price_tier.sql",
  "0087_cta_pipeline_bail_reason_counts.sql", "0087_signup_source_open_allowlist.sql", "0088_recreate_delivery_hot_path_indexes.sql",
  "0089_org_scoped_ownership.sql", "0090_competitor_source_fields.sql", "0090_event_type_free_text.sql",
  "0091_demo_brand_proof_hole_state.sql", "0092_ads_domain_publisher_state.sql", "0093_widen_source_target_connector_rss.sql",
  "0094_e2e_test_mode_sentinel.sql", "0095_landing_page_snapshot_content_key.sql", "0096_error_reports.sql",
  "0096_email_suppression.sql", "0097_status_probe_samples.sql", "0098_email_delivery_canary.sql",
  "0098_widen_source_target_connector_gdelt.sql",
];

const REPO_MIGRATION_NAMES = [
  "0000_auth.sql", "0001_app.sql", "0002_monitoring_trust.sql",
  "0003_creative_ocr.sql", "0005_onboarding.sql", "0006_plan.sql",
  "0007_proof_first_change_alerts.sql", "0008_commercial_ad_ingestion_replacement.sql", "0009_discovery_query_leases.sql",
  "0011_customer_meta_connection.sql", "0012_rate_limit_events.sql", "0014_dodo_usage_bundles.sql",
  "0015_dodo_plan_access.sql", "0016_drop_region_pricing.sql", "0017_share_link_report_resource.sql",
  "0018_customer_api_keys.sql", "0019_slack_delivery.sql", "0020_dodo_webhook_events.sql",
  "0021_share_link_expiry.sql", "0022_hot_path_indexes.sql", "0023_dodo_subscription_linkage.sql",
  "0024_watchlist_paused_reason.sql", "0025_watchlist_target_country.sql", "0026_workspace_branding.sql",
  "0027_workspace_members.sql", "0028_tracking_roles_and_web_mentions.sql", "0030_artifact_lookup_indexes.sql",
  "0035_agent_action_audit.sql", "0036_agent_memory.sql", "0037_client_rooms.sql",
  "0038_customer_api_key_actions.sql", "0039_support_cases.sql", "0040_agent_memory_client_room_index.sql",
  "0041_support_case_request_key.sql", "0042_better_auth_passkey.sql", "0043_workspace_brand_website.sql",
  "0044_better_auth_magic_link_tickets.sql", "0045_dodo_plan_lookup_indexes.sql", "0046_dodo_ledger_lease_and_capacity_skip_idempotency.sql",
  "0047_monitoring_fanout_orchestration.sql", "0048_monitoring_concurrency_slots.sql", "0049_evidence_usage_periods.sql",
  "0050_evidence_top_up_grants.sql", "0051_evidence_usage_reservations.sql", "0052_monitoring_queue_priority.sql",
  "0053_evidence_entitlement_anchor_and_ledger.sql", "0054_search_domain_identity_cache.sql", "0055_presence_tracking.sql",
  "0056_presence_oauth_transaction.sql", "0057_presence_pilot_workspace.sql", "0058_presence_sync_integrity.sql",
  "0059_presence_domain_verification.sql", "0060_remove_legacy_billing_provider.sql", "0061_support_case_events.sql",
  "0062_dodo_plan_change_pending_target.sql", "0063_watchlist_run_finished_at_index.sql", "0064_cron_failure_alert_throttle.sql",
  "0065_watchlist_active_partial_index.sql", "0066_workspace_brand_logo.sql", "0067_delivery_recovery_and_digest_jobs.sql",
  "0067_workspace_member_invariants.sql", "0068_evidence_reservation_ownership.sql", "0069_digest_cadence_preference.sql",
  "0070_release_scheduled_observations.sql", "0071_release_observation_redispatch_failures.sql", "0072_scheduled_observation_health_state.sql",
  "0073_cron_failure_alert_attempt_evidence.sql", "0074_provider_neutral_discovery_failures.sql", "0075_teams_delivery.sql",
  "0076_browser_job_telemetry.sql", "0077_competitor_site_monitoring.sql", "0078_landing_page_snapshot_canonical_index.sql",
  "0079_backfill_demo_brand_offer_timelines.sql", "0080_signup_source.sql", "0081_backfill_sitemap_brand_offer_timelines.sql",
  "0082_website_page_kind_careers_legal.sql", "0083_cta_pipeline_stage_counts.sql", "0084_proof_capture_plan_diagnostics.sql",
  "0085_retention_sweep_state.sql", "0086_landing_page_price_tier.sql", "0087_cta_pipeline_bail_reason_counts.sql",
  "0087_signup_source_open_allowlist.sql", "0088_recreate_delivery_hot_path_indexes.sql", "0089_org_scoped_ownership.sql",
  "0090_competitor_source_fields.sql", "0090_event_type_free_text.sql", "0091_demo_brand_proof_hole_state.sql",
  "0092_ads_domain_publisher_state.sql", "0093_widen_source_target_connector_rss.sql", "0094_e2e_test_mode_sentinel.sql",
  "0095_landing_page_snapshot_content_key.sql", "0096_email_suppression.sql", "0096_error_reports.sql",
  "0097_status_probe_samples.sql", "0098_email_delivery_canary.sql", "0098_widen_source_target_connector_bluesky.sql",
  "0098_widen_source_target_connector_gdelt.sql",
];

// Names a real production backup carries that the repo tree had already
// dropped or renamed at run 34705843153 — the legitimate asymmetry that made
// set equality unpassable.
const BACKUP_ONLY_NAMES = [
  "0010_discovery_browserless_provider.sql",
  "0010_rate_limit_events.sql",
  "0010_razorpay_billing.sql",
  "0011_share_report_resource.sql",
  "0012_website_watch_targets.sql",
  "0013_razorpay_webhook_events.sql",
  "0014_dodo_billing.sql",
  "0017_dodo_webhook_events.sql",
  "0017_paid_work_queue.sql",
  "0018_dodo_webhook_events.sql",
  "0028_dodo_checkout_attempts.sql",
  "0029_dodo_checkout_attempt_user_fk.sql",
  "0031_stytch_identity.sql",
  "0032_stytch_session.sql",
  "0033_stytch_auth_request_method.sql",
  "0034_passkeys.sql",
];

const REPO_ONLY_NAMES = ["0098_widen_source_target_connector_bluesky.sql"];

describe("deploy restore-evidence gate (0509#3314)", () => {
  it("the run-34705843153 ledgers differ only by historical names — set equality could never pass", () => {
    const backup = new Set(BACKUP_LEDGER_NAMES);
    const repo = new Set(REPO_MIGRATION_NAMES);
    expect(backup.size).toBe(112);
    expect(repo.size).toBe(97);
    expect(
      [...backup].filter((name) => !repo.has(name)).sort(),
    ).toEqual(BACKUP_ONLY_NAMES);
    expect(
      [...repo].filter((name) => !backup.has(name)).sort(),
    ).toEqual(REPO_ONLY_NAMES);
  });

  it("no workflow reads an applied or backup migration ledger to compare with the repo tree", () => {
    const files = readdirSync(workflowsDirectory).filter((name) =>
      /\.ya?ml$/.test(name),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(workflowsDirectory, file), "utf8");
      expect(ledgerComparisonSteps(text), file).toEqual([]);
    }
  });

  it("flags the fault shape that failed run 34705843153, however it is carried", () => {
    const viaRun = `
jobs:
  generate_restore_evidence:
    steps:
      - name: Generate D1 remote restore evidence
        run: node scripts/verify-remote-restore-evidence.mjs
      - run: npx wrangler d1 migrations list 0509 --remote --json
`;
    expect(ledgerComparisonSteps(viaRun)).toEqual([
      "generate_restore_evidence › …verify-remote-restore-evidence…",
    ]);
    const viaEnv = `
jobs:
  evidence:
    env:
      APPLIED: d1_migrations
    steps:
      - run: node reproduce.mjs
`;
    expect(ledgerComparisonSteps(viaEnv)).toEqual(["evidence › …d1_migrations…"]);
  });

  it("does not flag the legitimate apply step — `migrations apply` is not a ledger read", () => {
    const deploy = readFileSync(
      join(workflowsDirectory, "deploy-production.yml"),
      "utf8",
    );
    expect(deploy).toContain("wrangler d1 migrations apply 0509 --remote");
    expect(ledgerComparisonSteps(deploy)).toEqual([]);
  });

  it("keeps the replacement restore posture whole: deploy applies migrations, weekly export ships to R2", () => {
    const deploy = readFileSync(
      join(workflowsDirectory, "deploy-production.yml"),
      "utf8",
    );
    expect(deploy).toContain("wrangler d1 migrations apply 0509 --remote");
    const backup = readFileSync(
      join(workflowsDirectory, "d1-backup-weekly.yml"),
      "utf8",
    );
    expect(backup).toContain("wrangler d1 export");
    expect(backup).toContain("r2 object put");
  });
});
