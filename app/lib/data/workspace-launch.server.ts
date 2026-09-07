/**
 * Workspace launch-readiness + Meta integration diagnostic D1 persistence.
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Leaf imports `d1.server` + `helpers.server` directly
 * (no `~/lib/data.server` cycle).
 */

import {
  execute as run,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  createId,
  jsonValue,
  nowIso,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import {
  isCustomerWhatsAppReady,
  isWhatsAppProviderConfigured,
  isWhatsAppWebhookConfigured,
  type AppEnv,
} from "~/lib/env.server";
import type { MetaIntegrationStatus } from "~/lib/types";

interface MetaLogRow {
  status: MetaIntegrationStatus["status"];
  summary: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export async function logMetaIntegrationStatus(
  env: AppEnv,
  input: {
    status: MetaIntegrationStatus["status"];
    summary: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: JsonRecord;
  },
) {
  await run(
    env,
    `
      INSERT INTO meta_integration_log (
        id,
        status,
        summary,
        error_code,
        error_message,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    createId(),
    input.status,
    input.summary,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    jsonValue(input.metadata ?? null),
    nowIso(),
  );
}

export async function getMetaIntegrationStatus(env: AppEnv) {
  const row = await one<MetaLogRow>(
    env,
    `
      SELECT status, summary, error_code, error_message, created_at
      FROM meta_integration_log
      ORDER BY created_at DESC
      LIMIT 1
    `,
  );

  return {
    status: row?.status ?? (env.META_AD_LIBRARY_TOKEN ? "degraded" : "demo"),
    provider: env.META_AD_LIBRARY_TOKEN ? "meta_api" : "demo",
    mode: env.META_AD_LIBRARY_TOKEN ? "diagnostic" : "demo",
    summary:
      row?.summary ??
      (env.META_AD_LIBRARY_TOKEN
        ? "Official Meta API is configured for limited diagnostic use."
        : "No live commercial discovery provider is configured. The app is running in explicit demo mode."),
    lastCheckedAt: row?.created_at ?? null,
    lastErrorCode: row?.error_code ?? null,
    lastErrorMessage: row?.error_message ?? null,
  } satisfies MetaIntegrationStatus;
}

export async function getLaunchReadinessSignals(env: AppEnv, now: Date = new Date()) {
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
  const [
    proofs,
    deliveries,
    emailDeliveries,
    slackTargets,
    slackDeliveries,
    whatsappTargets,
    whatsappDeliveries,
    watchlistRuns,
  ] = await Promise.all([
    one<{
      recent_count: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS recent_count,
          MAX(succeeded_at) AS latest_at
        FROM proof_capture
        WHERE status = 'succeeded'
          AND succeeded_at >= ?
          AND COALESCE(json_extract(capture_metadata_json, '$.kind'), '') != 'launch_readiness_canary'
      `,
      since,
    ),
    one<{
      recent_attempts: number;
      recent_sent: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS recent_attempts,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS recent_sent,
          MAX(COALESCE(provider_status_last_seen_at, sent_at, updated_at, created_at)) AS latest_at
        FROM delivery_attempt
        WHERE digest_run_id IS NOT NULL
          AND lane = 'customer'
          AND channel = 'email'
          AND provider = 'cloudflare_email'
          AND COALESCE(provider_status_last_seen_at, sent_at, updated_at, created_at) >= ?
      `,
      since,
    ),
    one<{
      recent_attempts: number;
      recent_sent: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS recent_attempts,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS recent_sent,
          MAX(COALESCE(sent_at, created_at)) AS latest_at
        FROM delivery_attempt
        WHERE channel = 'email'
          AND created_at >= ?
      `,
      since,
    ),
    one<{
      configured_targets: number;
      usable_targets: number;
      latest_successful_delivery_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS configured_targets,
          SUM(
            CASE
              WHEN is_opted_in = 1
                AND is_validated = 1
                AND is_paused = 0
                AND validation_status = 'validated'
                AND opted_out_at IS NULL
              THEN 1
              ELSE 0
            END
          ) AS usable_targets,
          MAX(last_successful_delivery_at) AS latest_successful_delivery_at
        FROM delivery_target
        WHERE channel = 'slack'
      `,
    ),
    one<{
      recent_attempts: number;
      recent_sent: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS recent_attempts,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS recent_sent,
          MAX(COALESCE(sent_at, created_at)) AS latest_at
        FROM delivery_attempt
        WHERE channel = 'slack'
          AND created_at >= ?
      `,
      since,
    ),
    one<{
      configured_targets: number;
      usable_targets: number;
      latest_successful_delivery_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS configured_targets,
          SUM(
            CASE
              WHEN is_opted_in = 1
                AND is_validated = 1
                AND is_paused = 0
                AND validation_status = 'validated'
                AND template_eligible = 1
                AND opted_out_at IS NULL
              THEN 1
              ELSE 0
            END
          ) AS usable_targets,
          MAX(last_successful_delivery_at) AS latest_successful_delivery_at
        FROM delivery_target
        WHERE channel = 'whatsapp'
      `,
    ),
    one<{
      recent_attempts: number;
      recent_sent: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          SUM(CASE WHEN lane = 'customer' THEN 1 ELSE 0 END) AS recent_attempts,
          SUM(
            CASE
              WHEN lane = 'customer'
                AND status = 'sent'
                AND webhook_status = 'delivered'
              THEN 1
              ELSE 0
            END
          ) AS recent_sent,
          MAX(
            CASE
              WHEN lane = 'customer'
                AND status = 'sent'
                AND webhook_status = 'delivered'
              THEN COALESCE(provider_status_last_seen_at, sent_at, created_at)
              ELSE NULL
            END
          ) AS latest_at
        FROM delivery_attempt
        WHERE channel = 'whatsapp'
          AND created_at >= ?
      `,
      since,
    ),
    one<{
      recent_count: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS recent_count,
          MAX(finished_at) AS latest_at
        FROM watchlist_run
        WHERE status = 'succeeded'
          AND finished_at >= ?
      `,
      since,
    ),
  ]);

  return {
    since,
    proof: {
      recentSuccessfulCaptures: Number(proofs?.recent_count ?? 0),
      latestSucceededAt: proofs?.latest_at ?? null,
    },
    digestDelivery: {
      recentAttempts: Number(deliveries?.recent_attempts ?? 0),
      recentSent: Number(deliveries?.recent_sent ?? 0),
      latestAttemptAt: deliveries?.latest_at ?? null,
    },
    emailDelivery: {
      recentAttempts: Number(emailDeliveries?.recent_attempts ?? 0),
      recentSent: Number(emailDeliveries?.recent_sent ?? 0),
      latestAttemptAt: emailDeliveries?.latest_at ?? null,
    },
    slackDelivery: {
      configuredTargets: Number(slackTargets?.configured_targets ?? 0),
      usableTargets: Number(slackTargets?.usable_targets ?? 0),
      latestTargetSuccessAt: slackTargets?.latest_successful_delivery_at ?? null,
      recentAttempts: Number(slackDeliveries?.recent_attempts ?? 0),
      recentSent: Number(slackDeliveries?.recent_sent ?? 0),
      latestAttemptAt: slackDeliveries?.latest_at ?? null,
    },
    whatsappDelivery: {
      providerConfigured: isWhatsAppProviderConfigured(env),
      customerReady: isCustomerWhatsAppReady(env),
      webhookConfigured: isWhatsAppWebhookConfigured(env),
      configuredTargets: Number(whatsappTargets?.configured_targets ?? 0),
      usableTargets: Number(whatsappTargets?.usable_targets ?? 0),
      latestTargetSuccessAt: whatsappTargets?.latest_successful_delivery_at ?? null,
      recentAttempts: Number(whatsappDeliveries?.recent_attempts ?? 0),
      recentSent: Number(whatsappDeliveries?.recent_sent ?? 0),
      latestAttemptAt: whatsappDeliveries?.latest_at ?? null,
    },
    monitoring: {
      recentSuccessfulRuns: Number(watchlistRuns?.recent_count ?? 0),
      latestSucceededAt: watchlistRuns?.latest_at ?? null,
    },
  };
}
