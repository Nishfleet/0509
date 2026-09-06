/**
 * WP-26: monthly customer recap — "what you got this month" the day before renewal.
 * Runs on the first Monday UTC cron alongside weekly digests.
 */

import {
  claimInstantDeliveryAttempt,
  getDeliveryAttemptByIdempotencyKey,
  getUserDeliveryProfile,
  markInstantDeliveryDispatchStarted,
  updateDeliveryAttemptResult,
} from "~/lib/data.server";
import { queryAll as many, queryOne as one } from "~/lib/data/d1.server";
import {
  EMAIL_PROVIDER,
  appBaseUrl,
  escapeHtml,
  providerAcceptedAt,
  sendCloudflareEmail,
} from "~/lib/delivery-email-core.server";
import {
  EMAIL_CASE_BUTTON_STYLE,
  EMAIL_CASE_CARD_STYLE,
  EMAIL_CASE_EYEBROW_STYLE,
  EMAIL_CASE_INK,
  EMAIL_CASE_INK_FAINT,
  EMAIL_CASE_INK_SOFT,
  EMAIL_CASE_LINE,
  EMAIL_DISPLAY_FONT,
  EMAIL_MONO_FONT,
} from "~/lib/email-template.server";
import type { AppEnv } from "~/lib/env.server";
import { getIncludedEvidenceAllowance, parsePlanFamily } from "~/lib/plan-entitlements";
import { getUserPlan } from "~/lib/plan.server";

export interface MonthlyRecapStats {
  userId: string;
  email: string;
  name: string | null;
  plan: string;
  monthKey: string;
  periodStart: string;
  periodEnd: string;
  changesCaught: number;
  evidenceCaptured: number;
  includedAllowance: number;
  topCompetitorName: string | null;
  topCompetitorChanges: number;
}

export function isFirstMondayOfMonth(date: Date): boolean {
  // First Monday of the calendar month (UTC).
  return date.getUTCDay() === 1 && date.getUTCDate() <= 7;
}

