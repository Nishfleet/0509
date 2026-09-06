/**
 * Workspace / ops aggregate D1 reads (weekly business, customer-at-risk,
 * full operator snapshot). Product code should keep importing from
 * `~/lib/data.server` until later migration PRs. Leaf imports `d1.server`
 * + `helpers.server` + watchlist-runs helpers directly (no barrel cycle).
 */

import {
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  countLeadingFailures,
  isSoftScanFailure,
} from "~/lib/data/watchlist-runs.server";
import type { AppEnv } from "~/lib/env.server";
import { getScheduledMonitoringPolicy } from "~/lib/plan-entitlements";
import type {
  AdDiscoveryProvider,
  DeliveryAttemptStatus,
  DeliveryChannel,
  DiscoveryCacheStatus,
  DiscoveryFailureClass,
  DiscoveryRouteContext,
  MetaIntegrationStatus,
  ProofStatus,
  SupportCaseCategory,
  SupportCasePriority,
  WebhookReconciliationStatus,
} from "~/lib/types";

export interface OperatorRiskSummary {
  troubleWatchlists: Array<{
    id: string;
    name: string;
    userEmail: string;
    consecutiveFailures: number;
  }>;
  staleWatchlists: Array<{
    id: string;
    name: string;
    userEmail: string;
    lastScannedAt: string | null;
  }>;
  deliveryFailures24h: number;
  stuckRuns: number;
}

// Targeted "customer-at-risk" signals for the daily operator alert —
// deliberately cheaper than the full operator snapshot.
export interface WeeklyBusinessSummary {
  signups7d: number;
  activated7d: number;
  payingByPlan: Array<{ plan: string; count: number }>;
  dunningCount: number;
  revokedToFree7d: number;
  digestAttempts7d: number;
  digestSent7d: number;
  oldestActivePaidScanAt: string | null;
}

function resolvePaidScanStaleCutoffIso(
  plan: "scout" | "starter" | "agency",
  nowMs: number,
) {
  const cadence = getScheduledMonitoringPolicy(plan).scheduledScanCadence;
  const staleAfterHours =
    cadence === "every_3h" ? 7 : cadence === "every_6h" ? 13 : 36;
  return new Date(nowMs - staleAfterHours * 60 * 60 * 1000).toISOString();
}

// Monday operator email: the handful of numbers that say whether the
// business moved last week. Read-only aggregates, cheap enough for cron.
export async function getWeeklyBusinessSummary(env: AppEnv): Promise<WeeklyBusinessSummary> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [signupRow, activatedRow, payingRows, dunningRow, revokedRow, digestRows, staleRow] =
    await Promise.all([
      one<{ count: number }>(env, `SELECT COUNT(*) AS count FROM user WHERE createdAt >= ?`, weekAgo),
      one<{ count: number }>(
        env,
        `SELECT COUNT(*) AS count FROM user WHERE onboardedAt IS NOT NULL AND onboardedAt >= ?`,
        weekAgo,
      ),
      many<{ plan: string; count: number }>(
        env,
        `SELECT plan, COUNT(*) AS count FROM user_plan WHERE plan != 'free' GROUP BY plan ORDER BY plan`,
      ),
      one<{ count: number }>(
        env,
        `
          SELECT COUNT(*) AS count
          FROM user_plan
          WHERE plan != 'free'
            AND dodo_status IN ('payment.failed', 'subscription.failed', 'subscription.on_hold')
        `,
      ),
      one<{ count: number }>(
        env,
        `
          SELECT COUNT(*) AS count
          FROM user_plan
          WHERE plan = 'free'
            AND dodo_status IS NOT NULL
            AND dodo_status != 'checkout_pending'
            AND plan_updated_at >= ?
        `,
        weekAgo,
      ),
      many<{ status: string; count: number }>(
        env,
        `
          SELECT status, COUNT(*) AS count
          FROM delivery_attempt
          WHERE template_name = 'digest'
            AND created_at >= ?
          GROUP BY status
        `,
        weekAgo,
      ),
      one<{ oldest: string | null }>(
        env,
        `
          SELECT MIN(watchlist.last_scanned_at) AS oldest
          FROM watchlist
          INNER JOIN user_plan ON user_plan.user_id = watchlist.user_id
          WHERE watchlist.is_active = 1
            AND user_plan.plan != 'free'
            AND watchlist.last_scanned_at IS NOT NULL
        `,
      ),
    ]);

  const digestAttempts = digestRows.reduce((sum, row) => sum + Number(row.count), 0);
  const digestSent = digestRows
    .filter((row) => row.status === "sent" || row.status === "delivered")
    .reduce((sum, row) => sum + Number(row.count), 0);

  return {
    signups7d: Number(signupRow?.count ?? 0),
    activated7d: Number(activatedRow?.count ?? 0),
    payingByPlan: payingRows.map((row) => ({ plan: row.plan, count: Number(row.count) })),
    dunningCount: Number(dunningRow?.count ?? 0),
    revokedToFree7d: Number(revokedRow?.count ?? 0),
    digestAttempts7d: digestAttempts,
    digestSent7d: digestSent,
    oldestActivePaidScanAt: staleRow?.oldest ?? null,
  };
}

