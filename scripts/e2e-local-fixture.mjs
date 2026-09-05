// @ts-nocheck Fixture invariants are exercised against isolated D1 state.

import path from "node:path";

export const DEFAULT_E2E_PERSIST_PATH = ".wrangler/e2e-state";
const LOCAL_RELEASE_SERVER_ID_PATTERN = /^local-[a-f0-9]{32}$/u;

export const E2E_FIXTURE_EXPECTATIONS = Object.freeze({
  activeMemberships: 1,
  billingReplayBaselines: 12,
  monitoringRecoveryPairs: 1,
  // 23 baseline personas + 1 expired paid persona (e2e-expired) + 2 WP-C2
  // first-run personas (e2e-free-firstbrief, e2e-free-firstscan).
  personas: 26,
  supportRecoveryCases: 1,
});

export function postflightFixtureExpectations(journeyScope) {
  if (
    !Array.isArray(journeyScope) ||
    journeyScope.some((journey) => !Number.isInteger(journey) || journey < 1 || journey > 6)
  ) {
    throw new Error("invalid_release_journey_scope");
  }
  return {
    ...E2E_FIXTURE_EXPECTATIONS,
    // Journey 5 intentionally moves three activation personas onto Starter
    // and three cancellation/refund pairs into their terminal states. The
    // final entitlement query verifies those mutations; only the three
    // viewport-isolated payment-recovery personas retain their seed shape.
    billingReplayBaselines: journeyScope.includes(5)
      ? 3
      : E2E_FIXTURE_EXPECTATIONS.billingReplayBaselines,
  };
}

function boundedDuration(value, { fallback, minimum, maximum, error }) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(error);
  }
  return parsed;
}

export function resolveE2ePostflightTimeout(value) {
  return boundedDuration(value, {
    fallback: 15_000,
    minimum: 1_000,
    maximum: 60_000,
    error: "invalid_e2e_postflight_timeout",
  });
}

export function resolveE2ePostflightQueryTimeout(value) {
  return boundedDuration(value, {
    fallback: 10_000,
    minimum: 1_000,
    maximum: 30_000,
    error: "invalid_e2e_postflight_query_timeout",
  });
}

export function remainingE2ePostflightQueryTimeout(deadline, maximum, now = Date.now()) {
  if (
    !Number.isFinite(deadline) ||
    !Number.isFinite(now) ||
    !Number.isInteger(maximum) ||
    maximum < 1
  ) {
    throw new Error("invalid_e2e_postflight_deadline");
  }
  const remaining = Math.floor(deadline - now);
  if (remaining < 1) {
    throw new Error("e2e_postflight_deadline_exceeded");
  }
  return Math.min(maximum, remaining);
}

export function resolveE2ePersistPath(root, configuredPath = DEFAULT_E2E_PERSIST_PATH) {
  if (typeof configuredPath !== "string" || configuredPath.trim() !== configuredPath || configuredPath.length === 0) {
    throw new Error("invalid_e2e_persist_path");
  }

  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, configuredPath);
  const relativePath = path.relative(absoluteRoot, absolutePath);
  const normalized = relativePath.split(path.sep).join("/");
  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath) ||
    !normalized.startsWith(".wrangler/e2e-")
  ) {
    throw new Error("unsafe_e2e_persist_path");
  }
  return { absolutePath, relativePath: normalized };
}

export function isolatedReleasePersistPath(serverIdentity) {
  if (typeof serverIdentity !== "string" || !LOCAL_RELEASE_SERVER_ID_PATTERN.test(serverIdentity)) {
    throw new Error("invalid_local_release_server_identity");
  }
  return `.wrangler/e2e-release-${serverIdentity.slice("local-".length)}`;
}

export function fixtureInvariantQuery() {
  return `
SELECT
  (SELECT COUNT(*) FROM user WHERE id LIKE 'e2e-%') AS persona_count,
  (SELECT COUNT(*) FROM workspace_member WHERE id LIKE 'e2e-%' AND status = 'active') AS active_membership_count,
  (SELECT COUNT(*) FROM user_plan
    WHERE user_id LIKE 'e2e-%'
      AND plan <> 'free'
      AND dodo_status IN ('subscription.active', 'subscription.renewed', 'payment.failed', 'subscription.on_hold', 'cancellation_scheduled')
      AND (dodo_payment_id IS NULL OR dodo_product_id IS NULL OR dodo_subscription_id IS NULL OR dodo_customer_id IS NULL)
  ) AS unlinked_paid_persona_count,
  (SELECT COUNT(*) FROM evidence_top_up_grant
    WHERE workspace_user_id LIKE 'e2e-%' AND sku_slug <> 'burst_500_v1'
  ) AS obsolete_sku_count,
  (SELECT COUNT(*) FROM watch_event event
    JOIN watchlist event_watchlist ON event_watchlist.id = event.watchlist_id
    JOIN proof_capture capture ON capture.id = event.proof_capture_id
    JOIN proof_target target ON target.id = capture.proof_target_id
    JOIN watchlist proof_watchlist ON proof_watchlist.id = target.watchlist_id
    WHERE event.id LIKE 'e2e-%' AND event_watchlist.user_id <> proof_watchlist.user_id
  ) AS cross_workspace_proof_count,
  (SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreign_key_violation_count,
  (SELECT COUNT(*) FROM user_plan
    WHERE (user_id IN ('e2e-activation', 'e2e-activation-tablet', 'e2e-activation-desktop', 'e2e-cancelled', 'e2e-cancelled-tablet', 'e2e-cancelled-desktop', 'e2e-refunded', 'e2e-refunded-tablet', 'e2e-refunded-desktop')
        AND plan = 'free' AND dodo_status IS NULL AND dodo_payment_id IS NULL
        AND dodo_product_id IS NULL AND dodo_subscription_id IS NULL AND dodo_customer_id IS NULL)
       OR (user_id IN ('e2e-payment-issue', 'e2e-payment-issue-tablet', 'e2e-payment-issue-desktop')
        AND plan = 'starter' AND dodo_status = 'active'
        AND dodo_payment_id = 'e2e-j5-pay-' || substr(user_id, length('e2e-') + 1)
        AND dodo_product_id = 'e2e-j5-product-starter-monthly'
        AND dodo_subscription_id = 'e2e-j5-sub-' || user_id
        AND dodo_customer_id = 'e2e-j5-cus-' || user_id)
  ) AS billing_replay_baseline_count,
  (SELECT COUNT(*) FROM watchlist recovery_watchlist
    WHERE recovery_watchlist.id = 'e2e-watchlist-starter-1'
      AND EXISTS (SELECT 1 FROM watchlist_run failed WHERE failed.watchlist_id = recovery_watchlist.id AND failed.status = 'failed')
      AND EXISTS (SELECT 1 FROM watchlist_run succeeded WHERE succeeded.watchlist_id = recovery_watchlist.id AND succeeded.status = 'succeeded')
  ) AS monitoring_recovery_pair_count,
  (SELECT COUNT(*) FROM support_case recovery_case
    WHERE recovery_case.id = 'e2e-support-recovery-case'
      AND EXISTS (SELECT 1 FROM support_case_event failed WHERE failed.case_id = recovery_case.id AND failed.event_type = 'support_notification_failed')
      AND EXISTS (SELECT 1 FROM support_case_event recovered WHERE recovered.case_id = recovery_case.id AND recovered.event_type = 'support_notified')
  ) AS support_recovery_case_count,
  (SELECT COUNT(*) FROM discovery_cache_entry WHERE cache_key LIKE 'search-v2:domain:no-cache.example:%') AS unexpected_no_cache_count;
`.trim();
}

