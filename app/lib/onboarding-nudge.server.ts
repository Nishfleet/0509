import {
  claimInstantDeliveryAttempt,
  getWorkspaceDeliveryConfig,
  markInstantDeliveryDispatchStarted,
  updateDeliveryAttemptResult,
} from "~/lib/data/delivery-records.server";
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
import { normalizeTimeZone } from "~/lib/safe-timezone";
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
  // Default to IST when the user's timezone is unknown or invalid (Nish's
  // binding addition #7: "else IST"). normalizeTimeZone returns null for
  // empty/invalid names, so the ?? fallback actually applies — safeTimeZone
  // would silently return "UTC" and defeat the IST default.
  const tz = normalizeTimeZone(timezone) ?? DEFAULT_TIMEZONE;
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
    `Add a competitor and Five to Nine watches its Meta Ad Library ads and emails you the moment they change. We caught one this week: on ${PROOF_DATE}, ${PROOF_BRAND} ${PROOF_CHANGE}. Right now your competitors are making moves just like this. You just can't see them yet.`,
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
        Add a competitor and Five to Nine watches its Meta Ad Library ads and emails you the moment they change. We caught one this week: on ${escapeHtml(PROOF_DATE)}, <strong>${escapeHtml(PROOF_BRAND)}</strong> ${escapeHtml(PROOF_CHANGE)}. Right now your competitors are making moves just like this. You just can't see them yet.
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

/**
 * Paused-watchlist re-engagement (issue #2115).
 *
 * One plain-text-first email to users who own at least one watchlist that
 * has been paused for 14 days or more and have no prior re-engagement
 * attempt. Idempotent per user via the `delivery_attempt` row keyed
 * `watchlist-resume:<userId>` (template `watchlist_resume`), so a user can
 * receive exactly one resume email, ever, no matter how many times the
 * sweep runs.
 *
 * Rides the same daily cron as the abandoned-onboarding nudge (see
 * workers/app.ts) and the same 09:00 to 11:00 local send window (IST
 * default). No auto-resume, no plan/gating changes, no discount or pricing
 * copy — the email only states the paused count and points at the resume
 * path.
 */

const RESUME_IDEMPOTENCY_PREFIX = "watchlist-resume:";
const RESUME_TEMPLATE_NAME = "watchlist_resume";
const PAUSED_DAYS_THRESHOLD = 14;

/** A user who owns at least one watchlist paused for 14+ days. */
export interface PausedWatchlistUser {
  id: string;
  email: string;
  name: string;
  pausedCount: number;
}

export interface WatchlistResumeSweepResult {
  selected: number;
  sent: number;
  skipped: number;
  failed: number;
  reasons: string[];
}

/**
 * Users owning at least one watchlist paused for 14+ days with no prior
 * watchlist-resume delivery_attempt. A watchlist is paused when
 * `is_active = 0`; pausing stamps `updated_at`, so a row whose `updated_at`
 * is at least 14 days old has been paused that long. The NOT EXISTS guard
 * keeps the sweep from re-selecting a user who already received (or was
 * already attempted for) the resume email.
 */
export async function listPausedWatchlistUsers(
  env: AppEnv,
  now: Date,
): Promise<PausedWatchlistUser[]> {
  const pausedBefore = new Date(
    now.getTime() - PAUSED_DAYS_THRESHOLD * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = await queryAll<{
    id: string;
    email: string;
    name: string;
    paused_count: number;
  }>(
    env,
    `
      SELECT u.id, u.email, u.name, COUNT(w.id) AS paused_count
      FROM user u
      JOIN watchlist w ON w.user_id = u.id
      WHERE w.is_active = 0
        AND w.updated_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM delivery_attempt da
          WHERE da.user_id = u.id AND da.template_name = ?
        )
      GROUP BY u.id, u.email, u.name
      ORDER BY u.createdAt ASC
      LIMIT 200
    `,
    pausedBefore,
    RESUME_TEMPLATE_NAME,
  );

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    pausedCount: Number(row.paused_count),
  }));
}

function buildResumeText(input: {
  name: string | null;
  pausedCount: number;
  watchlistsUrl: string;
}): string {
  const greeting = input.name?.trim() ? `Hi ${input.name.trim()},` : "Hi,";
  const countLabel =
    input.pausedCount === 1
      ? "1 of your watchlists"
      : `${input.pausedCount} of your watchlists`;
  return [
    greeting,
    "",
    `${countLabel} has been paused for a while, so Five to Nine has stopped watching those competitors for you.`, 
    "",
    `Resume watching to keep getting alerts the moment they change: ${input.watchlistsUrl}`,
    "",
    "Nish",
    "Five to Nine",
  ].join("\n");
}

function buildResumeHtml(input: {
  name: string | null;
  pausedCount: number;
  watchlistsUrl: string;
}): string {
  const greeting = input.name?.trim()
    ? `Hi ${escapeHtml(input.name.trim())},`
    : "Hi,";
  const countLabel =
    input.pausedCount === 1
      ? "1 of your watchlists"
      : `${input.pausedCount} of your watchlists`;
  return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      <p style="margin: 0 0 16px;">
        ${escapeHtml(countLabel)} has been paused for a while, so Five to Nine has stopped watching those competitors for you.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${escapeHtml(input.watchlistsUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 11px 20px; border-radius: 8px; font-weight: 600; font-size: 15px;">Resume watching</a>
      </p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">
        Nish, Five to Nine. Need help? Reply to this email or write ${escapeHtml(SUPPORT_EMAIL)}.
      </p>
    </div>
  `;
}

const RESUME_SUBJECT = "Your paused watchlists are waiting";

/**
 * Send one watchlist-resume email to a user. Idempotent per user via the
 * `watchlist-resume:<userId>` delivery_attempt key, so a user can receive
 * exactly one resume email, ever.
 */
export async function sendWatchlistResumeEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    pausedCount: number;
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

  const idempotencyKey = `${RESUME_IDEMPOTENCY_PREFIX}${input.userId}`;
  const claim = await claimInstantDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    deliveryTargetId: deliveryTarget.id,
    lane: "customer",
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: recipient,
    templateName: RESUME_TEMPLATE_NAME,
    eventIds: [],
    payloadSnapshot: { kind: "watchlist_resume" },
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
  const watchlistsUrl = new URL("/app/watchlists", base).toString();

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
    subject: RESUME_SUBJECT,
    html: buildResumeHtml({ name: input.name, pausedCount: input.pausedCount, watchlistsUrl }),
    text: buildResumeText({ name: input.name, pausedCount: input.pausedCount, watchlistsUrl }),
    tag: "watchlist-resume",
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
    payloadSnapshot: { kind: "watchlist_resume" },
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
 * Daily sweep: select paused-watchlist users, gate each on the 09:00 to
 * 11:00 local send window, and send exactly one resume email. A user
 * outside the window is skipped (counted, not failed) so the daily cron
 * does not email at an unreasonable local hour.
 */
export async function runWatchlistResumeSweep(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<WatchlistResumeSweepResult> {
  const now = options.now ?? new Date();
  const users = await listPausedWatchlistUsers(env, now);

  const result: WatchlistResumeSweepResult = {
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
      const outcome = await sendWatchlistResumeEmail(env, {
        userId: user.id,
        email: user.email,
        name: user.name,
        pausedCount: user.pausedCount,
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
