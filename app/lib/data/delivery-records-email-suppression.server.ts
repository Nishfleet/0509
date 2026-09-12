import type { AppEnv } from "~/lib/env.server";
import { execute as run, queryAll as many } from "~/lib/data/d1.server";

/**
 * Email suppression read/write (issue #2983).
 *
 * The provider-agnostic question "may we still send to this address?" is
 * answered here from one D1 table (`email_suppression`, migration 0096):
 *   - reason 'bounce': consecutive definite provider failures since the last
 *     successful acceptance. At or above
 *     EMAIL_SUPPRESS_AFTER_CONSECUTIVE_FAILURES the address is suppressed;
 *     a successful send clears the row so transient blips self-heal.
 *   - reason 'complaint': sticky until explicitly removed.
 *
 * The only consumer that decides whether a provider send happens is
 * `delivery-email-core.sendCloudflareEmail` — every 0509.io email (digests,
 * alerts, billing lifecycle, account, operator) goes through it, so the
 * consult-before-every-send contract holds in exactly one place. Address
 * normalization mirrors the delivery_target convention: lower(trim()).
 */

export const EMAIL_SUPPRESS_AFTER_CONSECUTIVE_FAILURES = 3;

export type EmailSuppressionReason = "bounce" | "complaint";

export type EmailSuppressionRecord = {
	address: string;
	reason: EmailSuppressionReason;
	source: string;
	detail: string | null;
	consecutiveFailures: number;
};

type EmailSuppressionRow = {
	address: string;
	reason: string;
	source: string;
	detail: string | null;
	consecutive_failures: number;
};

export function normalizeSuppressionAddress(value: unknown) {
	return typeof value === "string" && value.trim().length > 0
		? value.trim().toLowerCase()
		: null;
}

function toRecord(row: EmailSuppressionRow): EmailSuppressionRecord {
	return {
		address: row.address,
		reason: row.reason === "complaint" ? "complaint" : "bounce",
		source: row.source,
		detail: row.detail,
		consecutiveFailures: row.consecutive_failures,
	};
}

export async function listEmailSuppressionRows(
	env: AppEnv,
	address: unknown,
): Promise<EmailSuppressionRecord[]> {
	const normalized = normalizeSuppressionAddress(address);
	if (!normalized) return [];
	const rows = await many<EmailSuppressionRow>(
		env,
		`
			SELECT address, reason, source, detail, consecutive_failures
			FROM email_suppression
			WHERE address = ?
		`,
		normalized,
	);
	return rows.map(toRecord);
}

/**
 * Consulted by the send core before every provider send. A complaint
 * suppresses unconditionally; a bounce suppresses once consecutive definite
 * failures reach EMAIL_SUPPRESS_AFTER_CONSECUTIVE_FAILURES.
 */
export function isEmailSuppressedForAddress(
	rows: EmailSuppressionRecord[],
): false | { reason: EmailSuppressionReason; consecutiveFailures: number } {
	const complaint = rows.find((row) => row.reason === "complaint");
	if (complaint) {
		return { reason: "complaint", consecutiveFailures: complaint.consecutiveFailures };
	}
	const bounce = rows.find((row) => row.reason === "bounce");
	if (bounce && bounce.consecutiveFailures >= EMAIL_SUPPRESS_AFTER_CONSECUTIVE_FAILURES) {
		return { reason: "bounce", consecutiveFailures: bounce.consecutiveFailures };
	}
	return false;
}

export async function recordEmailBounceFailure(
	env: AppEnv,
	input: { address: unknown; source: string; detail: string | null },
) {
	const normalized = normalizeSuppressionAddress(input.address);
	if (!normalized) return;
	const now = new Date().toISOString();
	await run(
		env,
		`
			INSERT INTO email_suppression
				(address, reason, source, detail, consecutive_failures, created_at, updated_at)
			VALUES (?, 'bounce', ?, ?, 1, ?, ?)
			ON CONFLICT (address, reason) DO UPDATE SET
				source = excluded.source,
				detail = excluded.detail,
				consecutive_failures = consecutive_failures + 1,
				updated_at = excluded.updated_at
		`,
		normalized,
		input.source,
		input.detail,
		now,
		now,
	);
}

export async function recordEmailComplaintSuppression(
	env: AppEnv,
	input: { address: unknown; source: string; detail: string | null },
) {
	const normalized = normalizeSuppressionAddress(input.address);
	if (!normalized) return;
	const now = new Date().toISOString();
	await run(
		env,
		`
			INSERT OR IGNORE INTO email_suppression
				(address, reason, source, detail, consecutive_failures, created_at, updated_at)
			VALUES (?, 'complaint', ?, ?, 0, ?, ?)
		`,
		normalized,
		input.source,
		input.detail,
		now,
		now,
	);
}

/** A successful provider acceptance clears the bounce count; complaints stick. */
export async function clearEmailBounceSuppression(env: AppEnv, address: unknown) {
	const normalized = normalizeSuppressionAddress(address);
	if (!normalized) return;
	await run(
		env,
		`
			DELETE FROM email_suppression
			WHERE address = ? AND reason = 'bounce'
		`,
		normalized,
	);
}