export function parseWranglerQueryOutput(output) {
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new Error("invalid_fixture_invariant_output");
  }
  const results = Array.isArray(payload) ? payload.flatMap((entry) => entry?.results ?? []) : [];
  if (results.length !== 1 || !results[0] || typeof results[0] !== "object") {
    throw new Error("missing_fixture_invariant_row");
  }
  return results[0];
}

export function assertFixtureInvariants(row, expectations = E2E_FIXTURE_EXPECTATIONS) {
  const exact = {
    active_membership_count: expectations.activeMemberships,
    billing_replay_baseline_count: expectations.billingReplayBaselines,
    monitoring_recovery_pair_count: expectations.monitoringRecoveryPairs,
    persona_count: expectations.personas,
    support_recovery_case_count: expectations.supportRecoveryCases,
  };
  const zero = [
    "cross_workspace_proof_count",
    "foreign_key_violation_count",
    "obsolete_sku_count",
    "unexpected_no_cache_count",
    "unlinked_paid_persona_count",
  ];
  const failures = [];
  for (const [key, expected] of Object.entries(exact)) {
    if (Number(row[key]) !== expected) failures.push(`${key}:${String(row[key])}`);
  }
  for (const key of zero) {
    if (Number(row[key]) !== 0) failures.push(`${key}:${String(row[key])}`);
  }
  if (failures.length > 0) {
    throw new Error(`e2e_fixture_invariant_failed:${failures.join(",")}`);
  }
  return true;
}

function exactIsoTimestamp(value) {
  if (typeof value !== "string" || value.length > 32) throw new Error("invalid_release_started_at");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("invalid_release_started_at");
  }
  return value;
}

function journey5ExpectedEventCtes() {
  return `
  expected_j5_viewport(viewport) AS (
    VALUES ('375x812'), ('768x900'), ('1440x900')
  ),
  expected_j5_event_shape(event_index, event_type, outcome) AS (
    VALUES
      (0, 'payment.succeeded', 'processed'),
      (2, 'payment.failed', 'processed'),
      (3, 'subscription.renewed', 'processed'),
      (4, 'subscription.plan_changed', 'processed'),
      (5, 'subscription.plan_changed', 'ignored'),
      (6, 'subscription.plan_changed', 'ignored'),
      (7, 'subscription.plan_changed', 'processed'),
      (8, 'subscription.plan_changed', 'processed'),
      (9, 'subscription.plan_changed', 'processed'),
      (10, 'payment.succeeded', 'processed'),
      (11, 'subscription.cancelled', 'processed'),
      (12, 'subscription.expired', 'processed'),
      (13, 'payment.succeeded', 'processed'),
      (14, 'refund.succeeded', 'processed'),
      (15, 'refund.failed', 'ignored'),
      (16, 'refund.succeeded', 'processed')
  ),
  expected_j5_event(event_id, event_type, outcome) AS (
    SELECT
      'e2e-j5-event:' || viewport || ':' || event_index,
      event_type,
      outcome
    FROM expected_j5_viewport
    CROSS JOIN expected_j5_event_shape
  )`;
}

function journey5EventCountExpression() {
  return `(SELECT COUNT(*) FROM dodo_webhook_event
    WHERE event_id LIKE 'e2e-j5-event:%')`;
}

function journey5EventMismatchExpression() {
  return `CASE
    WHEN ${journey5EventCountExpression()} = 0 THEN 0
    ELSE
      (SELECT COUNT(*)
       FROM expected_j5_event expected
       LEFT JOIN dodo_webhook_event actual
         ON actual.event_id = expected.event_id
        AND actual.event_type = expected.event_type
        AND actual.outcome = expected.outcome
       WHERE actual.event_id IS NULL)
      +
      (SELECT COUNT(*)
       FROM dodo_webhook_event actual
       LEFT JOIN expected_j5_event expected
         ON expected.event_id = actual.event_id
        AND expected.event_type = actual.event_type
        AND expected.outcome = actual.outcome
       WHERE actual.event_id LIKE 'e2e-j5-event:%'
         AND expected.event_id IS NULL)
  END`;
}

export function journey5EventInvariantQuery() {
  return `
WITH
${journey5ExpectedEventCtes()}
SELECT
  ${journey5EventCountExpression()} AS j5_event_count,
  ${journey5EventMismatchExpression()} AS j5_event_mismatch_count;
`;
}

