import type { AppEnv } from "~/lib/env.server";
import {
  getDeliveryAttemptByIdempotencyKey,
  getOperatorRiskSummary,
  getWeeklyBusinessSummary,
} from "~/lib/data.server";
import { sendOperatorAlertEmail } from "~/lib/delivery.server";
import { previewDodo0509PlanPrices } from "~/lib/dodo-pricing.server";
import {
  formatScheduledObservationHealthLines,
  listScheduledObservationHealth,
} from "~/lib/scheduled-observation-health.server";

// Runs after scheduled monitoring: when paying customers' scans or
// deliveries are degrading, the operator hears about it instead of finding
// out from a churn email.
export function buildWeeklyBusinessLines(
  summary: Awaited<ReturnType<typeof getWeeklyBusinessSummary>>,
  options: { annualValidationDriftLines?: string[] } = {},
) {
  const paying =
    summary.payingByPlan.length > 0
      ? summary.payingByPlan
          .map((entry) => `${entry.plan}: ${entry.count}`)
          .join(", ")
      : "none yet";
  const digestRate =
    summary.digestAttempts7d > 0
      ? `${Math.round((summary.digestSent7d / summary.digestAttempts7d) * 100)}% (${summary.digestSent7d}/${summary.digestAttempts7d})`
      : "no digests sent";

  const lines = [
    `Signups (7d): ${summary.signups7d} — activated onboarding: ${summary.activated7d}`,
    `Paying customers: ${paying}`,
    `Dunning (payment trouble, plan kept): ${summary.dunningCount}`,
    `Dropped to free (7d, had billing history): ${summary.revokedToFree7d}`,
    `Digest delivery success (7d): ${digestRate}`,
    `Oldest active paid-watchlist scan: ${summary.oldestActivePaidScanAt ?? "n/a"}`,
  ];
  if (options.annualValidationDriftLines?.length) {
    lines.push(...options.annualValidationDriftLines);
  }
  return lines;
}

/** WP-38: surface annual price drift (not 8× monthly) in the operator email. */
export function formatAnnualValidationDriftLines(
  annualValidation:
    | Partial<
        Record<
          "scout" | "starter" | "agency",
          { valid: boolean; reason: string }
        >
      >
    | null
    | undefined,
): string[] {
  if (!annualValidation) {
    return ["Annual validation: unavailable"];
  }
  const drifts: string[] = [];
  for (const plan of ["scout", "starter", "agency"] as const) {
    const entry = annualValidation[plan];
    if (!entry) {
      drifts.push(`${plan}: missing`);
      continue;
    }
    if (!entry.valid) {
      drifts.push(`${plan}: ${entry.reason}`);
    }
  }
  if (drifts.length === 0) {
    return ["Annual validation: ok (pay-8 months)"];
  }
  return [`Annual validation drift: ${drifts.join("; ")}`];
}

export async function sendWeeklyBusinessNumbers(env: AppEnv) {
  if (!env.DB) {
    return { sent: false, reason: "no_db" };
  }

  const summary = await getWeeklyBusinessSummary(env);
  let scheduledObservationHealthLines = [
    "Scheduled-work heartbeat: unavailable",
  ];
  try {
    scheduledObservationHealthLines = formatScheduledObservationHealthLines(
      await listScheduledObservationHealth(env),
    );
  } catch {
    scheduledObservationHealthLines = [
      "Scheduled-work heartbeat: health read failed",
    ];
  }
  let annualValidationDriftLines: string[] = ["Annual validation: unavailable"];
  try {
    // Operator email is not browser-country scoped; use a stable India request
    // so annual 8× monthly validation still surfaces product/config drift.
    const pricingRequest = new Request("https://0509.io/ops/weekly-business", {
      headers: { "cf-ipcountry": "IN" },
    });
    const preview = await previewDodo0509PlanPrices({
      env,
      request: pricingRequest,
    });
    annualValidationDriftLines = formatAnnualValidationDriftLines(
      preview.annualValidation,
    );
  } catch {
    annualValidationDriftLines = ["Annual validation: preview_failed"];
  }
  const weekStamp = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `business-weekly:${weekStamp}`;
  const sent = await sendOperatorAlertEmail(env, {
    subject: "Five to Nine — weekly business numbers",
    lines: [
      ...buildWeeklyBusinessLines(summary, { annualValidationDriftLines }),
      ...scheduledObservationHealthLines,
    ],
    idempotencyKey,
  });

  if (sent) {
    return { sent: true, reason: "sent" as const };
  }

  try {
    const durableAttempt = await getDeliveryAttemptByIdempotencyKey(
      env,
      idempotencyKey,
    );
    if (durableAttempt?.status === "sent") {
      return { sent: false, reason: "duplicate" as const };
    }
  } catch {
    return { sent: false, reason: "delivery_state_unavailable" as const };
  }

  return { sent: false, reason: "delivery_failed" as const };
}

