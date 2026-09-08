import {
  claimInstantDeliveryAttempt,
  createDeliveryAttempt,
  getDeliveryAttemptByIdempotencyKey,
  getOldestUserId,
  getUserDeliveryProfile,
  getUserIdByEmail,
  markInstantDeliveryDispatchStarted,
  updateDeliveryAttemptResult,
} from "~/lib/data.server";
import * as deliveryData from "~/lib/data.server";
import {
  EMAIL_PROVIDER,
  appBaseUrl,
  escapeHtml,
  providerAcceptedAt,
  sendCloudflareEmail,
} from "~/lib/delivery-email-core.server";
import type { AppEnv } from "~/lib/env.server";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

// Operator + account transactional emails: operator at-risk alerts, delivery
// test sends, account security notices, team invites, password reset, and
// email verification. Product code imports these via the ~/lib/delivery.server
// facade.

const SUPPORT_CASE_IDEMPOTENCY_PREFIX = "support-case:";
const SUPPORT_CASE_REOPEN_IDEMPOTENCY_PREFIX = "support-case-reopen:";

// Shared surface + type tokens for the transactional/account body copy so every
// account email reads as one system. The send-time shell (renderEmailShell)
// supplies the outer white card and footer; these style the inner content.
const ACCOUNT_BODY_STYLE =
  "font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;";
const ACCOUNT_CTA_STYLE =
  "display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 11px 20px; border-radius: 8px; font-weight: 600; font-size: 15px;";
const ACCOUNT_FOOTNOTE_STYLE = "margin: 0; color: #5b6577; font-size: 13px;";

function accountGreeting(name: string | null): string {
  return name?.trim() ? `Hi ${escapeHtml(name.trim())},` : "Hi,";
}

export function renderOperatorAlertHtml(input: {
  intro?: string;
  lines: string[];
}): string {
  return `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 14px; line-height: 1.6;">
        <p style="margin: 0 0 12px;"><strong>${escapeHtml(input.intro ?? "Customer-at-risk signals from recent monitoring:")}</strong></p>
        <ul style="margin: 0 0 12px; padding-left: 18px;">
          ${input.lines.map((line) => `<li style="margin: 0 0 6px;">${escapeHtml(line)}</li>`).join("")}
        </ul>
        <p style="margin: 0; color: #5b6577; font-size: 12px;">
          Details: https://0509.io/ops
        </p>
      </div>
    `;
}

// One daily "customer-at-risk" email to the operator when monitoring or
// delivery is degrading for paying customers — the ops dashboard is
// pull-only and nobody is paged to it. Day-keyed idempotency: max one/day.
export type OperatorAlertEmailOutcome =
  | "accepted"
  | "already_accepted"
  | "in_flight_or_unknown"
  | "rejected";

export async function readOperatorAlertEmailOutcome(
  env: AppEnv,
  idempotencyKey: string,
) {
  const attempt = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  if (!attempt) return null;
  if (attempt.status === "sent") {
    return {
      outcome: "already_accepted" as const,
      observedAt: attempt.sentAt ?? attempt.updatedAt,
    };
  }
  if (attempt.webhookStatus === "provider_unknown") {
    return {
      outcome: "in_flight_or_unknown" as const,
      observedAt: attempt.updatedAt,
    };
  }
  if (attempt.status === "failed" && attempt.webhookStatus === "failed") {
    return {
      outcome: "rejected" as const,
      observedAt: attempt.failedAt ?? attempt.updatedAt,
    };
  }
  return {
    outcome: "in_flight_or_unknown" as const,
    observedAt: attempt.updatedAt,
  };
}