export function fixtureReleaseStateQuery(releaseStartedAt) {
  const startedAt = exactIsoTimestamp(releaseStartedAt);
  return `
WITH
${journey5ExpectedEventCtes()},
  expected_users(user_id) AS (
    VALUES ('e2e-activation'), ('e2e-activation-tablet'), ('e2e-activation-desktop')
  ),
  activation_watchlists AS (
    SELECT watchlist.*
    FROM watchlist
    WHERE watchlist.user_id IN (SELECT user_id FROM expected_users)
      AND watchlist.created_at >= '${startedAt}'
  ),
  activation_runs AS (
    SELECT watchlist_run.*
    FROM watchlist_run
    JOIN activation_watchlists ON activation_watchlists.id = watchlist_run.watchlist_id
    WHERE watchlist_run.created_at >= '${startedAt}'
  ),
  expected_j4_replay(idempotency_key, action, run_id) AS (
    VALUES
      ('e2e-j4-report-share-375x812', 'report_share', 'e2e-run-j4-report-share-375x812'),
      ('e2e-j4-report-share-768x900', 'report_share', 'e2e-run-j4-report-share-768x900'),
      ('e2e-j4-report-share-1440x900', 'report_share', 'e2e-run-j4-report-share-1440x900'),
      ('e2e-j4-client-room-375x812', 'client_room', 'e2e-run-j4-client-room-375x812'),
      ('e2e-j4-client-room-768x900', 'client_room', 'e2e-run-j4-client-room-768x900'),
      ('e2e-j4-client-room-1440x900', 'client_room', 'e2e-run-j4-client-room-1440x900'),
      ('e2e-j4-batch-failure-375x812', 'batch_failure', 'e2e-run-j4-batch-failure-375x812'),
      ('e2e-j4-batch-failure-768x900', 'batch_failure', 'e2e-run-j4-batch-failure-768x900'),
      ('e2e-j4-batch-failure-1440x900', 'batch_failure', 'e2e-run-j4-batch-failure-1440x900'),
      ('e2e-j4-approval-stale-375x812', 'approval_stale', 'e2e-run-j4-approval-stale-375x812'),
      ('e2e-j4-approval-stale-768x900', 'approval_stale', 'e2e-run-j4-approval-stale-768x900'),
      ('e2e-j4-approval-stale-1440x900', 'approval_stale', 'e2e-run-j4-approval-stale-1440x900')
  ),
  expected_j4_audit(idempotency_key, action_name, status, resource_type, resource_id, error_code, run_id) AS (
    VALUES
      ('e2e-j4-report-share-375x812-agent', 'report.share', 'succeeded', 'report', 'watchlist:e2e-watchlist-agency-1', NULL, 'e2e-run-j4-report-share-375x812'),
      ('e2e-j4-report-share-768x900-agent', 'report.share', 'succeeded', 'report', 'watchlist:e2e-watchlist-agency-1', NULL, 'e2e-run-j4-report-share-768x900'),
      ('e2e-j4-report-share-1440x900-agent', 'report.share', 'succeeded', 'report', 'watchlist:e2e-watchlist-agency-1', NULL, 'e2e-run-j4-report-share-1440x900'),
      ('e2e-j4-client-room-375x812-agent', 'client_room.upsert', 'succeeded', 'client_room', NULL, NULL, 'e2e-run-j4-client-room-375x812'),
      ('e2e-j4-client-room-768x900-agent', 'client_room.upsert', 'succeeded', 'client_room', NULL, NULL, 'e2e-run-j4-client-room-768x900'),
      ('e2e-j4-client-room-1440x900-agent', 'client_room.upsert', 'succeeded', 'client_room', NULL, NULL, 'e2e-run-j4-client-room-1440x900'),
      ('e2e-j4-batch-failure-375x812-agent', 'share.create', 'failed', NULL, NULL, 'atomic_batch_failed', 'e2e-run-j4-batch-failure-375x812'),
      ('e2e-j4-batch-failure-768x900-agent', 'share.create', 'failed', NULL, NULL, 'atomic_batch_failed', 'e2e-run-j4-batch-failure-768x900'),
      ('e2e-j4-batch-failure-1440x900-agent', 'share.create', 'failed', NULL, NULL, 'atomic_batch_failed', 'e2e-run-j4-batch-failure-1440x900')
  ),
  j4_run_shares AS (
    SELECT share.*
    FROM share_link share
    WHERE share.user_id = 'e2e-agency'
      AND share.resource_type = 'report'
      AND share.resource_id = 'watchlist:e2e-watchlist-agency-1'
      AND share.created_at >= '${startedAt}'
  ),
  j4_run_rooms AS (
    SELECT room.*, expected.run_id
    FROM expected_j4_audit expected
    JOIN agent_action_audit audit
      ON audit.user_id = 'e2e-agency'
     AND audit.api_key_id = 'e2e-api-key-agency'
     AND audit.idempotency_key = expected.idempotency_key
     AND audit.action_name = 'client_room.upsert'
    JOIN client_room room ON room.id = audit.resource_id
  )
SELECT
  (SELECT COUNT(*) FROM activation_watchlists) AS activation_watchlist_count,
  (SELECT COUNT(*) FROM expected_users expected
    WHERE (SELECT COUNT(*) FROM activation_watchlists watchlist WHERE watchlist.user_id = expected.user_id) <> 1
  ) AS activation_owner_mismatch_count,
  (SELECT COUNT(*) - COUNT(DISTINCT user_id) FROM activation_watchlists) AS activation_duplicate_count,
  (SELECT COUNT(*) FROM activation_watchlists
    WHERE is_active <> 1
      OR target_type <> 'advertiser'
      OR tracking_role <> 'competitor'
      OR target_id <> 'https://nykaa.com'
      OR target_label <> 'Nykaa'
      OR name <> 'Nykaa watch'
      OR length(target_fingerprint) <> 14
      OR substr(target_fingerprint, 1, 6) <> 'fnv1a-'
      OR substr(target_fingerprint, 7) GLOB '*[^0-9a-f]*'
  ) AS activation_target_mismatch_count,
  (SELECT COUNT(*) FROM activation_runs) AS activation_run_count,
  (SELECT COUNT(*) - COUNT(DISTINCT watchlist_id) FROM activation_runs) AS activation_duplicate_run_count,
  (SELECT COUNT(*) FROM activation_runs WHERE status IN ('pending', 'running')) AS activation_nonterminal_run_count,
  (SELECT COUNT(*) FROM activation_runs
    WHERE status <> 'skipped'
      OR trigger_type <> 'manual'
      OR error_code <> 'e2e_provider_network_denied'
      OR idempotency_key <> 'watchlist-run:first-scan:' || watchlist_id
      OR workflow_instance_id IS NULL
      OR workflow_instance_id NOT GLOB 'monitor-v1-*'
      OR processing_token IS NOT NULL
      OR processing_started_at IS NOT NULL
      OR retry_after IS NOT NULL
  ) AS activation_terminal_mismatch_count,
  (SELECT COUNT(*)
    FROM watchlist_run run
    JOIN watchlist ON watchlist.id = run.watchlist_id
    WHERE watchlist.user_id IN (SELECT user_id FROM expected_users)
      AND run.created_at >= '${startedAt}'
      AND run.watchlist_id NOT IN (SELECT id FROM activation_watchlists)
  ) AS activation_orphan_run_count,
  (SELECT COUNT(*) FROM discovery_fetch_log
    WHERE route_context IN ('watchlist_scan', 'public_search')
      AND provider IN ('meta_api', 'meta_library_browser')
      AND created_at >= '${startedAt}'
  ) AS non_demo_fetch_count,
  (SELECT COUNT(*) FROM discovery_cache_entry
    WHERE route_context IN ('watchlist_scan', 'public_search')
      AND provider IN ('meta_api', 'meta_library_browser')
      AND (created_at >= '${startedAt}' OR updated_at >= '${startedAt}')
  ) AS non_demo_cache_count,
  (SELECT COUNT(*) FROM discovery_provider_state
    WHERE provider IN ('meta_api', 'meta_library_browser')
      AND updated_at >= '${startedAt}'
  ) AS non_demo_provider_state_count,
  (SELECT COUNT(*) FROM ad_observation observation
    WHERE observation.watchlist_run_id IN (SELECT id FROM activation_runs)
      AND observation.created_at >= '${startedAt}'
  ) AS watchlist_ad_observation_count,
  (SELECT COUNT(*) FROM watch_event event
    WHERE event.watchlist_id IN (SELECT id FROM activation_watchlists)
      AND event.created_at >= '${startedAt}'
  ) AS watchlist_event_count,
  (SELECT COUNT(*) FROM event_candidate candidate
    WHERE candidate.watchlist_id IN (SELECT id FROM activation_watchlists)
      AND candidate.created_at >= '${startedAt}'
  ) AS watchlist_candidate_count,
  (SELECT COUNT(*) FROM proof_target target
    WHERE target.watchlist_id IN (SELECT id FROM activation_watchlists)
      AND target.created_at >= '${startedAt}'
  ) AS watchlist_proof_target_count,
  (SELECT COUNT(*) FROM proof_capture capture
    JOIN proof_target target ON target.id = capture.proof_target_id
    WHERE target.watchlist_id IN (SELECT id FROM activation_watchlists)
      AND capture.created_at >= '${startedAt}'
  ) AS watchlist_proof_capture_count,
  (SELECT COUNT(DISTINCT observation.ad_id) FROM ad_observation observation
    WHERE observation.watchlist_run_id IN (SELECT id FROM activation_runs)
      AND observation.created_at >= '${startedAt}'
  ) AS watchlist_ad_count,
  (SELECT COUNT(DISTINCT observation.landing_page_snapshot_id) FROM ad_observation observation
    WHERE observation.watchlist_run_id IN (SELECT id FROM activation_runs)
      AND observation.landing_page_snapshot_id IS NOT NULL
      AND observation.created_at >= '${startedAt}'
  ) AS watchlist_landing_snapshot_count,
  (SELECT COUNT(*) FROM e2e_j3_replay
    WHERE idempotency_key GLOB 'e2e-j3-*-monitoring-???x???'
       OR idempotency_key GLOB 'e2e-j3-*-digest-???x???'
       OR idempotency_key GLOB 'e2e-j3-*-monitoring-????x???'
       OR idempotency_key GLOB 'e2e-j3-*-digest-????x???'
  ) AS j3_replay_count,
  (SELECT COUNT(*) FROM e2e_j3_replay
    WHERE (idempotency_key GLOB 'e2e-j3-*-monitoring-???x???'
        OR idempotency_key GLOB 'e2e-j3-*-digest-???x???'
        OR idempotency_key GLOB 'e2e-j3-*-monitoring-????x???'
        OR idempotency_key GLOB 'e2e-j3-*-digest-????x???')
      AND (status <> 'succeeded' OR result_json IS NULL)
  ) AS j3_replay_incomplete_count,
  (SELECT COUNT(*) FROM watchlist_run
    WHERE watchlist_id IN ('e2e-watchlist-j3-workflow', 'e2e-watchlist-j3-crash')
      AND idempotency_key LIKE 'watchlist-run:first-scan:%'
  ) AS j3_run_count,
  (SELECT COUNT(*) FROM evidence_usage_reservation
    WHERE logical_operation_key IN ('e2e-j3-crash-reservation', 'e2e-j3-reconcile-reservation') -- gitleaks:allow
  ) AS j3_reservation_count,
  (SELECT COUNT(*) FROM delivery_attempt
    WHERE digest_run_id = 'e2e-digest-j3-provider-denied'
       OR idempotency_key = 'e2e-j3-unsubscribe-attempt' -- gitleaks:allow
  ) AS j3_delivery_attempt_count,
  (SELECT COUNT(*) FROM delivery_target
    WHERE user_id = 'e2e-free' AND opt_in_source = 'e2e_j3_replay'
  ) AS j3_delivery_target_count,
  (SELECT COUNT(*) FROM digest_delivery
    WHERE digest_run_id = 'e2e-digest-j3-provider-denied'
  ) AS j3_digest_delivery_count,
  (SELECT COUNT(*) FROM e2e_j4_replay) AS j4_replay_count,
  ((SELECT COUNT(*)
      FROM e2e_j4_replay replay
      JOIN expected_j4_replay expected ON expected.idempotency_key = replay.idempotency_key
      WHERE replay.action <> expected.action
         OR replay.user_id <> 'e2e-agency'
         OR replay.run_id <> expected.run_id
         OR replay.status <> 'succeeded'
         OR replay.result_json IS NULL
         OR length(replay.result_json) > 8192
         OR json_valid(replay.result_json) <> 1)
    + (SELECT COUNT(*) FROM e2e_j4_replay replay
       WHERE replay.idempotency_key NOT IN (SELECT idempotency_key FROM expected_j4_replay))
  ) AS j4_replay_mismatch_count,
  (SELECT COUNT(*) FROM agent_action_audit audit
    WHERE audit.user_id = 'e2e-agency'
      AND audit.api_key_id = 'e2e-api-key-agency'
      AND audit.idempotency_key IN (SELECT idempotency_key FROM expected_j4_audit)
  ) AS j4_audit_count,
  (SELECT COUNT(*)
    FROM expected_j4_audit expected
    LEFT JOIN agent_action_audit audit
      ON audit.user_id = 'e2e-agency'
     AND audit.api_key_id = 'e2e-api-key-agency'
     AND audit.idempotency_key = expected.idempotency_key
     AND audit.action_name = expected.action_name
    WHERE EXISTS (SELECT 1 FROM e2e_j4_replay)
      AND (audit.id IS NULL
       OR audit.status <> expected.status
       OR audit.resource_type IS NOT expected.resource_type
       OR (expected.action_name <> 'client_room.upsert'
           AND audit.resource_id IS NOT expected.resource_id)
       OR (expected.action_name = 'client_room.upsert' AND (
            audit.resource_id IS NULL
         OR audit.resource_id IS NOT json_extract(audit.result_json, '$.room.id')))
       OR audit.error_code IS NOT expected.error_code
       OR (expected.status = 'succeeded' AND (
            audit.result_json IS NULL
         OR json_valid(audit.result_json) <> 1
         OR COALESCE(json_extract(audit.metadata_json, '$.source'), '') IS NOT 'api_v1'
         OR COALESCE(json_extract(audit.metadata_json, '$.requestFingerprint'), '') NOT GLOB 'fnv1a:????????'))
       OR (expected.status = 'failed' AND (
            audit.result_json IS NOT NULL
         OR COALESCE(json_extract(audit.metadata_json, '$.source'), '') IS NOT 'e2e'
         OR COALESCE(json_extract(audit.metadata_json, '$.e2eRunId'), '') IS NOT expected.run_id
         OR COALESCE(json_extract(audit.metadata_json, '$.requestFingerprint'), '') IS NOT
              'e2e-j4-batch-failure:' || substr(expected.idempotency_key, 1, length(expected.idempotency_key) - length('-agent')))))
  ) AS j4_audit_mismatch_count,
  (SELECT COUNT(*)
    FROM expected_j4_audit expected
    JOIN agent_action_audit audit
      ON audit.user_id = 'e2e-agency'
     AND audit.api_key_id = 'e2e-api-key-agency'
     AND audit.idempotency_key = expected.idempotency_key
     AND audit.action_name = 'report.share'
    JOIN share_link share ON share.id = json_extract(audit.result_json, '$.share.id')
  ) AS j4_agent_share_count,
  (SELECT COUNT(*)
    FROM expected_j4_audit expected
    JOIN agent_action_audit audit
      ON audit.user_id = 'e2e-agency'
     AND audit.api_key_id = 'e2e-api-key-agency'
     AND audit.idempotency_key = expected.idempotency_key
     AND audit.action_name = 'report.share'
    LEFT JOIN share_link share ON share.id = json_extract(audit.result_json, '$.share.id')
    WHERE share.id IS NULL
       OR share.user_id <> 'e2e-agency'
       OR share.resource_type <> 'report'
       OR share.resource_id <> 'watchlist:e2e-watchlist-agency-1'
       OR share.is_snapshot <> 1
       OR share.snapshot_payload_json IS NULL
       OR json_valid(share.snapshot_payload_json) <> 1
       OR share.revoked_at IS NOT NULL
       OR (share.expires_at IS NOT NULL AND share.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) AS j4_agent_share_mismatch_count,
  (SELECT COUNT(*) FROM j4_run_shares share
    WHERE json_extract(share.snapshot_payload_json, '$.sharePurpose') = 'pdf-render'
  ) AS j4_pdf_share_count,
  (SELECT COUNT(*) FROM j4_run_shares share
    WHERE share.id NOT IN (
      SELECT json_extract(audit.result_json, '$.share.id')
      FROM agent_action_audit audit
      WHERE audit.user_id = 'e2e-agency'
        AND audit.api_key_id = 'e2e-api-key-agency'
        AND audit.action_name = 'report.share'
        AND audit.idempotency_key IN (SELECT idempotency_key FROM expected_j4_audit)
    )
      AND COALESCE(json_extract(share.snapshot_payload_json, '$.sharePurpose'), '') <> 'pdf-render'
  ) AS j4_ui_share_count,
  (SELECT COUNT(*) FROM j4_run_shares share
    WHERE share.id NOT IN (
      SELECT json_extract(audit.result_json, '$.share.id')
      FROM agent_action_audit audit
      WHERE audit.user_id = 'e2e-agency'
        AND audit.api_key_id = 'e2e-api-key-agency'
        AND audit.action_name = 'report.share'
        AND audit.idempotency_key IN (SELECT idempotency_key FROM expected_j4_audit)
    )
      AND COALESCE(json_extract(share.snapshot_payload_json, '$.sharePurpose'), '') <> 'pdf-render'
      AND share.revoked_at IS NULL
  ) AS j4_ui_active_share_count,
  (SELECT COUNT(*) FROM j4_run_shares share
    WHERE share.id NOT IN (
      SELECT json_extract(audit.result_json, '$.share.id')
      FROM agent_action_audit audit
      WHERE audit.user_id = 'e2e-agency'
        AND audit.api_key_id = 'e2e-api-key-agency'
        AND audit.action_name = 'report.share'
        AND audit.idempotency_key IN (SELECT idempotency_key FROM expected_j4_audit)
    )
      AND COALESCE(json_extract(share.snapshot_payload_json, '$.sharePurpose'), '') <> 'pdf-render'
      AND share.revoked_at IS NOT NULL
  ) AS j4_ui_revoked_share_count,
  (SELECT COUNT(*) FROM j4_run_rooms) AS j4_room_count,
  (SELECT COUNT(*) FROM client_room_resource ref
    WHERE ref.room_id IN (SELECT id FROM j4_run_rooms)
  ) AS j4_room_resource_count,
  (SELECT COUNT(*) FROM j4_run_rooms room
    WHERE room.user_id <> 'e2e-agency'
        OR room.name <> 'E2E approval recovery room ' || substr(room.run_id, length('e2e-run-j4-client-room-') + 1)
        OR room.status <> 'active'
        OR COALESCE(json_extract(room.notes_json, '$.purpose'), '') IS NOT 'approval recovery'
        OR COALESCE(json_extract(room.notes_json, '$.e2eRunId'), '') IS NOT
          replace(room.run_id, 'e2e-run-j4-client-room-', 'e2e-run-j4-approval-stale-')
        OR (SELECT COUNT(*) FROM client_room_resource ref WHERE ref.room_id = room.id) <> 2
        OR (SELECT COUNT(*) FROM client_room_resource ref
            WHERE ref.room_id = room.id
              AND ref.user_id = 'e2e-agency'
              AND ref.resource_type = 'watchlist'
              AND ref.resource_id = 'e2e-watchlist-agency-1') <> 1
        OR (SELECT COUNT(*) FROM client_room_resource ref
            WHERE ref.room_id = room.id
              AND ref.user_id = 'e2e-agency'
              AND ref.resource_type = 'report'
              AND ref.resource_id = 'watchlist:e2e-watchlist-agency-1') <> 1
  ) AS j4_room_mismatch_count,
  (SELECT COUNT(*) FROM dodo_webhook_event
    WHERE event_id GLOB 'e2e-j5-replay:e2e-j5-billing-lifecycle-???x???'
       OR event_id GLOB 'e2e-j5-replay:e2e-j5-billing-lifecycle-????x???'
  ) AS j5_replay_count,
  ${journey5EventCountExpression()} AS j5_event_count,
  ${journey5EventMismatchExpression()} AS j5_event_mismatch_count,
  (SELECT COUNT(*) FROM dodo_webhook_event replay
    WHERE (replay.event_id GLOB 'e2e-j5-replay:e2e-j5-billing-lifecycle-???x???'
        OR replay.event_id GLOB 'e2e-j5-replay:e2e-j5-billing-lifecycle-????x???')
      AND (replay.event_type <> 'e2e_j5_replay'
        OR replay.user_id <> CASE
          WHEN replay.event_id LIKE '%-768x900' THEN 'e2e-payment-issue-tablet'
          WHEN replay.event_id LIKE '%-1440x900' THEN 'e2e-payment-issue-desktop'
          ELSE 'e2e-payment-issue'
        END
        OR replay.outcome <> 'processed'
        OR replay.metadata_json IS NULL
        OR json_valid(replay.metadata_json) <> 1
        OR json_extract(replay.metadata_json, '$.status') IS NOT 'succeeded'
        OR json_extract(replay.metadata_json, '$.result.provider.called') IS NOT 0
        OR json_extract(replay.metadata_json, '$.result.provider.reason') IS NOT 'e2e_network_denied'
        OR json_extract(replay.metadata_json, '$.result.cleanup.rawProviderIdsExposed') IS NOT 0
        OR json_extract(replay.metadata_json, '$.result.cleanup.secretsExposed') IS NOT 0
        OR json_extract(replay.metadata_json, '$.result.cleanup.piiExposed') IS NOT 0
        OR json_extract(replay.metadata_json, '$.result.lifecycle.activationDuplicate') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.lifecycle.paymentFailedRecovered') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.lifecycle.cancellationScheduledReversed') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.lifecycle.missingNullNoReversal') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.lifecycle.olderNoRegression') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.lifecycle.planChangeApplied') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.lifecycle.cancelledExpiredRevoked') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.lifecycle.fullRefundRevoked') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.lifecycle.partialAndFailedNoMutation') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.controlledInbox.accepted') IS NOT 4
        OR json_extract(replay.metadata_json, '$.result.controlledInbox.externalProviderCalled') IS NOT 0
        OR json_extract(replay.metadata_json, '$.result.controlledInbox.tags[0]') IS NOT 'billing-cancellation'
        OR json_extract(replay.metadata_json, '$.result.controlledInbox.tags[1]') IS NOT 'billing-cancellation'
        OR json_extract(replay.metadata_json, '$.result.controlledInbox.tags[2]') IS NOT 'billing-payment-issue'
        OR json_extract(replay.metadata_json, '$.result.controlledInbox.tags[3]') IS NOT 'billing-refund'
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.checkout.accepted') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.checkout.canonicalSku') IS NOT 'starter_monthly_v1'
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.checkout.safeHostedUrl') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.planChange.previewed') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.planChange.tokenVerified') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.planChange.accepted') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.planChange.claimAccepted') IS NOT 1
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.planChange.canonicalSku') IS NOT 'agency_monthly_v1'
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.syntheticCallCount') IS NOT 4
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.externalProviderCalled') IS NOT 0
        OR json_extract(replay.metadata_json, '$.result.commercialProviderReplay.entitlementReconciled') IS NOT 1)
  ) AS j5_replay_mismatch_count,
  (SELECT COUNT(*) FROM user_plan
    WHERE (user_id IN ('e2e-activation', 'e2e-activation-tablet', 'e2e-activation-desktop')
        AND (plan <> 'agency' OR dodo_status <> 'active' OR dodo_product_id <> 'e2e-j5-product-agency-monthly'))
       OR (user_id IN ('e2e-payment-issue', 'e2e-payment-issue-tablet', 'e2e-payment-issue-desktop')
        AND (plan <> 'starter' OR dodo_status <> 'active'))
       OR (user_id IN ('e2e-cancelled', 'e2e-cancelled-tablet', 'e2e-cancelled-desktop') AND (plan <> 'free' OR dodo_status <> 'subscription.cancelled'))
       OR (user_id IN ('e2e-refunded', 'e2e-refunded-tablet', 'e2e-refunded-desktop') AND (plan <> 'free' OR dodo_status <> 'refunded'))
  ) AS j5_entitlement_mismatch_count,
  (SELECT COUNT(*) FROM e2e_j6_replay
    WHERE idempotency_key GLOB 'e2e-j6-support-failure-???x???'
       OR idempotency_key GLOB 'e2e-j6-support-recovery-???x???'
       OR idempotency_key GLOB 'e2e-j6-support-failure-????x???'
       OR idempotency_key GLOB 'e2e-j6-support-recovery-????x???'
  ) AS j6_support_replay_count,
  (SELECT COUNT(*) FROM e2e_j6_replay replay
    WHERE (replay.idempotency_key GLOB 'e2e-j6-support-failure-???x???'
        OR replay.idempotency_key GLOB 'e2e-j6-support-recovery-???x???'
        OR replay.idempotency_key GLOB 'e2e-j6-support-failure-????x???'
        OR replay.idempotency_key GLOB 'e2e-j6-support-recovery-????x???')
      AND (replay.user_id <> 'e2e-support-recovery'
        OR replay.status <> 'succeeded'
        OR replay.result_json IS NULL
        OR json_valid(replay.result_json) <> 1
        OR replay.run_id <> replace(replay.idempotency_key, 'e2e-j6-support-', 'e2e-run-j6-support-')
        OR replay.action <> CASE
          WHEN replay.idempotency_key LIKE 'e2e-j6-support-failure-%' THEN 'failure'
          ELSE 'recovery'
        END
        OR json_extract(replay.result_json, '$.provider.called') IS NOT 0
        OR json_extract(replay.result_json, '$.provider.reason') IS NOT 'e2e_network_denied'
        OR json_extract(replay.result_json, '$.attempt.owned') IS NOT 1
        OR json_extract(replay.result_json, '$.cleanup.rawProviderIdsExposed') IS NOT 0
        OR json_extract(replay.result_json, '$.cleanup.rawErrorsExposed') IS NOT 0
        OR json_extract(replay.result_json, '$.cleanup.piiExposed') IS NOT 0)
  ) AS j6_support_replay_mismatch_count,
  (SELECT COUNT(*) FROM delivery_attempt
    WHERE idempotency_key = 'support-case:e2e-support-recovery-case'
  ) AS j6_support_attempt_count,
  (SELECT COUNT(*) FROM delivery_attempt
    WHERE idempotency_key = 'support-case:e2e-support-recovery-case'
      AND (user_id <> 'e2e-support-recovery'
        OR lane <> 'internal'
        OR channel <> 'email'
        OR provider <> 'cloudflare_email'
        OR status <> 'sent'
        OR webhook_status <> 'delivered'
        OR target_value <> 'support-internal'
        OR provider_message_id IS NOT NULL
        OR error_message IS NOT NULL
        OR json_extract(payload_snapshot_json, '$.kind') IS NOT 'support_case_operator_alert'
        OR json_extract(payload_snapshot_json, '$.caseId') IS NOT 'e2e-support-recovery-case')
  ) AS j6_support_attempt_mismatch_count,
  (SELECT COUNT(*) FROM support_case_event
    WHERE case_id = 'e2e-support-recovery-case'
      AND event_type = 'support_notification_failed'
      AND visible_to_customer = 1
      AND json_extract(metadata_json, '$.idempotencyKey') = 'support-notification:e2e-support-recovery-case:failed'
  ) AS j6_support_failed_event_count,
  (SELECT COUNT(*) FROM support_case_event
    WHERE case_id = 'e2e-support-recovery-case'
      AND event_type = 'support_notified'
      AND visible_to_customer = 1
      AND json_extract(metadata_json, '$.idempotencyKey') = 'support-notification:e2e-support-recovery-case:sent'
  ) AS j6_support_sent_event_count,
  (SELECT COUNT(*) FROM support_case
    WHERE user_id = 'e2e-support-recovery'
      AND id <> 'e2e-support-recovery-case'
      AND created_at >= '${startedAt}'
  ) AS j6_support_ui_case_count,
  (SELECT COUNT(*) FROM support_case_event event
    JOIN support_case parent ON parent.id = event.case_id
    WHERE parent.user_id = 'e2e-support-recovery'
      AND parent.id <> 'e2e-support-recovery-case'
      AND parent.created_at >= '${startedAt}'
  ) AS j6_support_ui_event_count,
  (SELECT COUNT(*) FROM e2e_j6_replay
    WHERE idempotency_key IN (
      'e2e-j6-retention-failure-375x812', 'e2e-j6-retention-recovery-375x812',
      'e2e-j6-retention-failure-768x900', 'e2e-j6-retention-recovery-768x900',
      'e2e-j6-retention-failure-1440x900', 'e2e-j6-retention-recovery-1440x900'
    )
  ) AS j6_retention_replay_count,
  (SELECT COUNT(*) FROM e2e_j6_replay replay
    WHERE replay.idempotency_key IN (
      'e2e-j6-retention-failure-375x812', 'e2e-j6-retention-recovery-375x812',
      'e2e-j6-retention-failure-768x900', 'e2e-j6-retention-recovery-768x900',
      'e2e-j6-retention-failure-1440x900', 'e2e-j6-retention-recovery-1440x900'
    )
      AND (replay.user_id <> 'e2e-starter'
        OR replay.status <> 'succeeded'
        OR replay.result_json IS NULL
        OR json_valid(replay.result_json) <> 1
        OR length(replay.result_json) > 8192
        OR replay.run_id <> replace(replay.idempotency_key, 'e2e-j6-retention-', 'e2e-run-j6-retention-')
        OR replay.action <> CASE
          WHEN replay.idempotency_key LIKE 'e2e-j6-retention-failure-%' THEN 'failure'
          ELSE 'recovery'
        END
        OR json_extract(replay.result_json, '$.provider.called') IS NOT 0
        OR json_extract(replay.result_json, '$.provider.reason') IS NOT 'e2e_network_denied'
        OR json_extract(replay.result_json, '$.cleanup.rawProviderIdsExposed') IS NOT 0
        OR json_extract(replay.result_json, '$.cleanup.rawErrorsExposed') IS NOT 0
        OR json_extract(replay.result_json, '$.cleanup.piiExposed') IS NOT 0
        OR json_extract(replay.result_json, '$.fixture.rowsBefore') IS NOT 1
        OR CASE
          WHEN replay.idempotency_key LIKE 'e2e-j6-retention-failure-%' THEN
            json_extract(replay.result_json, '$.fixture.rowsAfter') IS NOT 1
            OR json_extract(replay.result_json, '$.failedSteps[0]') IS NOT 'discovery_cache_entry'
            OR json_array_length(replay.result_json, '$.failedSteps') <> 1
            OR json_extract(replay.result_json, '$.recoveryRequired') IS NOT 1
          ELSE
            json_extract(replay.result_json, '$.fixture.rowsAfter') IS NOT 0
            OR json_extract(replay.result_json, '$.fixture.discoveryCacheDeleted') IS NOT 1
            OR json_array_length(replay.result_json, '$.failedSteps') <> 0
            OR json_extract(replay.result_json, '$.recoveryRequired') IS NOT 0
        END)
  ) AS j6_retention_replay_mismatch_count,
  (SELECT COUNT(*) FROM discovery_cache_entry
    WHERE cache_key IN ('e2e-j6-retention:375x812', 'e2e-j6-retention:768x900', 'e2e-j6-retention:1440x900')
  ) AS j6_retention_fixture_count,
  (SELECT COUNT(*) FROM cron_failure_alert_throttle
    WHERE task_key = 'retention_sweep'
      AND (alert_count <> 0 OR last_error IS NOT 'operator_alert_not_sent')
  ) AS j6_retention_alert_mismatch_count,
  (SELECT COUNT(*) FROM cron_failure_alert_throttle
    WHERE task_key = 'retention_sweep'
  ) AS j6_retention_alert_count,
  (SELECT COUNT(*) FROM e2e_j6_replay
    WHERE idempotency_key IN (
      'e2e-j6-team-invite-375x812',
      'e2e-j6-team-invite-768x900',
      'e2e-j6-team-invite-1440x900'
    )
  ) AS j6_team_replay_count,
  (SELECT COUNT(*) FROM e2e_j6_replay replay
    WHERE replay.idempotency_key IN (
      'e2e-j6-team-invite-375x812',
      'e2e-j6-team-invite-768x900',
      'e2e-j6-team-invite-1440x900'
    )
      AND (replay.action <> 'team_membership'
        OR replay.user_id <> 'e2e-agency'
        OR replay.run_id <> replace(replay.idempotency_key, 'e2e-j6-team-invite-', 'e2e-run-j6-team-invite-')
        OR replay.status <> 'succeeded'
        OR replay.result_json IS NULL
        OR json_valid(replay.result_json) <> 1
        OR length(replay.result_json) > 8192
        OR json_extract(replay.result_json, '$.provider.called') IS NOT 0
        OR json_extract(replay.result_json, '$.provider.reason') IS NOT 'e2e_network_denied'
        OR json_extract(replay.result_json, '$.concurrency.exactlyOneSuccess') IS NOT 1
        OR json_extract(replay.result_json, '$.rotation.staleTokenRejected') IS NOT 1
        OR json_extract(replay.result_json, '$.rotation.currentTokenAccepted') IS NOT 1
        OR json_extract(replay.result_json, '$.rotation.tokenHashCleared') IS NOT 1
        OR json_extract(replay.result_json, '$.revoke.acceptedMemberRevoked') IS NOT 1
        OR json_extract(replay.result_json, '$.cleanup.rawTokensExposed') IS NOT 0
        OR json_extract(replay.result_json, '$.cleanup.rawHashesExposed') IS NOT 0
        OR json_extract(replay.result_json, '$.cleanup.rawProviderIdsExposed') IS NOT 0
        OR json_extract(replay.result_json, '$.cleanup.piiExposed') IS NOT 0)
  ) AS j6_team_replay_mismatch_count,
  (SELECT COUNT(*) FROM workspace_member
    WHERE owner_user_id = 'e2e-agency'
      AND id NOT IN ('e2e-member-active', 'e2e-member-revoked')
  ) AS j6_team_workspace_delta_count,
  (SELECT COUNT(*) FROM e2e_j6_replay
    WHERE idempotency_key LIKE 'e2e-j6-auth-%'
  ) AS j6_auth_persistent_row_count,
  (SELECT COUNT(*) FROM e2e_j6_replay
    WHERE idempotency_key LIKE 'e2e-j6-%'
      AND idempotency_key NOT IN (
        'e2e-j6-support-failure-375x812', 'e2e-j6-support-recovery-375x812',
        'e2e-j6-support-failure-768x900', 'e2e-j6-support-recovery-768x900',
        'e2e-j6-support-failure-1440x900', 'e2e-j6-support-recovery-1440x900',
        'e2e-j6-retention-failure-375x812', 'e2e-j6-retention-recovery-375x812',
        'e2e-j6-retention-failure-768x900', 'e2e-j6-retention-recovery-768x900',
        'e2e-j6-retention-failure-1440x900', 'e2e-j6-retention-recovery-1440x900',
        'e2e-j6-team-invite-375x812', 'e2e-j6-team-invite-768x900', 'e2e-j6-team-invite-1440x900'
      )
  ) AS j6_unexpected_replay_count;
`.trim();
}

