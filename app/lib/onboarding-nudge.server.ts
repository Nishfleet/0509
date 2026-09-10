import {
  claimInstantDeliveryAttempt,
  getWorkspaceDeliveryConfig,
  markInstantDeliveryDispatchStarted,
  updateDeliveryAttemptResult,
} from "~/lib/data.server";
import {
  normalizeDeliveryEmail,
  resolveActivationEmailTarget,
} from "~/lib/delivery-account-emails.server";
import {
  EMAIL_PROVIDER,
  appBaseUrl,
  escapeHtml,
  providerAcceptedAt,
  sendCloudflareEmail,
} from "~/lib/delivery-email-core.server";
import type { AppEnv } from "~/lib/env.server";
import { queryAll } from "~/lib/data/d1.server";
import { safeTimeZone } from "~/lib/safe-timezone";
import { allowlistedSignupSource } from "~/lib/signup-source";
import { SUPPORT_EMAIL } from "~/lib/support";

/**
 * Abandoned-onboarding nudge (issue #2114).
 *
 * One plain-text-first email to users who signed up 24 to 48 hours ago and
 * have not added a single watchlist. Idempotent per user via the
 * `delivery_attempt` row keyed `onboarding-nudge:<userId>` (template
 * `onboarding_nudge`), so a user can receive exactly one nudge, ever, no
 * matter how many times the sweep runs.
 *
 * Rides the existing daily cron (see workers/app.ts). The send window is
 * 09:00 to 11:00 in the user's workspace delivery timezone, defaulting to
 * IST (Asia/Kolkata) when no timezone is set, per Nish's binding additions.
 */

const IDEMPOTENCY_PREFIX = "onboarding-nudge:";
const TEMPLATE_NAME = "onboarding_nudge";
const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** Real, public, dated change Five to Nine caught (verified at /timeline/nike.com). */
const PROOF_BRAND = "Nike";
const PROOF_DATE = "10 Sept 2026";
const PROOF_CHANGE = "switched its site call-to-action from Shop Now to Contact Us and dropped its $149 price";

export interface AbandonedOnboardingUser {
  id: string;
  email: string;
  name: string;
  signupSource: string | null;
}

export interface OnboardingNudgeSweepResult {
  selected: number;
  sent: number;
  skipped: number;
  failed: number;
  reasons: string[];
}

/**
 * Users created 24 to 48 hours ago with zero watchlists and no prior
 * onboarding-nudge delivery_attempt. The NOT EXISTS guards keep the sweep
 * from re-selecting a user who already received (or was already attempted
 * for) the nudge.
 */
export async function listAbandonedOnboardingUsers(
  env: AppEnv,
  now: Date,
): Promise<AbandonedOnboardingUser[]> {
  const nowMs = now.getTime();
  const since = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();
  const until = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

  const rows = await queryAll<{
    id: string;
    email: string;
    name: string;
    signup_source: string | null;
  }>(
    env,
    `
      SELECT u.id, u.email, u.name, u.signup_source
      FROM user u
      WHERE u.createdAt >= ?
        AND u.createdAt <= ?
        AND NOT EXISTS (
          SELECT 1 FROM watchlist w WHERE w.user_id = u.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM delivery_attempt da
          WHERE da.user_id = u.id AND da.template_name = ?
        )
      ORDER BY u.createdAt ASC
      LIMIT 200
    `,
    since,
    until,
    TEMPLATE_NAME,
  );

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    signupSource: allowlistedSignupSource(row.signup_source),
  }));
}

/**
 * True when the given instant falls in the 09:00 to 11:00 local window for
 * the user's timezone (defaulting to IST). The daily cron fires once at
 * 04:00 UTC, which is 09:30 IST, so the default user lands inside the
 * window. A user whose configured timezone puts 04:00 UTC outside 09 to 11
 * local is skipped this run rather than emailed at an unreasonable hour.
 */
export function isWithinSendWindow(
  instant: Date,
  timezone: string | null | undefined,
): boolean {
  const tz = safeTimeZone(timezone) ?? DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const hourPart = parts.find((part) => part.type === "hour");
  const hour = Number(hourPart?.value ?? NaN);
  if (Number.isNaN(hour)) {
    return false;
  }
  return hour >= 9 && hour < 11;
}

async function resolveUserTimezone(env: AppEnv, userId: string): Promise<string | null> {
  const config = await getWorkspaceDeliveryConfig(env, userId);
  return config?.timezone ?? null;
}

function buildSearchUrl(base: string, signupSource: string | null): string {
  const url = new URL("/search", base);
  if (signupSource) {
    url.searchParams.set("source", signupSource);
  }
  return url.toString();
}

function buildNudgeText(input: {
  name: string | null;
  searchUrl: string;
}): string {
  const greeting = input.name?.trim() ? `Hi ${input.name.trim()},` : "Hi,";
  return [
    greeting,
    "",
    `Add a competitor and Five to Nine watches its Meta Ad Library ads and emails you the moment they change. We caught one this week: on ${PROOF_DATE}, ${PROOF_BRAND} ${PROOF_CHANGE}. That is the kind of alert you would get for your own competitors.`,
    "",
    `Add your first competitor: ${input.searchUrl}`,
    "",
    "Nish",
    "Five to Nine",
  ].join("\n");
}

