import type { AppEnv } from "~/lib/env.server";
import { emailFromSender, isEmailSendingConfigured } from "~/lib/env.server";
import { renderEmailShell } from "~/lib/email-template.server";
import {
	clearEmailBounceSuppression,
	isEmailSuppressedForAddress,
	listEmailSuppressionRows,
	recordEmailBounceFailure,
} from "~/lib/data/delivery-records-email-suppression.server";
import { PromiseTimeoutError, promiseWithTimeout } from "~/lib/fetch-timeout.server";
import { safeTimeZone } from "~/lib/safe-timezone";

// Shared email-provider core for the delivery sender modules: the Cloudflare
// Email call itself plus the small pure helpers every sender needs. Domain
// modules (digests/instant alerts in delivery.server.ts, billing lifecycle,
// account emails) import from here; product code keeps importing from the
// ~/lib/delivery.server facade.

export const EMAIL_PROVIDER = "cloudflare_email" as const;
export const CLOUDFLARE_EMAIL_SEND_TIMEOUT_MS = 10_000;

export type EmailProviderResult = {
	provider: typeof EMAIL_PROVIDER;
	status: "sent" | "failed" | "pending";
	webhookStatus: "pending" | "failed" | "provider_unknown";
	providerMessageId: string | null;
	providerStatusLastSeenAt: string | null;
	errorMessage: string | null;
	deliveredAt: string | null;
};

