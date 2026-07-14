import {
	createDeliveryAttempt,
	getDeliveryAttemptByIdempotencyKey,
	getOldestUserId,
	getUserDeliveryProfile,
	getUserIdByEmail,
	updateDeliveryAttemptResult,
} from "~/lib/data.server";
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

// One daily "customer-at-risk" email to the operator when monitoring or
// delivery is degrading for paying customers — the ops dashboard is
// pull-only and nobody is paged to it. Day-keyed idempotency: max one/day.
export async function sendOperatorAlertEmail(
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
		return false;
	}

	const dayKey = new Date().toISOString().slice(0, 10);
  const idempotencyKey = input.idempotencyKey ?? `operator-alert:${dayKey}`;
	const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
	if (duplicate?.status === "sent") {
		return false;
	}

	const providerResult = await sendCloudflareEmail(env, {
		to: recipient,
		subject: input.subject,
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 14px; line-height: 1.6;">
        <p style="margin: 0 0 12px;"><strong>${escapeHtml(input.intro ?? "Customer-at-risk signals from recent monitoring:")}</strong></p>
        <ul style="margin: 0 0 12px; padding-left: 18px;">
          ${input.lines.map((line) => `<li style="margin: 0 0 6px;">${escapeHtml(line)}</li>`).join("")}
        </ul>
        <p style="margin: 0; color: #5b6577; font-size: 12px;">
          Details: https://0509.io/app/ops
        </p>
      </div>
    `,
		tag: "operator-alert",
		unsubscribeUrl: null,
	});

	if (duplicate) {
		await updateDeliveryAttemptResult(env, duplicate.id, {
			provider: providerResult.provider,
			status: providerResult.status,
			webhookStatus: providerResult.webhookStatus,
			providerMessageId: providerResult.providerMessageId,
			providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
			errorMessage: providerResult.errorMessage,
			sentAt: providerAcceptedAt(providerResult),
			failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
		});
		return providerResult.status === "sent";
	}

	// delivery_attempt.user_id carries a foreign key to user(id), so the
	// attempt must be attributed to a REAL user row: the operator's own account
	// when it exists, else the oldest account (the founder's). Without this the
	// operator-alert insert violated the FK — the email sent but the dedupe row never
	// persisted and the logs claimed failure.
	const attemptUserId =
		(await getUserIdByEmail(env, recipient)) ?? (await getOldestUserId(env));
	if (!attemptUserId) {
		// Empty user table (fresh environment): nothing to attribute to — the
		// email went out, skip the ledger row.
		return providerResult.status === "sent";
	}

	await createDeliveryAttempt(env, {
		userId: attemptUserId,
		watchlistId: null,
		digestRunId: null,
		deliveryTargetId: null,
		lane: "internal",
		channel: "email",
		provider: providerResult.provider,
		status: providerResult.status,
		webhookStatus: providerResult.webhookStatus,
		targetValue: recipient,
		providerMessageId: providerResult.providerMessageId,
		providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
		templateName: "operator_alert",
		eventIds: [],
		payloadSnapshot: operatorAlertPayloadSnapshot(idempotencyKey, input.lines),
		idempotencyKey,
		errorMessage: providerResult.errorMessage,
		sentAt: providerAcceptedAt(providerResult),
		failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
	});

	return providerResult.status === "sent";
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
	},
) {
	const { requireDeliveryConfigSave } = await import("~/lib/plan-feature-gate.server");
	const deliveryGate = await requireDeliveryConfigSave(env, input.userId, { emailEnabled: true });
	if (!deliveryGate.ok) {
		return false;
	}

	// Cloudflare Email has no bounce webhooks, so a typo'd address shows
	// "sent" forever while the customer receives nothing. This send gives
	// them a way to prove the address works end-to-end.
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";
	const providerResult = await sendCloudflareEmail(env, {
		to: input.email,
		subject: "Test email from Five to Nine",
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
        <p style="margin: 0 0 12px;">${greeting}</p>
        <p style="margin: 0 0 12px;">
          This is a test from Five to Nine. If you're reading it, competitor alerts and digests can
          reach this address.
        </p>
        <p style="margin: 0; color: #5b6577; font-size: 13px;">
          Nothing else changes — this was requested from your workspace delivery settings.
        </p>
      </div>
    `,
		tag: "delivery-test",
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
		templateName: "delivery_test",
		eventIds: [],
		payloadSnapshot: { kind: "delivery_test" },
    idempotencyKey: `delivery-test:${input.userId}:${crypto.randomUUID()}`,
		errorMessage: providerResult.errorMessage,
		sentAt: providerAcceptedAt(providerResult),
		failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
	});

	return providerResult.status === "sent";
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
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";
	const copy =
		input.kind === "change_email"
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

	const providerResult = await sendCloudflareEmail(env, {
		to: input.email,
		subject: copy.subject,
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
        <p style="margin: 0 0 12px;">${greeting}</p>
        <p style="margin: 0 0 16px;">${copy.body}</p>
        <p style="margin: 0 0 20px;">
          <a href="${escapeHtml(input.actionUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
            ${copy.action}
          </a>
        </p>
        <p style="margin: 0; color: #5b6577; font-size: 13px;">
          If you didn't ask for this, ignore this email — nothing changes.
        </p>
      </div>
    `,
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
	const inviter = input.ownerName?.trim() ? escapeHtml(input.ownerName.trim()) : "A teammate";

	const providerResult = await sendCloudflareEmail(env, {
		to: input.inviteeEmail,
    subject: `${input.ownerName?.trim() || "Your team"} invited you to Five to Nine`,
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
        <p style="margin: 0 0 12px;">Hi,</p>
        <p style="margin: 0 0 16px;">${inviter} invited you to their Five to Nine workspace — shared watchlists, collections, and the morning digest on competitor changes.</p>
        <p style="margin: 0 0 20px;">
          <a href="${escapeHtml(input.acceptUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
            Join the workspace
          </a>
        </p>
        <p style="margin: 0; color: #5b6577; font-size: 13px;">
          The invite expires in 7 days. If you weren't expecting this, ignore this email — nothing changes.
        </p>
      </div>
    `,
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

function renderPasswordResetHtml(input: { name: string | null; resetUrl: string }) {
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";

  return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      <p style="margin: 0 0 16px;">
        Someone asked to reset the password for this Five to Nine account. If that was you, use the
        button below — the link works for one hour.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.resetUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
          Reset password
        </a>
      </p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">
        If you didn't ask for this, you can ignore this email — your password stays unchanged.
      </p>
    </div>
  `;
}

function renderEmailVerificationHtml(input: { name: string | null; verifyUrl: string }) {
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";

  return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      <p style="margin: 0 0 16px;">
        Confirm this email address to create watchlists and receive competitor digests on Five to Nine.
        You can keep browsing without verifying.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.verifyUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
          Verify email
        </a>
      </p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">
        If you did not create a Five to Nine account, you can ignore this email.
      </p>
    </div>
  `;
}