export async function sendOperatorAlertEmailDetailed(
  env: AppEnv,
  input: {
    subject: string;
    lines: string[];
    idempotencyKey?: string;
    intro?: string;
  },
) {
  const recipient = env.LAUNCH_CANARY_EMAIL?.trim();
  if (!recipient) {
    return "rejected" as const;
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const idempotencyKey = input.idempotencyKey ?? `operator-alert:${dayKey}`;
  // delivery_attempt.user_id carries a foreign key to user(id), so the
  // attempt must be attributed to a REAL user row: the operator's own account
  // when it exists, else the oldest account (the founder's). Without this the
  // operator-alert insert violated the FK — the email sent but the dedupe row never
  // persisted and the logs claimed failure.
  const attemptUserId =
    (await getUserIdByEmail(env, recipient)) ?? (await getOldestUserId(env));
  if (!attemptUserId) {
    // Never call the provider when the alert cannot first be durably owned.
    return "rejected" as const;
  }

  const payloadSnapshot = operatorAlertPayloadSnapshot(idempotencyKey, input.lines);
  const claim = await claimInstantDeliveryAttempt(env, {
    userId: attemptUserId,
    watchlistId: null,
    deliveryTargetId: null,
    lane: "internal",
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: recipient,
    templateName: "operator_alert",
    eventIds: [],
    payloadSnapshot,
    idempotencyKey,
  });
  if (!claim.attemptId || !claim.claimUpdatedAt) {
    return claim.duplicate?.status === "sent"
      ? ("already_accepted" as const)
      : ("in_flight_or_unknown" as const);
  }

  const dispatchStartedAt = await markInstantDeliveryDispatchStarted(
    env,
    claim.attemptId,
    claim.claimUpdatedAt,
  );
  if (!dispatchStartedAt) {
    return "in_flight_or_unknown" as const;
  }

  const providerResult = await sendCloudflareEmail(env, {
    to: recipient,
    subject: input.subject,
    html: renderOperatorAlertHtml(input),
    tag: "operator-alert",
    unsubscribeUrl: null,
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
    payloadSnapshot,
    targetValue: recipient,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatchStartedAt,
  });

  if (!finalized) {
    return "in_flight_or_unknown" as const;
  }
  if (providerResult.status === "sent") {
    return "accepted" as const;
  }
  return providerResult.webhookStatus === "provider_unknown"
    ? ("in_flight_or_unknown" as const)
    : ("rejected" as const);
}

export async function sendOperatorAlertEmail(
  env: AppEnv,
  input: {
    subject: string;
    lines: string[];
    idempotencyKey?: string;
    intro?: string;
  },
) {
  return (await sendOperatorAlertEmailDetailed(env, input)) === "accepted";
}

function operatorAlertPayloadSnapshot(idempotencyKey: string, lines: string[]) {
  if (idempotencyKey.startsWith(SUPPORT_CASE_IDEMPOTENCY_PREFIX)) {
    return {
      kind: "support_case_operator_alert",
      caseId: idempotencyKey.slice(SUPPORT_CASE_IDEMPOTENCY_PREFIX.length),
    };
  }
  if (idempotencyKey.startsWith(SUPPORT_CASE_REOPEN_IDEMPOTENCY_PREFIX)) {
    const caseId = idempotencyKey.slice(SUPPORT_CASE_REOPEN_IDEMPOTENCY_PREFIX.length).split(":")[0];
    return {
      kind: "support_case_operator_alert",
      caseId,
    };
  }

  return { kind: "operator_alert", lines };
}

export async function sendDeliveryTestEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    targetId?: string | null;
    idempotencyKey: string;
  },
) {
  const { requireDeliveryConfigSave } = await import("~/lib/plan-feature-gate.server");
  const deliveryGate = await requireDeliveryConfigSave(env, input.userId, { emailEnabled: true });
  if (!deliveryGate.ok) {
    return false;
  }

  // A test send is a customer dispatch. It must be tied to a durable,
  // account-owned target; accepting an arbitrary form email would bypass
  // verification and unsubscribe state.
  const targetId = input.targetId?.trim();
  if (!targetId) {
    return false;
  }

  const claimTarget = ("claimEmailTargetForDispatch" in deliveryData
    ? deliveryData.claimEmailTargetForDispatch
    : undefined) as unknown as
    | ((claimEnv: AppEnv, claimInput: { userId: string; targetId: string }) => Promise<{
        id: string;
        targetValue: string;
      } | null>)
    | undefined;
  if (typeof claimTarget !== "function") {
    return false;
  }

  const target = await claimTarget(env, {
    userId: input.userId,
    targetId,
  });
  if (!target || !target.id) {
    return false;
  }
  const recipient = normalizeDeliveryEmail(target.targetValue);
  if (!recipient) {
    return false;
  }

  const claimAttempt = ("claimInstantDeliveryAttempt" in deliveryData
    ? deliveryData.claimInstantDeliveryAttempt
    : undefined) as typeof claimInstantDeliveryAttempt | undefined;
  const startDispatch = ("markInstantDeliveryDispatchStarted" in deliveryData
    ? deliveryData.markInstantDeliveryDispatchStarted
    : undefined) as typeof markInstantDeliveryDispatchStarted | undefined;
  const finalizeAttempt = ("updateDeliveryAttemptResult" in deliveryData
    ? deliveryData.updateDeliveryAttemptResult
    : undefined) as typeof updateDeliveryAttemptResult | undefined;
  if (
    typeof claimAttempt !== "function" ||
    typeof startDispatch !== "function" ||
    typeof finalizeAttempt !== "function"
  ) {
    return false;
  }

  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    return false;
  }
  const claim = await claimAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    deliveryTargetId: target.id,
    lane: "customer",
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: recipient,
    templateName: "delivery_test",
    eventIds: [],
    payloadSnapshot: { kind: "delivery_test" },
    idempotencyKey,
  });
  if (!claim.attemptId || !claim.claimUpdatedAt) {
    return false;
  }

  // Re-run the target CAS after the durable attempt claim. Unsubscribe uses a
  // transaction that marks pending attempts failed; this closes the gap where
  // unsubscribe commits between the first target read and the attempt insert.
  const revalidatedTarget = await claimTarget(env, {
    userId: input.userId,
    targetId: target.id,
  });
  if (!revalidatedTarget || normalizeDeliveryEmail(revalidatedTarget.targetValue) !== recipient) {
    await finalizeAttempt(env, claim.attemptId, {
      provider: EMAIL_PROVIDER,
      status: "failed",
      webhookStatus: "failed",
      errorMessage: "Email delivery target was no longer active before dispatch.",
      failedAt: new Date().toISOString(),
      expectedStatus: "pending",
      expectedWebhookStatus: "pending",
      expectedUpdatedAt: claim.claimUpdatedAt,
    });
    return false;
  }

  const dispatchStartedAt = await startDispatch(
    env,
    claim.attemptId,
    claim.claimUpdatedAt,
  );
  if (!dispatchStartedAt) {
    return false;
  }

  // This app does not currently ingest Cloudflare Email delivery events, so
  // provider acceptance alone cannot prove that a typo'd address received the
  // message. This send gives the customer an end-to-end verification step.
  const providerResult = await sendCloudflareEmail(env, {
    to: recipient,
    subject: "Test email from Five to Nine",
    html: renderDeliveryTestHtml(input),
    tag: "delivery-test",
    unsubscribeUrl: null,
  });

  const finalized = await finalizeAttempt(env, claim.attemptId, {
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    payloadSnapshot: { kind: "delivery_test" },
    targetValue: recipient,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatchStartedAt,
  });

  return finalized && providerResult.status === "sent";
}

function normalizeDeliveryEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

// Account-action verification emails (change email, delete account).
// Transactional: no unsubscribe header, still recorded as delivery attempts;
// action URLs carry secrets and are never persisted in payload snapshots.
export async function sendAccountActionEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    kind: "change_email" | "delete_account";
    actionUrl: string;
  },
) {
  const copy = accountActionCopy(input.kind);

  const providerResult = await sendCloudflareEmail(env, {
    to: input.email,
    subject: copy.subject,
    html: renderAccountActionHtml(input),
    tag: `account-${input.kind.replace("_", "-")}`,
    unsubscribeUrl: null,
  });

  await createDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: input.email,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: `account_${input.kind}`,
    eventIds: [],
    payloadSnapshot: { kind: `account_${input.kind}` },
    idempotencyKey: `account-${input.kind}:${input.userId}:${crypto.randomUUID()}`,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  return providerResult.status === "sent";
}


export async function sendTeamInviteEmail(
  env: AppEnv,
  input: {
    ownerUserId: string;
    ownerName: string | null;
    inviteeEmail: string;
    acceptUrl: string;
  },
) {
  const providerResult = await sendCloudflareEmail(env, {
    to: input.inviteeEmail,
    subject: `${input.ownerName?.trim() || "Your team"} invited you to Five to Nine`,
    html: renderTeamInviteHtml(input),
    tag: "team-invite",
    unsubscribeUrl: null,
  });

  await createDeliveryAttempt(env, {
    userId: input.ownerUserId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: input.inviteeEmail,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: "team_invite",
    eventIds: [],
    payloadSnapshot: { kind: "team_invite" },
    idempotencyKey: `team-invite:${input.ownerUserId}:${crypto.randomUUID()}`,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  return providerResult.status === "sent";
}

export async function sendPasswordResetEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    resetUrl: string;
  },
) {
  // Transactional and user-initiated: this must reach unsubscribed addresses
  // too, so it carries no List-Unsubscribe header — but it still goes through
  // the shared Cloudflare Email path and records a delivery_attempt like
  // every other send. The reset URL contains a secret token and is therefore
  // never written to the payload snapshot.
  const providerResult = await sendCloudflareEmail(env, {
    to: input.email,
    subject: "Reset your Five to Nine password",
    html: renderPasswordResetHtml(input),
    tag: "password-reset",
    unsubscribeUrl: null,
  });

  await createDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: input.email,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: "password_reset",
    eventIds: [],
    payloadSnapshot: { kind: "password_reset" },
    idempotencyKey: `password-reset:${input.userId}:${crypto.randomUUID()}`,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  if (providerResult.status === "failed") {
    throw new Error(providerResult.errorMessage ?? "Password reset email failed to send.");
  }
}