/** Month being recapped: the previous calendar month relative to `now`. */
export function previousCalendarMonthKey(now: Date = new Date()): string {
  const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthBoundsUtc(monthKey: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) {
    throw new RangeError(`invalid monthKey: ${monthKey}`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

export function buildMonthlyRecapEmail(input: MonthlyRecapStats & { billingUrl: string }) {
  const monthLabel = formatMonthLabel(input.monthKey);
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";

  const subject = `Your ${monthLabel} recap — ${input.changesCaught} change${input.changesCaught === 1 ? "" : "s"} caught`;
  const preheader = `${input.changesCaught} changes, ${input.evidenceCaptured} evidence captures on ${input.plan}.`;
  // Lead with the hero number the subscription paid for. When a month caught no
  // changes but still ran proof captures, headline the captures instead of a
  // deflating "0".
  const heroValue = input.changesCaught > 0 ? input.changesCaught : input.evidenceCaptured;
  const heroLabel =
    input.changesCaught > 0
      ? `competitor change${input.changesCaught === 1 ? "" : "s"} caught in ${escapeHtml(monthLabel)}`
      : `proof capture${input.evidenceCaptured === 1 ? "" : "s"} run in ${escapeHtml(monthLabel)}`;
  const statRow = (label: string, value: string) => `
        <tr>
          <td style="font-family: ${EMAIL_MONO_FONT}; font-size: 12px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK_FAINT}; padding: 12px 0; border-top: 1px dotted ${EMAIL_CASE_LINE};">${label}</td>
          <td style="font-family: ${EMAIL_MONO_FONT}; font-size: 12px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK}; padding: 12px 0; border-top: 1px dotted ${EMAIL_CASE_LINE}; text-align: right; font-weight: 600;">${value}</td>
        </tr>`;
  const checksValue =
    input.includedAllowance > 0
      ? `${input.evidenceCaptured} of ${input.includedAllowance}`
      : `${input.evidenceCaptured}`;
  const topValue = input.topCompetitorName
    ? `${escapeHtml(input.topCompetitorName)} · ${input.topCompetitorChanges} change${input.topCompetitorChanges === 1 ? "" : "s"}`
    : "No single leader";
  const html = `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #fffdf8; color: #171611; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      <p style="${EMAIL_CASE_EYEBROW_STYLE}">Your ${escapeHtml(monthLabel)} recap</p>
      <p style="margin: 0 0 4px; font-family: ${EMAIL_DISPLAY_FONT}; font-size: 44px; line-height: 1.05; font-weight: 800; letter-spacing: -1px; color: ${EMAIL_CASE_INK};">${heroValue}</p>
      <p style="margin: 0 0 20px; font-size: 18px; line-height: 1.3; letter-spacing: -0.3px; color: ${EMAIL_CASE_INK}; font-weight: 700;">${heroLabel}</p>
      <p style="margin: 0 0 16px; color: ${EMAIL_CASE_INK_SOFT};">Here's what Five to Nine watched for you this month. No proof, no claim — every count below is computed from stored captures.</p>
      <div style="${EMAIL_CASE_CARD_STYLE}">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin: 0;">
          ${statRow("Changes caught", `${input.changesCaught}`)}
          ${statRow("Proof captures used", checksValue)}
          ${statRow("Most active competitor", topValue)}
        </table>
      </div>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.billingUrl)}" style="${EMAIL_CASE_BUTTON_STYLE}">Review usage &amp; billing</a>
      </p>
      <p style="margin: 0; font-family: ${EMAIL_MONO_FONT}; font-size: 12px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK_FAINT};">
        Counts are for this calendar month (UTC). Billing shows a rolling 30-day
        window, so the two views can differ slightly.
      </p>
    </div>
  `;
  const text = [
    input.name?.trim() ? `Hi ${input.name.trim()},` : "Hi,",
    "",
    `Here's what Five to Nine caught for you in ${monthLabel}.`,
    `Changes caught: ${input.changesCaught}`,
    input.includedAllowance > 0
      ? `Proof captures used: ${input.evidenceCaptured} of ${input.includedAllowance} included.`
      : `Proof captures: ${input.evidenceCaptured}.`,
    input.topCompetitorName
      ? `Most active competitor: ${input.topCompetitorName} (${input.topCompetitorChanges} changes).`
      : "No single competitor dominated this month.",
    "",
    "Every count above is computed from stored captures. No proof, no claim.",
    `Review usage: ${input.billingUrl}`,
  ].join("\n");

  return { subject, preheader, html, text };
}

function formatMonthLabel(monthKey: string): string {
  const { start } = monthBoundsUtc(monthKey);
  const d = new Date(start);
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export async function listPaidUsersForRecap(env: AppEnv): Promise<
  Array<{ userId: string; email: string; name: string | null; plan: string }>
> {
  const rows = await many<{
    user_id: string;
    email: string;
    name: string | null;
    plan: string;
  }>(
    env,
    `
      SELECT
        user_plan.user_id AS user_id,
        user.email AS email,
        user.name AS name,
        user_plan.plan AS plan
      FROM user_plan
      INNER JOIN user ON user.id = user_plan.user_id
      WHERE user_plan.plan IN ('scout', 'starter', 'agency')
        AND user.email IS NOT NULL
        AND TRIM(user.email) != ''
      ORDER BY user_plan.user_id ASC
    `,
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    name: row.name,
    plan: row.plan,
  }));
}

export async function loadMonthlyRecapStats(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    plan: string;
    monthKey: string;
  },
): Promise<MonthlyRecapStats | null> {
  const { start, end } = monthBoundsUtc(input.monthKey);
  const changesRow = await one<{ count: number }>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM watch_event
      INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
      WHERE watchlist.user_id = ?
        AND watch_event.created_at >= ?
        AND watch_event.created_at < ?
    `,
    input.userId,
    start,
    end,
  );
  const changesCaught = Number(changesRow?.count ?? 0);

  const topRow = await one<{ name: string; target_label: string | null; count: number }>(
    env,
    `
      SELECT watchlist.name AS name, watchlist.target_label AS target_label, COUNT(*) AS count
      FROM watch_event
      INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
      WHERE watchlist.user_id = ?
        AND watch_event.created_at >= ?
        AND watch_event.created_at < ?
      GROUP BY watchlist.id
      ORDER BY count DESC, watchlist.name ASC
      LIMIT 1
    `,
    input.userId,
    start,
    end,
  );

  const evidenceRow = await one<{ count: number }>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      WHERE watchlist.user_id = ?
        AND proof_capture.attempted_at >= ?
        AND proof_capture.attempted_at < ?
    `,
    input.userId,
    start,
    end,
  );
  const evidenceCaptured = Number(evidenceRow?.count ?? 0);
  // Included allowance is plan catalog (matches billing page), not a rolling DB counter.
  const plan = parsePlanFamily(input.plan);
  const includedAllowance = getIncludedEvidenceAllowance(plan);

  if (changesCaught <= 0 && evidenceCaptured <= 0) {
    return null;
  }

  return {
    userId: input.userId,
    email: input.email,
    name: input.name,
    plan: input.plan,
    monthKey: input.monthKey,
    periodStart: start,
    periodEnd: end,
    changesCaught,
    evidenceCaptured,
    includedAllowance,
    topCompetitorName: topRow
      ? (topRow.target_label?.trim() || topRow.name || null)
      : null,
    topCompetitorChanges: Number(topRow?.count ?? 0),
  };
}