export function readString(value: unknown) {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function sendCloudflareEmail(
	env: AppEnv,
	input: {
		to: string;
		subject: string;
		html: string;
		text?: string;
		tag: string;
		unsubscribeUrl: string | null;
		/** "case-file" wraps the brief surfaces (digest/alert/recap/presence) in the bone/ink/signal-green frame. */
		theme?: "plain" | "case-file";
		/** Optional hidden preheader for inbox preview text (passed to the shell). */
		preheader?: string | null;
	},
): Promise<EmailProviderResult> {
	if (!isEmailSendingConfigured(env)) {
		return {
			provider: EMAIL_PROVIDER,
			status: "failed",
			webhookStatus: "failed",
			providerMessageId: null,
			providerStatusLastSeenAt: null,
			errorMessage: "Email sending is not configured for this environment.",
			deliveredAt: null,
		};
	}

	const statusSeenAt = new Date().toISOString();

	// Consult the suppression ledger BEFORE every provider send (issue #2983).
	// Best-effort by design: a deployment whose D1 has not yet run migration
	// 0096, or a test env without a `DB` binding, must behave exactly as before
	// this consult existed — an unreadable ledger reads as "not suppressed".
	const suppression = await readSuppressionSafely(env, input.to);
	if (suppression) {
		return {
			provider: EMAIL_PROVIDER,
			status: "failed" as const,
			webhookStatus: "failed" as const,
			providerMessageId: null,
			providerStatusLastSeenAt: statusSeenAt,
			errorMessage:
				suppression.reason === "complaint"
					? "Email recipient is complaint-suppressed; no provider send was attempted."
					: `Email recipient is bounce-suppressed after ${suppression.consecutiveFailures} consecutive provider failures; no provider send was attempted.`,
			deliveredAt: null,
		};
	}

	const html = renderEmailShell({
		bodyHtml: input.html,
		unsubscribeUrl: input.unsubscribeUrl,
		theme: input.theme ?? "plain",
		preheader: input.preheader ?? null,
	});
	const headers: Record<string, string> = {
		"X-0509-Tag": input.tag,
	};
	if (input.unsubscribeUrl) {
		headers["List-Unsubscribe"] = `<${input.unsubscribeUrl}>`;
		headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
	}

	try {
		const result = await promiseWithTimeout(
			env.EMAIL!.send({
				from: emailFromSender(env),
				to: input.to,
				subject: input.subject,
				html,
				text: input.text ?? stripHtml(html),
				headers,
			}),
			CLOUDFLARE_EMAIL_SEND_TIMEOUT_MS,
			"Cloudflare Email send timed out",
		);

		// A definite provider acceptance clears this address's bounce count so
		// transient blips self-heal (complaint rows are sticky by design).
		await bookkeepingSafely(() => clearEmailBounceSuppression(env, input.to));

		return {
			provider: EMAIL_PROVIDER,
			status: "sent" as const,
			webhookStatus: "provider_unknown" as const,
			providerMessageId: result?.messageId ?? null,
			providerStatusLastSeenAt: statusSeenAt,
			errorMessage: null,
			deliveredAt: null,
		};
	} catch (error) {
		if (error instanceof PromiseTimeoutError) {
			return {
				provider: EMAIL_PROVIDER,
				status: "pending" as const,
				webhookStatus: "provider_unknown" as const,
				providerMessageId: null,
				providerStatusLastSeenAt: statusSeenAt,
				errorMessage: "Cloudflare Email send outcome is unknown after provider timeout.",
				deliveredAt: null,
			};
		}

		// A definite (non-timeout) provider exception is a consecutive bounce
		// signal: record it so the suppression ledger counts it (issue #2983).
		await bookkeepingSafely(() =>
			recordEmailBounceFailure(env, {
				address: input.to,
				source: "provider_send_failed",
				detail: error instanceof Error ? error.message : null,
			}),
		);

		return {
			provider: EMAIL_PROVIDER,
			status: "failed" as const,
			webhookStatus: "provider_unknown" as const,
			providerMessageId: null,
			providerStatusLastSeenAt: statusSeenAt,
			errorMessage: `Cloudflare Email send outcome is unknown after provider exception: ${error instanceof Error ? error.message : "unknown error"}.`,
			deliveredAt: null,
		};
	}
}

/**
 * Read the suppression rows for one address, treating any failure (no DB
 * binding, pre-migration schema, provider outage) as "not suppressed" so the
 * consult is strictly additive to the pre-#2983 behavior.
 */
async function readSuppressionSafely(env: AppEnv, to: string) {
	try {
		return isEmailSuppressedForAddress(await listEmailSuppressionRows(env, to));
	} catch {
		return false;
	}
}

/**
 * Read the suppression rows for one address, treating any failure (no DB
 * binding, pre-migration schema, provider outage) as "not suppressed" so the
 * consult is strictly additive to the pre-#2983 behavior.
 *
 * Exported (issue #2983) for the one sender that reaches the binding through
 * its own path, better-auth magic links, so "consulted before every send"
 * holds without a second copy of the rule.
 */
export { readSuppressionSafely as consultEmailSuppression };

/**
 * Record a definite provider failure against an address so the suppression
 * count advances. Re-exported for a sender that calls the binding directly
 * and still owes the ledger an outcome (better-auth magic links).
 */
export { recordEmailBounceFailure };

/** Suppression bookkeeping must never change the send outcome it records. */
async function bookkeepingSafely(write: () => Promise<unknown>) {
	try {
		await write();
	} catch {
		// The returned provider result stays truthful either way.
	}
}

export function appBaseUrl(env: AppEnv) {
	const value = env.APP_ORIGIN?.trim() || env.BETTER_AUTH_URL?.trim() || "";
	return value ? value.replace(/\/+$/, "") : "https://0509.io";
}

export function providerAcceptedAt(result: EmailProviderResult) {
	return result.status === "sent" ? result.providerStatusLastSeenAt : null;
}

// Digest period dates are formatted in the workspace's configured delivery
// timezone when one exists, otherwise UTC. Locale-neutral en-GB on purpose —
// recipients are global, so no regional locale default.
export function formatDate(value: string, timeZone?: string | null) {
	return new Intl.DateTimeFormat("en-GB", {
		dateStyle: "medium",
		timeZone: safeTimeZone(timeZone),
	}).format(new Date(value));
}

export function stripHtml(value: string) {
	return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function escapeSlackText(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