/**
 * Better Auth email-verification link delivery.
 * Transactional (no List-Unsubscribe): the verify URL carries a secret token
 * and must reach the inbox even if the address later unsubscribes from digests.
 * Token URLs are never persisted in delivery_attempt payloads.
 */
export async function sendEmailVerificationEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    verifyUrl: string;
  },
) {
  const providerResult = await sendCloudflareEmail(env, {
    to: input.email,
    subject: "Verify your email for Five to Nine",
    html: renderEmailVerificationHtml(input),
    tag: "email-verification",
    unsubscribeUrl: null,
  });

  await createDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: input.email,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: "email_verification",
    eventIds: [],
    payloadSnapshot: { kind: "email_verification" },
    idempotencyKey: `email-verification:${input.userId}:${crypto.randomUUID()}`,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  if (providerResult.status === "failed") {
    throw new Error(providerResult.errorMessage ?? "Email verification send failed.");
  }
}

// ---------------------------------------------------------------------------
// Pure body builders. Extracted so the render gallery (tests/email-render-
// gallery.test.ts) can exercise every account/transactional template and so
// the copy has one home. The send-time shell adds the outer card + footer.
// ---------------------------------------------------------------------------

export function renderDeliveryTestHtml(input: { name: string | null }) {
  return `
      <div style="${ACCOUNT_BODY_STYLE}">
        <p style="margin: 0 0 12px;">${accountGreeting(input.name)}</p>
        <p style="margin: 0 0 12px;">
          This is a test from Five to Nine. If you're reading it, competitor alerts and digests can
          reach this address.
        </p>
        <p style="${ACCOUNT_FOOTNOTE_STYLE}">
          Nothing else changes — this was requested from your workspace delivery settings.
        </p>
      </div>
    `;
}