export async function sendCustomerAtRiskAlert(
  env: AppEnv,
  options: {
    skippedForBudget?: number;
    dispatchFailures?: number;
    inlineFailures?: number;
    digestFailures?: number;
    idempotencyKey?: string;
  } = {},
) {
  if (!env.DB) {
    return { sent: false, reason: "no_db" };
  }

  const summary = await getOperatorRiskSummary(env);
  const lines: string[] = [];

  if ((options.skippedForBudget ?? 0) > 0) {
    lines.push(
      `${options.skippedForBudget} watchlist(s) were SKIPPED in a recent scheduled scan window because the check window filled — review volume must be expanded before adding more watchlists (revive the Workflow path).`,
    );
  }
  if ((options.dispatchFailures ?? 0) > 0) {
    lines.push(
      `${options.dispatchFailures} watchlist fan-out job(s) failed to dispatch in a recent scheduled scan window; reconciliation will retry, but the Workflow dispatch path needs attention.`,
    );
  }
  if ((options.inlineFailures ?? 0) > 0) {
    lines.push(
      `${options.inlineFailures} inline scheduled scan(s) failed before completion.`,
    );
  }
  if ((options.digestFailures ?? 0) > 0) {
    lines.push(
      `${options.digestFailures} scheduled digest(s) failed before delivery.`,
    );
  }

  for (const watchlist of summary.staleWatchlists) {
    lines.push(
      `Watchlist "${watchlist.name}" (${watchlist.userEmail}) has not been scanned since ${watchlist.lastScannedAt ?? "creation"} — likely budget-skipped or cron trouble.`,
    );
  }

  for (const watchlist of summary.troubleWatchlists) {
    lines.push(
      `Watchlist "${watchlist.name}" (${watchlist.userEmail}) has failed ${watchlist.consecutiveFailures} scans in a row.`,
    );
  }
  if (summary.deliveryFailures24h > 0) {
    lines.push(
      `${summary.deliveryFailures24h} customer delivery attempt(s) failed in the last 24h.`,
    );
  }
  if (summary.stuckRuns > 0) {
    lines.push(
      `${summary.stuckRuns} watchlist run(s) look stuck (pending/running for over an hour).`,
    );
  }

  if (lines.length === 0) {
    return { sent: false, reason: "all_clear" };
  }

  const idempotencyKey =
    options.idempotencyKey ??
    `operator-alert:${new Date().toISOString().slice(0, 10)}`;
  const sent = await sendOperatorAlertEmail(env, {
    subject: `0509 customer-at-risk: ${lines.length} signal${lines.length === 1 ? "" : "s"}`,
    lines,
    idempotencyKey,
  });

  if (sent) {
    return { sent: true, reason: "sent" as const, signals: lines.length };
  }

  try {
    const durableAttempt = await getDeliveryAttemptByIdempotencyKey(
      env,
      idempotencyKey,
    );
    if (durableAttempt?.status === "sent") {
      return {
        sent: false,
        reason: "duplicate" as const,
        signals: lines.length,
      };
    }
  } catch {
    return {
      sent: false,
      reason: "delivery_state_unavailable" as const,
      signals: lines.length,
    };
  }

  return {
    sent: false,
    reason: "delivery_failed" as const,
    signals: lines.length,
  };
}
