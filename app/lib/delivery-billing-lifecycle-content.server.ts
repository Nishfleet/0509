import {
	createScheduledCancellationStateExpectation,
	type ScheduledCancellationStateExpectation,
	scheduledCancellationStateExpectationPayload,
} from "~/lib/delivery-billing-lifecycle-state.server";
import { appBaseUrl, escapeHtml } from "~/lib/delivery-email-core.server";
import type { AppEnv } from "~/lib/env.server";

export interface BillingLifecycleEmailContent {
	idempotencyKey: string;
	subject: string;
	bodyHtml: string;
	tag: string;
	templateName: string;
	stateExpectation?: ScheduledCancellationStateExpectation | null;
}

function billingDateLabel(iso: string | null | undefined) {
	const ms = Date.parse(iso ?? "");
	if (!Number.isFinite(ms)) return null;
	const formatted = new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(ms));
	return `${formatted} (UTC)`;
}

function renderBillingEmailHtml(input: {
	name: string | null;
	paragraphs: string[];
	ctaLabel: string;
	ctaUrl: string;
	footnote: string;
}) {
	const greeting = input.name?.trim()
		? `Hi ${escapeHtml(input.name.trim())},`
		: "Hi,";
	const paragraphs = input.paragraphs
		.map((paragraph) => `<p style="margin: 0 0 16px;">${paragraph}</p>`)
		.join("");
	return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      ${paragraphs}
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.ctaUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
          ${escapeHtml(input.ctaLabel)}
        </a>
      </p>
      <p style="margin: 0 0 12px;">— Five to Nine</p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">${escapeHtml(input.footnote)}</p>
    </div>
  `;
}

export function billingPaymentIssueEmailContent(
	env: AppEnv,
	input: { userId: string; name: string | null; occurredAt?: string | null },
): BillingLifecycleEmailContent {
	const occurredAtMs = Date.parse(input.occurredAt ?? "");
	const dayKey = new Date(
		Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now(),
	)
		.toISOString()
		.slice(0, 10);
	return {
		idempotencyKey: `billing-payment-issue:${input.userId}:${dayKey}`,
		subject: "Action needed: a Five to Nine payment didn't go through",
		tag: "billing-payment-issue",
		templateName: "billing_payment_issue",
		bodyHtml: renderBillingEmailHtml({
			name: input.name,
			paragraphs: [
				"The latest payment for your Five to Nine subscription didn't go through. Nothing has changed yet — your plan stays active while the payment processor retries.",
				"To avoid an interruption, make sure your payment method is up to date.",
			],
			ctaLabel: "Update payment method",
			ctaUrl: `${appBaseUrl(env)}/app/billing`,
			footnote:
				"If a retry has already succeeded, you can ignore this email — nothing changes.",
		}),
	};
}

export function billingCancellationEmailContent(
	env: AppEnv,
	input: {
		userId: string;
		name: string | null;
		kind: "scheduled" | "ended";
		effectiveAt?: string | null;
		eventId: string;
		subscriptionId?: string | null;
		stateUpdatedAt?: string | null;
	},
): BillingLifecycleEmailContent {
	const billingUrl = `${appBaseUrl(env)}/app/billing`;
	const idempotencyKey = `billing-cancellation:${input.userId}:${input.eventId}`;
	if (input.kind === "scheduled") {
		const dateLabel = billingDateLabel(input.effectiveAt);
		const activeUntil = dateLabel
			? `Your plan stays active until <strong>${escapeHtml(dateLabel)}</strong> — watchlists, digests, and alerts keep running until then.`
			: "Your plan stays active until the end of the period you already paid for — watchlists, digests, and alerts keep running until then.";
		return {
			idempotencyKey,
			tag: "billing-cancellation",
			subject: "Your Five to Nine cancellation is confirmed",
			templateName: "billing_cancellation_scheduled",
			stateExpectation: createScheduledCancellationStateExpectation(input),
			bodyHtml: renderBillingEmailHtml({
				name: input.name,
				paragraphs: [
					`Your Five to Nine subscription is cancelled and won't renew. ${activeUntil}`,
					"After that, your workspace moves to the Free plan. Watchlists over the Free limit are paused automatically (the newest one stays active), and your boards, history, and evidence stay in place.",
				],
				ctaLabel: "Review billing",
				ctaUrl: billingUrl,
				footnote:
					"Changed your mind? Once your access ends, resubscribe from your billing page — paused watchlists resume automatically.",
			}),
		};
	}
	return {
		idempotencyKey,
		tag: "billing-cancellation",
		subject: "Your Five to Nine plan has ended",
		templateName: "billing_access_ended",
		bodyHtml: renderBillingEmailHtml({
			name: input.name,
			paragraphs: [
				"Your Five to Nine subscription has ended and your workspace is now on the Free plan.",
				"Watchlists over the Free limit were paused automatically — the newest one stays active. Your boards, history, and evidence are untouched.",
			],
			ctaLabel: "Reactivate your plan",
			ctaUrl: billingUrl,
			footnote:
				"Resubscribe any time — paused watchlists resume automatically when a plan is active again.",
		}),
	};
}

export function billingRefundEmailContent(
	env: AppEnv,
	input: { userId: string; name: string | null; eventId: string },
): BillingLifecycleEmailContent {
	return {
		idempotencyKey: `billing-refund:${input.userId}:${input.eventId}`,
		subject: "We've processed your Five to Nine refund",
		tag: "billing-refund",
		templateName: "billing_refund_revoked",
		bodyHtml: renderBillingEmailHtml({
			name: input.name,
			paragraphs: [
				"We've processed a full refund for your Five to Nine purchase. Your workspace has moved to the Free plan, and credits from that purchase have expired.",
				"Your boards, history, and evidence stay in place on the Free plan.",
			],
			ctaLabel: "View billing",
			ctaUrl: `${appBaseUrl(env)}/app/billing`,
			footnote:
				"If this refund is unexpected, email support using the address below and we'll look into it.",
		}),
	};
}

export type BillingLifecycleEmailOutboxInput =
	| {
			kind: "payment_issue";
			userId: string;
			email: string;
			name: string | null;
			occurredAt?: string | null;
	  }
	| {
			kind: "cancellation_scheduled";
			userId: string;
			email: string;
			name: string | null;
			effectiveAt?: string | null;
			eventId: string;
			subscriptionId?: string | null;
			stateUpdatedAt?: string | null;
	  }
	| {
			kind: "revoke";
			userId: string;
			email: string;
			name: string | null;
			eventId: string;
	  }
	| {
			kind: "refund";
			userId: string;
			email: string;
			name: string | null;
			eventId: string;
	  };

export function prepareBillingLifecycleEmailOutbox(
	env: AppEnv,
	input: BillingLifecycleEmailOutboxInput,
) {
	const content =
		input.kind === "payment_issue"
			? billingPaymentIssueEmailContent(env, input)
			: input.kind === "cancellation_scheduled"
				? billingCancellationEmailContent(env, { ...input, kind: "scheduled" })
				: input.kind === "revoke"
					? billingCancellationEmailContent(env, { ...input, kind: "ended" })
					: billingRefundEmailContent(env, input);
	const stateExpectation = content.stateExpectation ?? null;
	return {
		userId: input.userId,
		email: input.email,
		idempotencyKey: content.idempotencyKey,
		templateName: content.templateName,
		payloadSnapshot: {
			kind: content.templateName,
			subject: content.subject,
			bodyHtml: content.bodyHtml,
			tag: content.tag,
			billingStateFingerprint: null,
			outboxPendingDispatch: true,
			...scheduledCancellationStateExpectationPayload(stateExpectation),
		},
	};
}