export async function getOperatorRiskSummary(env: AppEnv): Promise<OperatorRiskSummary> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const recentlyFailed = await many<{ id: string; name: string; user_email: string }>(
    env,
    `
      SELECT DISTINCT watchlist.id, watchlist.name, user.email AS user_email
      FROM watchlist_run
      INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
      INNER JOIN user ON user.id = watchlist.user_id
      WHERE watchlist_run.status = 'failed'
        AND watchlist_run.started_at >= ?
        AND watchlist.is_active = 1
      LIMIT 20
    `,
    dayAgo,
  );

  const troubleWatchlists: OperatorRiskSummary["troubleWatchlists"] = [];
  for (const candidate of recentlyFailed) {
    const lastRuns = await many<{ status: string; error_code: string | null }>(
      env,
      `
        SELECT status, error_code
        FROM watchlist_run
        WHERE watchlist_id = ?
        ORDER BY started_at DESC
        LIMIT 5
      `,
      candidate.id,
    );
    // Provider cooldowns (rate_limited/cache_only) are soft: one rate-limit
    // event fails a whole tail of the night's sequential scans — counting
    // those as customer-at-risk produced alarm noise for both sides.
    const consecutiveFailures = countLeadingFailures(
      lastRuns
        .filter((run) => !isSoftScanFailure(run.status, run.error_code))
        .map((run) => run.status),
    );
    if (consecutiveFailures >= 3) {
      troubleWatchlists.push({
        id: candidate.id,
        name: candidate.name,
        userEmail: candidate.user_email,
        consecutiveFailures,
      });
    }
  }

  // Budget-skipped watchlists never create a run row, so failure counting
  // can't see them — staleness can: an active paid watchlist that has missed
  // multiple regular scan windows means capacity is overflowing or the cron is
  // broken. This is the cadence-aware capacity canary.
  const nowMs = Date.now();
  const scoutStaleCutoff = resolvePaidScanStaleCutoffIso("scout", nowMs);
  const starterStaleCutoff = resolvePaidScanStaleCutoffIso("starter", nowMs);
  const agencyStaleCutoff = resolvePaidScanStaleCutoffIso("agency", nowMs);
  const staleRows = await many<{
    id: string;
    name: string;
    user_email: string;
    last_scanned_at: string | null;
  }>(
    env,
    `
      SELECT watchlist.id, watchlist.name, user.email AS user_email,
             watchlist.last_scanned_at
      FROM watchlist
      INNER JOIN user_plan ON user_plan.user_id = watchlist.user_id
      INNER JOIN user ON user.id = watchlist.user_id
      WHERE watchlist.is_active = 1
        AND (
          (user_plan.plan = 'scout'
            AND watchlist.created_at < ?
            AND (watchlist.last_scanned_at IS NULL OR watchlist.last_scanned_at < ?))
          OR (user_plan.plan = 'starter'
            AND watchlist.created_at < ?
            AND (watchlist.last_scanned_at IS NULL OR watchlist.last_scanned_at < ?))
          OR (user_plan.plan = 'agency'
            AND watchlist.created_at < ?
            AND (watchlist.last_scanned_at IS NULL OR watchlist.last_scanned_at < ?))
        )
      ORDER BY watchlist.last_scanned_at ASC
      LIMIT 10
    `,
    scoutStaleCutoff,
    scoutStaleCutoff,
    starterStaleCutoff,
    starterStaleCutoff,
    agencyStaleCutoff,
    agencyStaleCutoff,
  );

  const [deliveryRow, stuckRow] = await Promise.all([
    one<{ count: number }>(
      env,
      `
        SELECT COUNT(*) AS count
        FROM delivery_attempt
        WHERE status = 'failed'
          AND lane = 'customer'
          AND created_at >= ?
      `,
      dayAgo,
    ),
    one<{ count: number }>(
      env,
      `
        SELECT COUNT(*) AS count
        FROM watchlist_run
        WHERE status IN ('pending', 'running')
          AND started_at < ?
      `,
      hourAgo,
    ),
  ]);

  return {
    troubleWatchlists,
    staleWatchlists: staleRows.map((row) => ({
      id: row.id,
      name: row.name,
      userEmail: row.user_email,
      lastScannedAt: row.last_scanned_at,
    })),
    deliveryFailures24h: Number(deliveryRow?.count ?? 0),
    stuckRuns: Number(stuckRow?.count ?? 0),
  };
}