const RELEASE_ZERO_COUNTS = Object.freeze([
  "activation_duplicate_count",
  "activation_duplicate_run_count",
  "activation_nonterminal_run_count",
  "activation_orphan_run_count",
  "activation_target_mismatch_count",
  "activation_terminal_mismatch_count",
  "non_demo_cache_count",
  "non_demo_fetch_count",
  "non_demo_provider_state_count",
  "watchlist_ad_count",
  "watchlist_ad_observation_count",
  "watchlist_candidate_count",
  "watchlist_event_count",
  "watchlist_landing_snapshot_count",
  "watchlist_proof_capture_count",
  "watchlist_proof_target_count",
  "j3_delivery_attempt_count",
  "j3_delivery_target_count",
  "j3_digest_delivery_count",
  "j3_replay_incomplete_count",
  "j3_reservation_count",
  "j3_run_count",
  "j4_agent_share_mismatch_count",
  "j4_audit_mismatch_count",
  "j4_replay_mismatch_count",
  "j4_room_mismatch_count",
  "j5_event_mismatch_count",
  "j5_replay_mismatch_count",
  "j6_support_attempt_mismatch_count",
  "j6_support_replay_mismatch_count",
  "j6_retention_replay_mismatch_count",
  "j6_retention_fixture_count",
  "j6_retention_alert_mismatch_count",
  "j6_team_replay_mismatch_count",
  "j6_team_workspace_delta_count",
  "j6_auth_persistent_row_count",
  "j6_unexpected_replay_count",
]);