function buildNudgeHtml(input: {
  name: string | null;
  searchUrl: string;
}): string {
  const greeting = input.name?.trim()
    ? `Hi ${escapeHtml(input.name.trim())},`
    : "Hi,";
  return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      <p style="margin: 0 0 16px;">
        Add a competitor and Five to Nine watches its Meta Ad Library ads and emails you the moment they change. We caught one this week: on ${escapeHtml(PROOF_DATE)}, <strong>${escapeHtml(PROOF_BRAND)}</strong> ${escapeHtml(PROOF_CHANGE)}. That is the kind of alert you would get for your own competitors.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${escapeHtml(input.searchUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 11px 20px; border-radius: 8px; font-weight: 600; font-size: 15px;">Add your first competitor</a>
      </p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">
        Nish, Five to Nine. Need help? Reply to this email or write ${escapeHtml(SUPPORT_EMAIL)}.
      </p>
    </div>
  `;
}

const NUDGE_SUBJECT = "Nike changed its ad this week";

export async function sendOnboardingNudgeEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    signupSource: string | null;
  },
): Promise<{ sent: boolean; reason: string }> {
  const recipient = normalizeDeliveryEmail(input.email);
  if (!recipient) {
    return { sent: false, reason: "missing_email" };
  }

  const targetResolution = await resolveActivationEmailTarget(env, input.userId, recipient);
  if (!targetResolution.target) {
    return { sent: false, reason: targetResolution.reason ?? "target_unavailable" };
  }
  const deliveryTarget = targetResolution.target;

  const idempotencyKey = `${IDEMPOTENCY_PREFIX}${input.userId}`;
  const claim = await claimInstantDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    deliveryTargetId: deliveryTarget.id,
    lane: "customer",
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: recipient,
    templateName: TEMPLATE_NAME,
    eventIds: [],
    payloadSnapshot: { kind: "onboarding_nudge" },
    idempotencyKey,
  });
  if (!claim.attemptId || !claim.claimUpdatedAt) {
    if (claim.duplicate?.status === "sent") {
      return { sent: true, reason: "already_sent" };
    }
    return { sent: false, reason: "duplicate" };
  }

  const dispatchStartedAt = await markInstantDeliveryDispatchStarted(
    env,
    claim.attemptId,
    claim.claimUpdatedAt,
  );
  if (!dispatchStartedAt) {
    return { sent: false, reason: "claim_lost" };
  }

  const base = appBaseUrl(env);
  const searchUrl = buildSearchUrl(base, input.signupSource);

  let unsubscribeUrl: string | null = null;
  try {
    const { buildUnsubscribeUrl } = await import("~/lib/unsubscribe.server");
    unsubscribeUrl = await buildUnsubscribeUrl(env, {
      userId: input.userId,
      targetId: deliveryTarget.id,
    });
  } catch {
    unsubscribeUrl = null;
  }

  const providerResult = await sendCloudflareEmail(env, {
    to: recipient,
    subject: NUDGE_SUBJECT,
    html: buildNudgeHtml({ name: input.name, searchUrl }),
    text: buildNudgeText({ name: input.name, searchUrl }),
    tag: "onboarding-nudge",
    unsubscribeUrl,
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
    payloadSnapshot: { kind: "onboarding_nudge" },
    targetValue: recipient,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatchStartedAt,
  });

  return {
    sent: Boolean(finalized && providerResult.status === "sent"),
    reason: providerResult.status === "sent" ? "sent" : "failed",
  };
}

/**
 * Daily sweep: select abandoned-onboarding users, gate each on the 09:00 to
 * 11:00 local send window, and send exactly one nudge. A user outside the
 * window is skipped (counted, not failed) so the daily cron does not email
 * at an unreasonable local hour.
 */
export async function runOnboardingNudgeSweep(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<OnboardingNudgeSweepResult> {
  const now = options.now ?? new Date();
  const users = await listAbandonedOnboardingUsers(env, now);

  const result: OnboardingNudgeSweepResult = {
    selected: users.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    reasons: [],
  };

  for (const user of users) {
    const timezone = await resolveUserTimezone(env, user.id);
    if (!isWithinSendWindow(now, timezone)) {
      result.skipped += 1;
      result.reasons.push(`send_window:${user.id}`);
      continue;
    }

    try {
      const outcome = await sendOnboardingNudgeEmail(env, {
        userId: user.id,
        email: user.email,
        name: user.name,
        signupSource: user.signupSource,
      });
      if (outcome.sent) {
        result.sent += 1;
      } else if (outcome.reason === "already_sent" || outcome.reason === "duplicate") {
        result.skipped += 1;
      } else {
        result.failed += 1;
        result.reasons.push(`${outcome.reason}:${user.id}`);
      }
    } catch (error) {
      result.failed += 1;
      result.reasons.push(
        `exception:${user.id}:${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  return result;
}