export async function sendMonthlyCustomerRecaps(
  env: AppEnv,
  options: { scheduledTime?: number; force?: boolean } = {},
): Promise<{
  attempted: number;
  sent: number;
  skipped: number;
  duplicates: number;
  claimLost: number;
  failed: number;
}> {
  if (!env.DB) {
    return { attempted: 0, sent: 0, skipped: 0, duplicates: 0, claimLost: 0, failed: 0 };
  }

  const now =
    options.scheduledTime === undefined ? new Date() : new Date(options.scheduledTime);
  if (!options.force && !isFirstMondayOfMonth(now)) {
    return { attempted: 0, sent: 0, skipped: 0, duplicates: 0, claimLost: 0, failed: 0 };
  }

  const monthKey = previousCalendarMonthKey(now);
  const users = await listPaidUsersForRecap(env);
  let attempted = 0;
  let sent = 0;
  let skipped = 0;
  let duplicates = 0;
  let claimLost = 0;
  let failed = 0;
  const billingUrl = `${appBaseUrl(env)}/app/billing`;

  for (const user of users) {
    attempted += 1;
    try {
      // Prefer live plan in case catalog drifted from list query snapshot.
      let plan = user.plan;
      try {
        plan = await getUserPlan(env, user.userId);
      } catch {
        // keep listed plan
      }
      if (plan === "free") {
        skipped += 1;
        continue;
      }

      const profile = await getUserDeliveryProfile(env, user.userId);
      const email = profile?.email?.trim() || user.email;
      const name = profile?.name ?? user.name;

      const stats = await loadMonthlyRecapStats(env, {
        userId: user.userId,
        email,
        name,
        plan,
        monthKey,
      });
      if (!stats) {
        skipped += 1;
        continue;
      }

      const result = await sendOneMonthlyRecap(env, {
        ...stats,
        billingUrl,
      });
      if (result.reason === "duplicate") {
        duplicates += 1;
      } else if (result.reason === "claim_lost") {
        claimLost += 1;
      } else if (result.sent) {
        sent += 1;
      } else if (
        result.reason === "unverified" ||
        result.reason === "disabled" ||
        result.reason === "missing_email"
      ) {
        skipped += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `Monthly recap failed for user ${user.userId}; continuing with remaining users.`,
        error,
      );
    }
  }

  return { attempted, sent, skipped, duplicates, claimLost, failed };
}