function releaseExactCounts(journeyScope = [2]) {
  if (!Array.isArray(journeyScope) || journeyScope.some((journey) => !Number.isInteger(journey) || journey < 1 || journey > 6)) {
    throw new Error("invalid_release_journey_scope");
  }
  return {
    activation_run_count: journeyScope.includes(2) ? 3 : 0,
    activation_watchlist_count: journeyScope.includes(2) ? 3 : 0,
    j3_replay_count: journeyScope.includes(3) ? 21 : 0,
    j4_agent_share_count: journeyScope.includes(4) ? 3 : 0,
    j4_audit_count: journeyScope.includes(4) ? 9 : 0,
    j4_replay_count: journeyScope.includes(4) ? 12 : 0,
    j4_room_count: journeyScope.includes(4) ? 3 : 0,
    j4_room_resource_count: journeyScope.includes(4) ? 6 : 0,
    j4_ui_active_share_count: journeyScope.includes(4) ? 3 : 0,
    j4_ui_revoked_share_count: journeyScope.includes(4) ? 3 : 0,
    j4_ui_share_count: journeyScope.includes(4) ? 6 : 0,
    j5_event_count: journeyScope.includes(5) ? 48 : 0,
    // The three activation personas are pristine Free fixtures unless J5
    // runs its signed activation lifecycle. Keep that expected seed delta
    // explicit so independently runnable journeys do not inherit J5 state.
    j5_entitlement_mismatch_count: journeyScope.includes(5) ? 0 : 3,
    j5_replay_count: journeyScope.includes(5) ? 3 : 0,
    j6_support_attempt_count: journeyScope.includes(6) ? 1 : 0,
    j6_support_failed_event_count: journeyScope.includes(6) ? 1 : 0,
    j6_support_replay_count: journeyScope.includes(6) ? 6 : 0,
    j6_support_sent_event_count: journeyScope.includes(6) ? 1 : 0,
    j6_support_ui_case_count: journeyScope.includes(6) ? 3 : 0,
    j6_support_ui_event_count: journeyScope.includes(6) ? 6 : 0,
    j6_retention_replay_count: journeyScope.includes(6) ? 6 : 0,
    j6_retention_alert_count: journeyScope.includes(6) ? 1 : 0,
    j6_team_replay_count: journeyScope.includes(6) ? 3 : 0,
  };
}