function accountActionCopy(kind: "change_email" | "delete_account") {
  return kind === "change_email"
    ? {
        subject: "Confirm your new email for Five to Nine",
        body: "Someone asked to change the email on this Five to Nine account. If that was you, confirm with the button below.",
        action: "Confirm email change",
      }
    : {
        subject: "Confirm account deletion — Five to Nine",
        body: "Someone asked to permanently delete this Five to Nine account, including watchlists, history, and evidence. If that was you, confirm below. This cannot be undone.",
        action: "Delete my account",
      };
}

export function renderAccountActionHtml(input: {
  name: string | null;
  kind: "change_email" | "delete_account";
  actionUrl: string;
}) {
  const copy = accountActionCopy(input.kind);
  return `
      <div style="${ACCOUNT_BODY_STYLE}">
        <p style="margin: 0 0 12px;">${accountGreeting(input.name)}</p>
        <p style="margin: 0 0 20px;">${copy.body}</p>
        <p style="margin: 0 0 24px;">
          <a href="${escapeHtml(input.actionUrl)}" style="${ACCOUNT_CTA_STYLE}">${copy.action}</a>
        </p>
        <p style="${ACCOUNT_FOOTNOTE_STYLE}">
          If you didn't ask for this, ignore this email — nothing changes.
        </p>
      </div>
    `;
}

export function renderTeamInviteHtml(input: {
  ownerName: string | null;
  acceptUrl: string;
}) {
  const inviter = input.ownerName?.trim()
    ? escapeHtml(input.ownerName.trim())
    : "A teammate";
  return `
      <div style="${ACCOUNT_BODY_STYLE}">
        <p style="margin: 0 0 12px;">Hi,</p>
        <p style="margin: 0 0 20px;">${inviter} invited you to their Five to Nine workspace — shared watchlists, collections, and the morning digest on competitor changes.</p>
        <p style="margin: 0 0 24px;">
          <a href="${escapeHtml(input.acceptUrl)}" style="${ACCOUNT_CTA_STYLE}">Join the workspace</a>
        </p>
        <p style="${ACCOUNT_FOOTNOTE_STYLE}">
          The invite expires in 7 days. If you weren't expecting this, ignore this email — nothing changes.
        </p>
      </div>
    `;
}

export function renderWelcomeHtml(input: {
  name: string | null;
  watchlistsUrl: string;
}) {
  return `
      <div style="${ACCOUNT_BODY_STYLE}">
        <p style="margin: 0 0 12px;">${accountGreeting(input.name)}</p>
        <p style="margin: 0 0 12px;">
          You're in. Add a competitor and we'll run one activation scan right away —
          a baseline of the ads they're running so you have a starting point.
        </p>
        <p style="margin: 0 0 20px;">
          When that first scan finishes, we'll email you what we found. After that,
          free keeps watching with a weekly check and a weekly email brief; paid
          plans check every 3–6 hours and alert you when things change.
        </p>
        <p style="margin: 0 0 24px;">
          <a href="${escapeHtml(input.watchlistsUrl)}" style="${ACCOUNT_CTA_STYLE}">Open your competitors</a>
        </p>
        <p style="${ACCOUNT_FOOTNOTE_STYLE}">
          Need a hand? Reply to this email or write ${escapeHtml(SUPPORT_EMAIL)}.
        </p>
      </div>
    `;
}