export async function getOperatorSnapshot(env: AppEnv) {
  const now = Date.now();
  const stuckThresholdIso = new Date(now - 30 * 60 * 1000).toISOString();
  const recentWindowIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const acceptedEmailAttentionBeforeIso = new Date(
    now - 15 * 60 * 1000,
  ).toISOString();
  const warnings: Array<{ section: string; message: string }> = [];
  const isolate = async <T,>(section: string, promise: Promise<T>, fallback: T) => {
    try {
      return await promise;
    } catch {
      warnings.push({ section, message: "This section could not be loaded." });
      return fallback;
    }
  };

  const [
    failingRuns,
    stuckRuns,
    failedProofs,
    budgetBlockedProofs,
    blockedTargets,
    deliveryAttention,
    degradedWatchlists,
    discoveryFailures,
    discoveryProviders,
    supportCases,
  ] = await Promise.all([
    isolate("failingRuns", many<{
      run_id: string;
      watchlist_id: string;
      watchlist_name: string;
      started_at: string;
      error_code: string | null;
    }>(
      env,
      `
        SELECT
          watchlist_run.id AS run_id,
          watchlist.id AS watchlist_id,
          watchlist.name AS watchlist_name,
          watchlist_run.started_at,
          watchlist_run.error_code
        FROM watchlist_run
        INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
        WHERE watchlist_run.status = 'failed'
          AND watchlist_run.started_at >= ?
        ORDER BY watchlist_run.started_at DESC
        LIMIT 8
      `,
      recentWindowIso,
    ), []),
    isolate("stuckRuns", many<{
      run_id: string;
      watchlist_id: string;
      watchlist_name: string;
      status: string;
      started_at: string;
    }>(
      env,
      `
        SELECT
          watchlist_run.id AS run_id,
          watchlist.id AS watchlist_id,
          watchlist.name AS watchlist_name,
          watchlist_run.status,
          watchlist_run.started_at
        FROM watchlist_run
        INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
        WHERE watchlist_run.status IN ('pending', 'running')
          AND watchlist_run.started_at <= ?
        ORDER BY watchlist_run.started_at ASC
        LIMIT 8
      `,
      stuckThresholdIso,
    ), []),
    isolate("failedProofs", many<{
      proof_capture_id: string;
      watchlist_id: string;
      watchlist_name: string;
      attempted_at: string;
      failure_code: string | null;
    }>(
      env,
      `
        SELECT
          proof_capture.id AS proof_capture_id,
          watchlist.id AS watchlist_id,
          watchlist.name AS watchlist_name,
          proof_capture.attempted_at,
          proof_capture.failure_code
        FROM proof_capture
        INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
        INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
        WHERE proof_capture.status = 'failed'
          AND proof_capture.attempted_at >= ?
        ORDER BY proof_capture.attempted_at DESC
        LIMIT 8
      `,
      recentWindowIso,
    ), []),
    isolate("budgetBlockedProofs", many<{
      proof_capture_id: string;
      watchlist_id: string;
      watchlist_name: string;
      status: ProofStatus;
      attempted_at: string;
    }>(
      env,
      `
        SELECT
          proof_capture.id AS proof_capture_id,
          watchlist.id AS watchlist_id,
          watchlist.name AS watchlist_name,
          proof_capture.status,
          proof_capture.attempted_at
        FROM proof_capture
        INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
        INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
        WHERE proof_capture.status IN ('skipped_due_to_budget', 'skipped_due_to_rate_limit')
          AND proof_capture.attempted_at >= ?
        ORDER BY proof_capture.attempted_at DESC
        LIMIT 8
      `,
      recentWindowIso,
    ), []),
    isolate("blockedTargets", many<{
      delivery_target_id: string;
      watchlist_id: string | null;
      watchlist_name: string | null;
      channel: DeliveryChannel;
      is_opted_in: number;
      is_validated: number;
      is_paused: number;
      template_eligible: number;
      updated_at: string;
    }>(
      env,
      `
        SELECT
          delivery_target.id AS delivery_target_id,
          delivery_target.watchlist_id,
          watchlist.name AS watchlist_name,
          delivery_target.channel,
          delivery_target.is_opted_in,
          delivery_target.is_validated,
          delivery_target.is_paused,
          delivery_target.template_eligible,
          delivery_target.updated_at
        FROM delivery_target
        LEFT JOIN watchlist ON watchlist.id = delivery_target.watchlist_id
        WHERE delivery_target.channel = 'whatsapp'
          AND (
            delivery_target.is_opted_in = 0 OR
            delivery_target.is_validated = 0 OR
            delivery_target.is_paused = 1 OR
            delivery_target.template_eligible = 0 OR
            delivery_target.opted_out_at IS NOT NULL
          )
        ORDER BY delivery_target.updated_at DESC
        LIMIT 8
      `,
    ), []),
    isolate("deliveryAttention", many<{
      attempt_id: string;
      watchlist_id: string | null;
      watchlist_name: string | null;
      channel: DeliveryChannel;
      status: DeliveryAttemptStatus;
      webhook_status: WebhookReconciliationStatus;
      provider_status_last_seen_at: string | null;
      created_at: string;
    }>(
      env,
      `
        SELECT
          delivery_attempt.id AS attempt_id,
          delivery_attempt.watchlist_id,
          watchlist.name AS watchlist_name,
          delivery_attempt.channel,
          delivery_attempt.status,
          delivery_attempt.webhook_status,
          delivery_attempt.provider_status_last_seen_at,
          delivery_attempt.created_at
        FROM delivery_attempt
        LEFT JOIN watchlist ON watchlist.id = delivery_attempt.watchlist_id
        WHERE (
            delivery_attempt.status = 'failed' OR
            (
              delivery_attempt.status = 'pending' AND
              delivery_attempt.webhook_status = 'provider_unknown'
            ) OR
            (
              delivery_attempt.channel = 'email' AND
              delivery_attempt.status = 'sent' AND
              delivery_attempt.webhook_status = 'provider_unknown' AND
              delivery_attempt.updated_at <= ?
            )
          )
          AND delivery_attempt.created_at >= ?
        ORDER BY
          CASE
            WHEN delivery_attempt.status = 'failed' THEN 0
            WHEN delivery_attempt.status = 'pending' THEN 1
            ELSE 2
          END,
          delivery_attempt.created_at DESC
        LIMIT 8
      `,
      acceptedEmailAttentionBeforeIso,
      recentWindowIso,
    ), []),
    isolate("degradedWatchlists", many<{
      watchlist_id: string;
      watchlist_name: string;
      failed_runs: number;
      failed_proofs: number;
      failed_deliveries: number;
      last_seen_at: string | null;
    }>(
      env,
      `
        SELECT
          watchlist.id AS watchlist_id,
          watchlist.name AS watchlist_name,
          (
            SELECT COUNT(*)
            FROM watchlist_run
            WHERE watchlist_run.watchlist_id = watchlist.id
              AND watchlist_run.status = 'failed'
              AND watchlist_run.started_at >= ?
          ) AS failed_runs,
          (
            SELECT COUNT(*)
            FROM proof_target
            INNER JOIN proof_capture ON proof_capture.proof_target_id = proof_target.id
            WHERE proof_target.watchlist_id = watchlist.id
              AND proof_capture.status = 'failed'
              AND proof_capture.attempted_at >= ?
          ) AS failed_proofs,
          (
            SELECT COUNT(*)
            FROM delivery_attempt
            WHERE delivery_attempt.watchlist_id = watchlist.id
              AND delivery_attempt.status = 'failed'
              AND delivery_attempt.created_at >= ?
          ) AS failed_deliveries,
          (
            SELECT MAX(ts) FROM (
              SELECT watchlist_run.started_at AS ts
              FROM watchlist_run
              WHERE watchlist_run.watchlist_id = watchlist.id
              UNION ALL
              SELECT proof_capture.attempted_at AS ts
              FROM proof_target
              INNER JOIN proof_capture ON proof_capture.proof_target_id = proof_target.id
              WHERE proof_target.watchlist_id = watchlist.id
              UNION ALL
              SELECT delivery_attempt.created_at AS ts
              FROM delivery_attempt
              WHERE delivery_attempt.watchlist_id = watchlist.id
            )
          ) AS last_seen_at
        FROM watchlist
        WHERE watchlist.is_active = 1
        GROUP BY watchlist.id
        HAVING failed_runs > 0 OR failed_proofs > 0 OR failed_deliveries > 0
        ORDER BY (failed_runs + failed_proofs + failed_deliveries) DESC, last_seen_at DESC
        LIMIT 8
      `,
      recentWindowIso,
      recentWindowIso,
      recentWindowIso,
    ), []),
    isolate("discoveryFailures", many<{
      fetchId: string;
      provider: AdDiscoveryProvider;
      routeContext: DiscoveryRouteContext;
      country: string;
      cacheStatus: DiscoveryCacheStatus;
      failureClass: DiscoveryFailureClass | null;
      browserMsUsed: number | null;
      partial: number | null;
      createdAt: string;
    }>(
      env,
      `
        SELECT
          discovery_fetch_log.id AS fetchId,
          discovery_fetch_log.provider,
          discovery_fetch_log.route_context AS routeContext,
          discovery_fetch_log.country,
          discovery_fetch_log.cache_status AS cacheStatus,
          discovery_fetch_log.failure_class AS failureClass,
          discovery_fetch_log.browser_ms_used AS browserMsUsed,
          json_extract(discovery_fetch_log.metadata_json, '$.partial') AS partial,
          discovery_fetch_log.created_at AS createdAt
        FROM discovery_fetch_log
        WHERE discovery_fetch_log.status = 'failed'
          AND discovery_fetch_log.created_at >= ?
        ORDER BY discovery_fetch_log.created_at DESC
        LIMIT 8
      `,
      recentWindowIso,
    ), []),
    isolate("discoveryProviders", many<{
      provider: AdDiscoveryProvider;
      status: MetaIntegrationStatus["status"];
      failureClass: DiscoveryFailureClass | null;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      partial: number | null;
      updatedAt: string;
    }>(
      env,
      `
        SELECT
          provider,
          status,
          failure_class AS failureClass,
          last_success_at AS lastSuccessAt,
          last_failure_at AS lastFailureAt,
          json_extract(metadata_json, '$.partial') AS partial,
          updated_at AS updatedAt
        FROM discovery_provider_state
        ORDER BY updated_at DESC
        LIMIT 4
      `,
    ), []),
    isolate("supportCases", many<{
      case_id: string;
      category: SupportCaseCategory;
      priority: SupportCasePriority;
      subject: string;
      updated_at: string;
      alert_attempt_id: string | null;
      alert_status: DeliveryAttemptStatus | null;
      alert_webhook_status: WebhookReconciliationStatus | null;
      alert_updated_at: string | null;
    }>(
      env,
      `
        SELECT
          support_case.id AS case_id,
          support_case.category,
          support_case.priority,
          support_case.subject,
          support_case.updated_at,
          alert.id AS alert_attempt_id,
          alert.status AS alert_status,
          alert.webhook_status AS alert_webhook_status,
          alert.updated_at AS alert_updated_at
        FROM support_case
        LEFT JOIN delivery_attempt AS alert
          ON alert.id = (
            SELECT candidate.id
            FROM delivery_attempt AS candidate
            WHERE json_extract(candidate.payload_snapshot_json, '$.kind') = 'support_case_operator_alert'
              AND json_extract(candidate.payload_snapshot_json, '$.caseId') = support_case.id
              AND (
                candidate.idempotency_key = 'support-case:' || support_case.id
                OR candidate.idempotency_key LIKE 'support-case-reopen:' || support_case.id || ':%'
              )
            ORDER BY
              CASE
                WHEN candidate.idempotency_key LIKE 'support-case-reopen:%'
                  THEN substr(
                    candidate.idempotency_key,
                    length('support-case-reopen:') + 1
                  )
                ELSE ''
              END DESC,
              candidate.created_at DESC,
              candidate.id DESC
            LIMIT 1
          )
        WHERE support_case.status = 'open'
        ORDER BY
          CASE support_case.priority WHEN 'urgent' THEN 0 ELSE 1 END,
          support_case.updated_at DESC
        LIMIT 20
      `,
    ), []),
  ]);

  return {
    summary: {
      failingRuns: failingRuns.length,
      stuckRuns: stuckRuns.length,
      failedProofs: failedProofs.length,
      budgetBlockedProofs: budgetBlockedProofs.length,
      blockedTargets: blockedTargets.length,
      deliveryFailures: deliveryAttention.filter((attempt) => attempt.status === "failed").length,
      deliveryAttention: deliveryAttention.length,
      degradedWatchlists: degradedWatchlists.length,
      discoveryFailures: discoveryFailures.length,
      discoveryProvidersNeedingAttention: discoveryProviders.filter(
        (provider) => provider.status !== "healthy",
      ).length,
      openSupportCases: supportCases.length,
      supportAlertsNeedRetry: supportCases.filter(
        (supportCase) =>
          supportCase.alert_status === "failed" &&
          supportCase.alert_webhook_status === "failed",
      ).length,
    },
    failingRuns,
    stuckRuns,
    failedProofs,
    budgetBlockedProofs,
    blockedTargets,
    deliveryFailures: deliveryAttention.filter(
      (attempt) => attempt.status === "failed",
    ),
    deliveryAttention,
    degradedWatchlists,
    discoveryFailures,
    discoveryProviders,
    supportCases,
    warnings,
  };
}