async function sendOneMonthlyRecap(
  env: AppEnv,
  stats: MonthlyRecapStats & { billingUrl: string },
) {
  // FIX-5: mirror scan-trouble gates — verified email, opt-out, List-Unsubscribe.
  const { isUserEmailVerified } = await import("~/lib/email-verification.server");
  if (!(await isUserEmailVerified(env, stats.userId))) {
    return { sent: false as const, reason: "unverified" as const };
  }

  const { getWorkspaceDeliveryConfig } = await import("~/lib/data.server");
  const workspaceConfig = await getWorkspaceDeliveryConfig(env, stats.userId);
  if (workspaceConfig && !workspaceConfig.emailEnabled) {
    return { sent: false as const, reason: "disabled" as const };
  }

  const { resolveDigestEmailTargets } = await import("~/lib/delivery.server");
  const emailTargets = await resolveDigestEmailTargets(
    env,
    stats.userId,
    stats.email.trim().toLowerCase() || null,
  );
  const primaryTarget = emailTargets[0] ?? null;
  if (!primaryTarget) {
    return { sent: false as const, reason: "disabled" as const };
  }
  const recipient = primaryTarget.targetValue.trim().toLowerCase();
  if (!recipient) {
    return { sent: false as const, reason: "missing_email" as const };
  }

  let unsubscribeUrl: string | null = null;
  if (primaryTarget?.id) {
    try {
      const { buildUnsubscribeUrl } = await import("~/lib/unsubscribe.server");
      unsubscribeUrl = await buildUnsubscribeUrl(env, {
        userId: stats.userId,
        targetId: primaryTarget.id,
      });
    } catch {
      unsubscribeUrl = null;
    }
  }

  const idempotencyKey = `recap:${stats.userId}:${stats.monthKey}`;
  const claim = await claimInstantDeliveryAttempt(env, {
    userId: stats.userId,
    watchlistId: null,
    deliveryTargetId: primaryTarget?.id ?? null,
    lane: "customer",
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: recipient,
    templateName: "monthly_recap",
    eventIds: [],
    payloadSnapshot: {
      kind: "monthly_recap",
      monthKey: stats.monthKey,
      changesCaught: stats.changesCaught,
      evidenceCaptured: stats.evidenceCaptured,
    },
    idempotencyKey,
  });
  if (!claim.attemptId || !claim.claimUpdatedAt) {
    return { sent: false as const, reason: "duplicate" as const };
  }

  const dispatchStartedAt = await markInstantDeliveryDispatchStarted(
    env,
    claim.attemptId,
    claim.claimUpdatedAt,
  );
  if (!dispatchStartedAt) {
    const durableAttempt = await getDeliveryAttemptByIdempotencyKey(
      env,
      idempotencyKey,
    );
    const anotherOwnerAdvanced =
      durableAttempt !== null &&
      (
        durableAttempt.status !== "pending" ||
        durableAttempt.webhookStatus !== "pending" ||
        durableAttempt.updatedAt !== claim.claimUpdatedAt
      );
    if (!anotherOwnerAdvanced) {
      console.error("Monthly recap dispatch gate rejected.", {
        userId: stats.userId,
        reason: "dispatch_gate_rejected",
        durableAttemptPresent: durableAttempt !== null,
      });
    }
    return {
      sent: false as const,
      reason: anotherOwnerAdvanced
        ? ("claim_lost" as const)
        : ("dispatch_gate_rejected" as const),
    };
  }

  const model = buildMonthlyRecapEmail(stats);
  const providerResult = await sendCloudflareEmail(env, {
    to: recipient,
    subject: model.subject,
    html: model.html,
    text: model.text,
    tag: "monthly_recap",
    unsubscribeUrl,
    theme: "case-file",
  });

  const finalized = await updateDeliveryAttemptResult(env, claim.attemptId, {
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    payloadSnapshot: {
      kind: "monthly_recap",
      monthKey: stats.monthKey,
      changesCaught: stats.changesCaught,
      evidenceCaptured: stats.evidenceCaptured,
    },
    targetValue: recipient,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatchStartedAt,
  });

  return {
    sent: Boolean(finalized && providerResult.status === "sent"),
    reason: providerResult.status === "sent" ? ("sent" as const) : ("failed" as const),
  };
}