export function renderActivationResultHtml(input: {
  name: string | null;
  competitor: string;
  count: number;
  topAds: Array<{
    headline: string | null;
    body: string | null;
    creativeImageUrl: string | null;
  }>;
  watchlistUrl: string;
  billingUrl: string;
  proofCaptureSucceeded: boolean;
}) {
  const { competitor, count } = input;
  const topAdsHtml = input.topAds
    .slice(0, 3)
    .map((ad) => {
      const title = escapeHtml((ad.headline || ad.body || "Ad creative").slice(0, 160));
      const body =
        ad.body && ad.headline
          ? `<p style="margin: 4px 0 0; color: #5b6577; font-size: 13px;">${escapeHtml(ad.body.slice(0, 220))}</p>`
          : "";
      const image =
        ad.creativeImageUrl && /^https:\/\//i.test(ad.creativeImageUrl)
          ? `<img src="${escapeHtml(ad.creativeImageUrl)}" alt="" width="200" style="display:block; max-width:200px; height:auto; border-radius:8px; border:1px solid #e4e7ec; margin: 10px 0 0;">`
          : "";
      return `<li style="margin: 0 0 16px;"><strong>${title}</strong>${body}${image}</li>`;
    })
    .join("");

  return `
      <div style="${ACCOUNT_BODY_STYLE}">
        <p style="margin: 0 0 12px;">${accountGreeting(input.name)}</p>
        <p style="margin: 0 0 16px;">
          Your activation scan for <strong>${escapeHtml(competitor)}</strong> finished.
          ${
            count === 0
              ? "We didn't find live ads in the Meta Ad Library for this competitor right now — that can still be useful signal."
              : `We recorded <strong>${count}</strong> active ad${count === 1 ? "" : "s"} as your baseline.`
          }
        </p>
        ${
          topAdsHtml
            ? `<p style="margin: 0 0 10px; color: #5b6577; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;">Top ads</p>
               <ul style="margin: 0 0 20px; padding-left: 18px;">${topAdsHtml}</ul>`
            : ""
        }
        <p style="margin: 0 0 20px;">
          ${
            input.proofCaptureSucceeded
              ? `That capture is your one proof-backed brief this month — saved with a screenshot, page text, and the original link in your Library. `
              : `We couldn't attach a proof-backed capture to this first scan, so no evidence check was used. `
          }Free keeps watching this competitor with a weekly check and a weekly email brief. Paid plans check every 3–6 hours and email you as soon as things change.
        </p>
        <p style="margin: 0 0 24px;">
          <a href="${escapeHtml(input.watchlistUrl)}" style="${ACCOUNT_CTA_STYLE} margin-right: 12px;">View results</a>
          <a href="${escapeHtml(input.billingUrl)}" style="color: #101828; text-decoration: underline; font-weight: 600;">See paid plans</a>
        </p>
        <p style="${ACCOUNT_FOOTNOTE_STYLE}">
          Questions? ${escapeHtml(SUPPORT_EMAIL)}
        </p>
      </div>
    `;
}

export function renderPasswordResetHtml(input: { name: string | null; resetUrl: string }) {
  return `
    <div style="${ACCOUNT_BODY_STYLE}">
      <p style="margin: 0 0 12px;">${accountGreeting(input.name)}</p>
      <p style="margin: 0 0 20px;">
        Someone asked to reset the password for this Five to Nine account. If that was you, use the
        button below — the link works for one hour.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${escapeHtml(input.resetUrl)}" style="${ACCOUNT_CTA_STYLE}">Reset password</a>
      </p>
      <p style="${ACCOUNT_FOOTNOTE_STYLE}">
        If you didn't ask for this, you can ignore this email — your password stays unchanged.
      </p>
    </div>
  `;
}

export function renderEmailVerificationHtml(input: { name: string | null; verifyUrl: string }) {
  return `
    <div style="${ACCOUNT_BODY_STYLE}">
      <p style="margin: 0 0 12px;">${accountGreeting(input.name)}</p>
      <p style="margin: 0 0 20px;">
        Confirm this email address to create watchlists and receive competitor digests on Five to Nine.
        You can keep browsing without verifying.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${escapeHtml(input.verifyUrl)}" style="${ACCOUNT_CTA_STYLE}">Verify email</a>
      </p>
      <p style="${ACCOUNT_FOOTNOTE_STYLE}">
        If you didn't create a Five to Nine account, you can ignore this email.
      </p>
    </div>
  `;
}

/**
 * WP-25: one welcome after the account email is verified (or magic-link signup,
 * which creates the user already verified). Idempotent via delivery_attempt key
 * `welcome:<userId>` — never a second welcome, never recurring free mail.
 */
export async function sendWelcomeEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
  },
) {
  const recipient = normalizeDeliveryEmail(input.email);
  if (!recipient) {
    return { sent: false as const, reason: "missing_email" as const };
  }

  const idempotencyKey = `welcome:${input.userId}`;
  const claim = await claimInstantDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: recipient,
    templateName: "welcome",
    eventIds: [],
    payloadSnapshot: { kind: "welcome" },
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
    return { sent: false as const, reason: "claim_lost" as const };
  }

  const base = appBaseUrl(env);
  const watchlistsUrl = `${base}/app/watchlists`;
  const { buildUnsubscribeUrl } = await import("~/lib/unsubscribe.server");
  // Welcome is product onboarding (not a secret-token transactional). Prefer a
  // List-Unsubscribe when a delivery target exists; otherwise send without —
  // free users can still opt out from account settings once targets exist.
  let unsubscribeUrl: string | null = null;
  try {
    const targets = await listAccountEmailTargetsForWelcome(env, input.userId, recipient);
    const primary = targets[0];
    if (primary?.id) {
      unsubscribeUrl = await buildUnsubscribeUrl(env, {
        userId: input.userId,
        targetId: primary.id,
      });
    }
  } catch {
    unsubscribeUrl = null;
  }

  const providerResult = await sendCloudflareEmail(env, {
    to: recipient,
    subject: "Welcome to Five to Nine — here's what happens next",
    html: renderWelcomeHtml({ name: input.name, watchlistsUrl }),
    tag: "welcome",
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
    payloadSnapshot: { kind: "welcome" },
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

/**
 * WP-25: free plan only — one email when the first successful activation scan
 * records a baseline. Idempotent `activation-result:<userId>:<watchlistId>`.
 * Paid users already get digests/instant alerts; free has neither.
 */
export async function sendFreeActivationResultEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    watchlistId: string;
    competitorName: string;
    adsFound: number;
    topAds: Array<{
      headline: string | null;
      body: string | null;
      creativeImageUrl: string | null;
    }>;
    proofCaptureSucceeded: boolean;
  },
) {
  const recipient = normalizeDeliveryEmail(input.email);
  if (!recipient) {
    return { sent: false as const, reason: "missing_email" as const };
  }

  const targetResolution = await resolveActivationEmailTarget(
    env,
    input.userId,
    recipient,
  );
  if (!targetResolution.target) {
    return {
      sent: false as const,
      reason: targetResolution.reason,
    };
  }
  const deliveryTarget = targetResolution.target;

  const idempotencyKey = `activation-result:${input.userId}:${input.watchlistId}`;
  const claim = await claimInstantDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: input.watchlistId,
    deliveryTargetId: deliveryTarget.id,
    lane: "customer",
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: recipient,
    templateName: "activation_result",
    eventIds: [],
    payloadSnapshot: {
      kind: "activation_result",
      watchlistId: input.watchlistId,
      adsFound: input.adsFound,
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
    return { sent: false as const, reason: "claim_lost" as const };
  }

  const base = appBaseUrl(env);
  const watchlistUrl = `${base}/app/watchlists?watchlist=${encodeURIComponent(input.watchlistId)}`;
  const billingUrl = `${base}/app/billing`;
  const competitor = input.competitorName.trim() || "your competitor";
  const count = Math.max(0, Math.floor(input.adsFound));
  const subject =
    count === 0
      ? `Your activation scan for ${competitor} found no live ads`
      : `Your activation scan found ${count} ad${count === 1 ? "" : "s"} for ${competitor}`;

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
    subject,
    html: renderActivationResultHtml({
      name: input.name,
      competitor,
      count,
      topAds: input.topAds,
      watchlistUrl,
      billingUrl,
      proofCaptureSucceeded: input.proofCaptureSucceeded,
    }),
    tag: "activation-result",
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
    payloadSnapshot: {
      kind: "activation_result",
      watchlistId: input.watchlistId,
      adsFound: input.adsFound,
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

async function listAccountEmailTargetsForWelcome(
  env: AppEnv,
  userId: string,
  accountEmail: string,
) {
  const listTargets = ("listDeliveryTargets" in deliveryData
    ? deliveryData.listDeliveryTargets
    : undefined) as
    | ((
        listEnv: AppEnv,
        listUserId: string,
        opts: { watchlistId: null; channel: "email"; limit: number },
      ) => Promise<Array<{ id: string; targetValue: string; isOptedIn: boolean; optedOutAt: string | null; isPaused: boolean }>>)
    | undefined;
  if (typeof listTargets !== "function") {
    return [];
  }

  const targets = await listTargets(env, userId, {
    watchlistId: null,
    channel: "email",
    limit: 10,
  });
  const normalized = normalizeDeliveryEmail(accountEmail);
  return targets.filter((target) => {
    if (target.isPaused || !target.isOptedIn || target.optedOutAt) {
      return false;
    }
    return normalizeDeliveryEmail(target.targetValue) === normalized;
  });
}

type ActivationEmailTarget = {
  id: string;
  targetValue: string;
  isOptedIn: boolean;
  optedOutAt: string | null;
  isPaused: boolean;
  isValidated: boolean;
  validationStatus: string;
};

async function resolveActivationEmailTarget(
  env: AppEnv,
  userId: string,
  accountEmail: string,
): Promise<{
  target: ActivationEmailTarget | null;
  reason: "unsubscribed" | "target_unavailable" | "target_not_ready" | null;
}> {
  const normalized = normalizeDeliveryEmail(accountEmail);
  const listTargets = deliveryData.listDeliveryTargets as
    | ((
        listEnv: AppEnv,
        listUserId: string,
        opts: {
          watchlistId: null;
          channel: "email";
          targetValue: string;
          limit: number;
        },
      ) => Promise<ActivationEmailTarget[]>)
    | undefined;
  const suppressionReader =
    deliveryData.hasSuppressedEmailTargetForUserAndAddress as
      | ((
          readerEnv: AppEnv,
          input: { userId: string; targetValue: string },
        ) => Promise<boolean>)
      | undefined;
  const provisionTarget =
    deliveryData.provisionVerifiedAccountEmailTargetIfUnsuppressed;
  if (
    !normalized ||
    typeof listTargets !== "function" ||
    typeof suppressionReader !== "function" ||
    typeof provisionTarget !== "function"
  ) {
    return { target: null, reason: "target_unavailable" };
  }

  const targets = await listTargets(env, userId, {
    watchlistId: null,
    channel: "email",
    targetValue: normalized,
    limit: 10,
  });
  if (
    await suppressionReader(env, {
      userId,
      targetValue: normalized,
    })
  ) {
    return { target: null, reason: "unsubscribed" };
  }

  const usable = targets.find(
    (target) =>
      normalizeDeliveryEmail(target.targetValue) === normalized &&
      target.isOptedIn &&
      !target.optedOutAt &&
      !target.isPaused &&
      target.isValidated &&
      target.validationStatus === "validated",
  );
  if (usable) {
    return { target: usable, reason: null };
  }

  // A workspace target for this address is authoritative even when paused or
  // invalid. Never let lazy provisioning reset its consent/readiness state.
  // Paused/unvalidated is not an opt-out — callers should still page.
  if (targets.length > 0) {
    return { target: null, reason: "target_not_ready" };
  }

  const provisioned = await provisionTarget(env, {
    userId,
    targetValue: normalized,
    optInSource: "account_email",
    metadata: {
      autoProvisioned: true,
      purpose: "free_activation_result",
    },
  });
  if (!provisioned?.id) {
    return { target: null, reason: "target_unavailable" };
  }
  return {
    target: provisioned as ActivationEmailTarget,
    reason: null,
  };
}