export async function getOperatorSupportCase(env: AppEnv, caseId: string) {
  return one<{
    id: string;
    userEmail: string;
    category: SupportCaseCategory;
    priority: SupportCasePriority;
    subject: string;
    detail: string;
    alertIdempotencyKey: string | null;
  }>(
    env,
    `
      SELECT
        support_case.id,
        user.email AS userEmail,
        support_case.category,
        support_case.priority,
        support_case.subject,
        support_case.detail,
        alert.idempotency_key AS alertIdempotencyKey
      FROM support_case
      INNER JOIN user ON user.id = support_case.user_id
      LEFT JOIN delivery_attempt AS alert
        ON alert.id = (
          SELECT candidate.id
          FROM delivery_attempt AS candidate
          WHERE json_extract(candidate.payload_snapshot_json, '$.kind') = 'support_case_operator_alert'
            AND json_extract(candidate.payload_snapshot_json, '$.caseId') = support_case.id
            AND (
              candidate.idempotency_key = 'support-case:' || support_case.id
              OR candidate.idempotency_key LIKE 'support-case-reopen:' || support_case.id || ':%'
            )
          ORDER BY
            CASE
              WHEN candidate.idempotency_key LIKE 'support-case-reopen:%'
                THEN substr(
                  candidate.idempotency_key,
                  length('support-case-reopen:') + 1
                )
              ELSE ''
            END DESC,
            candidate.created_at DESC,
            candidate.id DESC
          LIMIT 1
        )
      WHERE support_case.id = ?
        AND support_case.status = 'open'
      LIMIT 1
    `,
    caseId,
  );
}