function j4PdfShareCountIsReady(row, journeyScope) {
  const actual = Number(row?.j4_pdf_share_count);
  return journeyScope.includes(4)
    ? Number.isInteger(actual) && actual >= 1 && actual <= 3
    : actual === 0;
}

export function releaseStateReadyForAssertion(row, journeyScope = [2]) {
  const exactCounts = releaseExactCounts(journeyScope);
  return (
    Object.entries(exactCounts).every(([key, expected]) => Number(row?.[key]) === expected) &&
    RELEASE_ZERO_COUNTS.every((key) => Number(row?.[key]) === 0) &&
    Number(row?.activation_owner_mismatch_count) === (journeyScope.includes(2) ? 0 : 3) &&
    j4PdfShareCountIsReady(row, journeyScope)
  );
}

export function assertReleaseState(row, journeyScope = [2]) {
  const exactCounts = releaseExactCounts(journeyScope);
  const failures = [];
  for (const [key, expected] of Object.entries(exactCounts)) {
    const actual = Number(row?.[key]);
    if (!Number.isFinite(actual) || actual !== expected) failures.push(`${key}:${String(row?.[key])}`);
  }
  for (const key of RELEASE_ZERO_COUNTS) {
    const actual = Number(row?.[key]);
    if (!Number.isFinite(actual) || actual !== 0) failures.push(`${key}:${String(row?.[key])}`);
  }
  // The ownership query deliberately reports each missing activation persona.
  // An independently runnable journey that does not exercise activation should
  // therefore expect all three owners to be absent, not misclassify that clean
  // zero-delta state as a postflight integrity failure.
  const expectedOwnerMismatches = journeyScope.includes(2) ? 0 : 3;
  if (Number(row?.activation_owner_mismatch_count) !== expectedOwnerMismatches) {
    failures.push(
      `activation_owner_mismatch_count:${String(row?.activation_owner_mismatch_count)}`,
    );
  }
  if (!j4PdfShareCountIsReady(row, journeyScope)) {
    failures.push(`j4_pdf_share_count:${String(row?.j4_pdf_share_count)}`);
  }
  if (failures.length > 0) throw new Error(`e2e_release_state_failed:${failures.join(",")}`);
  return true;
}
// @ts-nocheck Fixture invariants are exercised against isolated D1 state.
