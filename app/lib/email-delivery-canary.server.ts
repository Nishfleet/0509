import type { AppEnv } from "~/lib/env.server";
import { execute, queryAll, queryOne } from "~/lib/data/d1.server";
import { sendCloudflareEmail } from "~/lib/delivery-email-core.server";
import { reportError } from "~/lib/error-report.server";

/**
 * Email delivery canary — measures the outbound send → receive loop end to end.
 *
 * Every fifteen minutes (cron "star-slash-15 star star star", a control-plane
 * cron handled before
 * `resolveScheduledTask` and therefore NOT recorded in the release-soak
 * observation tables, whose CHECK accepts only the four workload crons) the
 * Worker sends a canary email to `status-canary@0509.io` with a unique token
 * in the subject. The zone's Email Routing rule delivers that address back to
 * this same Worker's `email()` handler, which parses the token and completes
 * the row. What was previously unmeasurable — "did the mail actually arrive?"
 * — becomes a D1 row with a real latency.
 *
 * Failure semantics (all terminal states write `failed` + an error-report row):
 *   - provider send error  — the send never left;
 *   - late receipt         — round trip over EMAIL_DELIVERY_CANARY_LATE_MS;
 *   - unmatched receipt    — a token arrived with no matching sent row;
 *   - stale send           — a 'sent' row still unresolved after the late
 *                            window is marked on the next tick.
 *
 * Everything here is best-effort and never throws to its caller: the canary
 * must not become a second outage generator on top of the mail pipeline it
 * watches. Alerting goes through the existing error-report sink
 * (`error_report` D1 table), never a new channel.
 */

export const EMAIL_DELIVERY_CANARY_CRON = "*/15 * * * *";
export const EMAIL_DELIVERY_CANARY_ADDRESS = "status-canary@0509.io";
export const EMAIL_DELIVERY_CANARY_SUBJECT_PREFIX = "[0509 canary]";
/** A round trip slower than this is a failure, not a success. */
export const EMAIL_DELIVERY_CANARY_LATE_MS = 10 * 60 * 1000;
/** Rows older than this are pruned on each tick (the status window is 24h). */
export const EMAIL_DELIVERY_CANARY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Loop-health window: with a 15-minute cadence, three consecutive sends with
 * zero receipts inside 75 minutes means the loop is broken, not flaky.
 */
export const EMAIL_DELIVERY_CANARY_LOOP_WINDOW_MS = 75 * 60 * 1000;
export const EMAIL_DELIVERY_CANARY_LOOP_MIN_SENDS = 3;

const CANARY_TAG = "email-delivery-canary";
const TOKEN_PATTERN =
	/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export type CanaryToken = string;

export function makeCanaryToken(): CanaryToken {
	return crypto.randomUUID();
}

export function buildCanarySubject(token: CanaryToken): string {
	return `${EMAIL_DELIVERY_CANARY_SUBJECT_PREFIX} ${token}`;
}

/** Pull the canary token back out of a subject line. Null when absent. */
export function parseCanaryTokenFromSubject(subject: unknown): CanaryToken | null {
	if (typeof subject !== "string") return null;
	const match = subject.match(TOKEN_PATTERN);
	return match ? match[0].toLowerCase() : null;
}

type CanaryRow = {
	token: string;
	status: "sent" | "received" | "failed";
	sent_at: string | null;
	received_at: string | null;
	latency_ms: number | null;
	error: string | null;
	created_at: string;
};

function truncateError(error: unknown): string | null {
	const message = error instanceof Error ? error.message : String(error ?? "");
	const trimmed = message.trim();
	if (!trimmed) return null;
	return trimmed.length > 200 ? `${trimmed.slice(0, 199)}…` : trimmed;
}

/**
 * Provider-side send of one canary. Uses the mandated delivery core
 * (sendCloudflareEmail) so the canary exercises the exact path customer mail
 * takes: suppression consult, provider binding, bounce bookkeeping.
 * Records the attempt row (sent | failed) and returns the outcome.
 * Never throws.
 */
export async function sendEmailDeliveryCanary(
	env: AppEnv,
	options: { now?: Date } = {},
): Promise<{ outcome: "sent" | "send_failed" | "skipped"; token: CanaryToken | null; error: string | null }> {
	const now = options.now ?? new Date();
	if (!env.EMAIL) {
		return { outcome: "skipped", token: null, error: "EMAIL binding not configured" };
	}
	if ((env.E2E_TEST_MODE ?? "").trim() === "1") {
		return { outcome: "skipped", token: null, error: "E2E_TEST_MODE" };
	}

	const token = makeCanaryToken();
	try {
		const result = await sendCloudflareEmail(env, {
			to: EMAIL_DELIVERY_CANARY_ADDRESS,
			subject: buildCanarySubject(token),
			html: `<p>0509 email delivery canary ${token}</p>`,
			text: `0509 email delivery canary ${token}`,
			tag: CANARY_TAG,
			unsubscribeUrl: null,
			theme: "plain",
		});
		const sent = result.status === "sent";
		await execute(
			env,
			`INSERT INTO email_delivery_canary (token, status, sent_at, received_at, latency_ms, error, created_at)
			 VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
			token,
			sent ? "sent" : "failed",
			now.toISOString(),
			result.errorMessage ?? "send not accepted by provider",
			now.toISOString(),
		);
		return {
			outcome: sent ? "sent" : "send_failed",
			token,
			error: sent ? null : (result.errorMessage ?? "send not accepted"),
		};
	} catch (error) {
		// sendCloudflareEmail never throws by contract; this is a defense for
		// surprises above it (DB write failure included). Record honestly.
		const message = truncateError(error) ?? "canary send threw";
		try {
			await execute(
				env,
				`INSERT INTO email_delivery_canary (token, status, sent_at, received_at, latency_ms, error, created_at)
				 VALUES (?, 'failed', ?, NULL, NULL, ?, ?)`,
				token,
				now.toISOString(),
				message,
				now.toISOString(),
			);
		} catch {
			// Table may not exist yet (pre-migration); the returned outcome still
			// tells the truth to the caller.
		}
		return { outcome: "send_failed", token, error: message };
	}
}

export type CanaryReceiptOutcome =
	| { kind: "received"; token: CanaryToken; latencyMs: number }
	| { kind: "late"; token: CanaryToken; latencyMs: number }
	| { kind: "unmatched"; token: CanaryToken }
	| { kind: "unparsable" }
	| { kind: "not_canary_address" };

/**
 * The `email()` handler body: parse the token out of the inbound message and
 * complete (or fail) the matching canary row. Never throws — an unhandled
 * error here would tempfail the inbound mail and mask the real signal.
 */
export async function recordCanaryReceipt(
	env: AppEnv,
	message: { to: unknown; headers: { get(name: string): string | null } },
	options: { now?: Date } = {},
): Promise<CanaryReceiptOutcome> {
	const now = options.now ?? new Date();
	const to = typeof message.to === "string" ? message.to.trim().toLowerCase() : "";
	if (to !== EMAIL_DELIVERY_CANARY_ADDRESS) {
		return { kind: "not_canary_address" };
	}
	const token = parseCanaryTokenFromSubject(message.headers.get("subject"));
	if (!token) {
		await reportError(env, {
			route: "email.canary.receipt",
			reasonCode: "email_canary_receipt_unparsable",
			error: new Error("inbound canary mail had no parsable token"),
		});
		return { kind: "unparsable" };
	}

	const sentAt = now.toISOString();
	try {
		const existing = await queryOne<CanaryRow>(
			env,
			`SELECT token, status, sent_at, received_at, latency_ms, error, created_at
			 FROM email_delivery_canary WHERE token = ?`,
			token,
		);
		if (existing) {
			// Redelivery of an already-resolved round trip: ignore, stay idempotent.
			if (existing.status === "received") {
				return { kind: "received", token, latencyMs: existing.latency_ms ?? 0 };
			}
			if (existing.status === "sent" && existing.sent_at) {
				const latencyMs = Math.max(0, now.getTime() - Date.parse(existing.sent_at));
				if (latencyMs > EMAIL_DELIVERY_CANARY_LATE_MS) {
					// Arrived, but outside the deadline: honest failure with the true
					// latency preserved in the error text.
					await execute(
						env,
						`UPDATE email_delivery_canary
						 SET status = 'failed', received_at = ?, latency_ms = ?, error = ?
						 WHERE token = ? AND status = 'sent'`,
						sentAt,
						latencyMs,
						`late receipt after ${Math.round(latencyMs / 1000)}s (deadline ${EMAIL_DELIVERY_CANARY_LATE_MS / 1000}s)`,
						token,
					);
					return { kind: "late", token, latencyMs };
				}
				await execute(
					env,
					`UPDATE email_delivery_canary
					 SET status = 'received', received_at = ?, latency_ms = ?
					 WHERE token = ? AND status = 'sent'`,
					sentAt,
					latencyMs,
					token,
				);
				return { kind: "received", token, latencyMs };
			}
			// Already failed (send error or swept late): nothing to complete.
			return { kind: "unmatched", token };
		}
		await execute(
			env,
			`INSERT INTO email_delivery_canary (token, status, sent_at, received_at, latency_ms, error, created_at)
			 VALUES (?, 'failed', NULL, ?, NULL, 'unmatched receipt: no matching sent row', ?)`,
			token,
			sentAt,
			now.toISOString(),
		);
		return { kind: "unmatched", token };
	} catch (error) {
		// Pre-migration schema or D1 outage: report through the sink, never throw.
		await reportError(env, {
			route: "email.canary.receipt",
			reasonCode: "email_canary_receipt_write_failed",
			error,
		});
		return { kind: "unmatched", token };
	}
}

/**
 * Terminal-state sweep run on every tick, before the next send:
 *   - prune rows beyond retention;
 *   - mark 'sent' rows still unresolved past the late deadline as failed.
 * Returns what it did so the caller can log/alert. Never throws (a broken
 * sweep is reported by the caller's catch, and must not block the send).
 */
export async function sweepCanaryRows(
	env: AppEnv,
	options: { now?: Date } = {},
): Promise<{ pruned: number; markedLate: number }> {
	const now = options.now ?? new Date();
	const cutoff = new Date(now.getTime() - EMAIL_DELIVERY_CANARY_RETENTION_MS).toISOString();
	const lateBefore = new Date(now.getTime() - EMAIL_DELIVERY_CANARY_LATE_MS).toISOString();
	let pruned = 0;
	let markedLate = 0;
	try {
		const prunedResult = await execute(
			env,
			`DELETE FROM email_delivery_canary WHERE created_at < ?`,
			cutoff,
		);
		pruned = ((prunedResult.meta as { changes?: number } | undefined)?.changes ?? 0);
		const lateResult = await execute(
			env,
			`UPDATE email_delivery_canary
			 SET status = 'failed', error = 'late: no receipt within ${EMAIL_DELIVERY_CANARY_LATE_MS / 1000}s'
			 WHERE status = 'sent' AND sent_at < ?`,
			lateBefore,
		);
		markedLate = ((lateResult.meta as { changes?: number } | undefined)?.changes ?? 0);
	} catch {
		// Pre-migration schema or transient D1 error: the send below still runs,
		// and the loop-health assessment reports what it can see.
	}
	return { pruned, markedLate };
}

export type CanaryLoopHealth = {
	degraded: boolean;
	reason: string | null;
	sendsInWindow: number;
	receivedInWindow: number;
};

/**
 * Is the loop broken right now? Broken means: at least
 * EMAIL_DELIVERY_CANARY_LOOP_MIN_SENDS sends inside the loop window and zero
 * receipts among them. A single miss is noise (provider blips self-heal);
 * three in a row is a dead pipeline.
 */
export async function assessCanaryLoopHealth(
	env: AppEnv,
	options: { now?: Date } = {},
): Promise<CanaryLoopHealth> {
	const now = options.now ?? new Date();
	const since = new Date(now.getTime() - EMAIL_DELIVERY_CANARY_LOOP_WINDOW_MS).toISOString();
	try {
		const row = await queryOne<{ sends: number; received: number }>(
			env,
			`SELECT
				 COUNT(*) FILTER (WHERE status IN ('sent', 'received', 'failed') AND sent_at IS NOT NULL) AS sends,
				 COUNT(*) FILTER (WHERE status = 'received') AS received
			 FROM email_delivery_canary
			 WHERE created_at >= ?`,
			since,
		);
		const sends = row?.sends ?? 0;
		const received = row?.received ?? 0;
		const degraded = sends >= EMAIL_DELIVERY_CANARY_LOOP_MIN_SENDS && received === 0;
		return {
			degraded,
			reason: degraded
				? `${sends} canary sends in the last ${EMAIL_DELIVERY_CANARY_LOOP_WINDOW_MS / 60000} minutes with zero receipts`
				: null,
			sendsInWindow: sends,
			receivedInWindow: received,
		};
	} catch {
		// Cannot see the table: report unknown (not degraded — the per-attempt
		// failure reports already carry the signal in that case).
		return { degraded: false, reason: null, sendsInWindow: 0, receivedInWindow: 0 };
	}
}

export type EmailDeliveryCanaryTickResult = {
	outcome: "sent" | "send_failed" | "skipped";
	token: CanaryToken | null;
	error: string | null;
	sweep: { pruned: number; markedLate: number };
	loop: CanaryLoopHealth;
};

/**
 * The whole 15-minute tick: sweep (prune + late-mark), send, assess loop
 * health, and file error-report rows for anything failed. Alerting uses the
 * existing error-report sink only. Never throws.
 */
export async function runEmailDeliveryCanaryTick(
	env: AppEnv,
	options: { now?: Date } = {},
): Promise<EmailDeliveryCanaryTickResult> {
	const now = options.now ?? new Date();
	const sweep = await sweepCanaryRows(env, { now });
	const send = await sendEmailDeliveryCanary(env, { now });
	const loop = await assessCanaryLoopHealth(env, { now });

	if (send.outcome === "send_failed" && send.error) {
		await reportError(env, {
			route: "scheduled.email_delivery_canary",
			reasonCode: "email_canary_send_failed",
			error: new Error(send.error),
		});
	}
	if (sweep.markedLate > 0) {
		await reportError(env, {
			route: "scheduled.email_delivery_canary",
			reasonCode: "email_canary_late_or_unresolved",
			error: new Error(`${sweep.markedLate} canary send(s) never produced a receipt in time`),
		});
	}
	if (loop.degraded && loop.reason) {
		await reportError(env, {
			route: "scheduled.email_delivery_canary",
			reasonCode: "email_canary_loop_degraded",
			error: new Error(loop.reason),
		});
	}

	return {
		outcome: send.outcome,
		token: send.token,
		error: send.error,
		sweep,
		loop,
	};
}

export type EmailDeliveryStatus = {
	/** 24-hour canary loop window. */
	canary: {
		windowHours: 24;
		sends: number;
		received: number;
		failed: number;
		/** received / (received + failed) over resolved rows; null when none. */
		successRate: number | null;
		p50LatencyMs: number | null;
		lastFailure: { at: string; error: string } | null;
		lastReceivedAt: string | null;
	};
	/** 24-hour suppression ledger counts (bounce = definite provider rejection). */
	suppression: { bounces24h: number; complaints24h: number };
	/** Last successful customer email send per product lane (public-safe). */
	lastAlertSentAt: string | null;
	lastDigestSentAt: string | null;
};

/**
 * Public-safe delivery status for the status page and health surfaces.
 * No tokens, no recipient addresses, no provider internals — counts,
 * timestamps and one truncated failure message at most.
 */
export async function getEmailDeliveryStatus(env: AppEnv): Promise<EmailDeliveryStatus> {
	const now = Date.now();
	const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
	const empty: EmailDeliveryStatus = {
		canary: {
			windowHours: 24,
			sends: 0,
			received: 0,
			failed: 0,
			successRate: null,
			p50LatencyMs: null,
			lastFailure: null,
			lastReceivedAt: null,
		},
		suppression: { bounces24h: 0, complaints24h: 0 },
		lastAlertSentAt: null,
		lastDigestSentAt: null,
	};
	if (!env.DB) return empty;

	try {
		const [rows, suppressionRows, lastAlert, lastDigest] = await Promise.all([
			queryAll<CanaryRow>(
				env,
				`SELECT token, status, sent_at, received_at, latency_ms, error, created_at
				 FROM email_delivery_canary
				 WHERE created_at >= ? OR (status = 'sent' AND sent_at >= ?)
				 ORDER BY created_at ASC`,
				since,
				since,
			),
			queryAll<{ reason: string; n: number }>(
				env,
				`SELECT reason, COUNT(*) AS n FROM email_suppression
				 WHERE created_at >= ? GROUP BY reason`,
				since,
			),
			queryOne<{ last_sent_at: string | null }>(
				env,
				`SELECT MAX(sent_at) AS last_sent_at FROM delivery_attempt
				 WHERE lane = 'customer' AND channel = 'email' AND status = 'sent'
				   AND digest_run_id IS NULL AND idempotency_key LIKE 'instant:%'
				   AND sent_at IS NOT NULL`,
			),
			queryOne<{ last_sent_at: string | null }>(
				env,
				`SELECT MAX(sent_at) AS last_sent_at FROM delivery_attempt
				 WHERE lane = 'customer' AND channel = 'email' AND status = 'sent'
				   AND digest_run_id IS NOT NULL AND idempotency_key LIKE 'digest:%:customer:email:%'
				   AND sent_at IS NOT NULL`,
			),
		]);

		const receivedRows = rows.filter((row) => row.status === "received");
		const failedRows = rows.filter((row) => row.status === "failed");
		const resolved = receivedRows.length + failedRows.length;
		const latencies = receivedRows
			.map((row) => row.latency_ms)
			.filter((value): value is number => typeof value === "number")
			.sort((a, b) => a - b);
		const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : null;
		const lastFailed = failedRows
			.filter((row) => row.sent_at || row.received_at)
			.sort((a, b) =>
				Date.parse(b.received_at ?? b.sent_at ?? "") - Date.parse(a.received_at ?? a.sent_at ?? ""),
			)[0];
		const lastReceivedAt = receivedRows
			.map((row) => row.received_at)
			.filter((value): value is string => typeof value === "string")
			.sort()
			.at(-1) ?? null;

		return {
			canary: {
				windowHours: 24,
				sends: rows.filter((row) => row.sent_at !== null || row.status === "failed").length,
				received: receivedRows.length,
				failed: failedRows.length,
				successRate: resolved > 0 ? receivedRows.length / resolved : null,
				p50LatencyMs: p50,
				lastFailure: lastFailed
					? {
							at: lastFailed.received_at ?? lastFailed.sent_at ?? lastFailed.created_at,
							error: (lastFailed.error ?? "unknown failure").slice(0, 200),
						}
					: null,
				lastReceivedAt,
			},
			suppression: {
				bounces24h: suppressionRows.find((row) => row.reason === "bounce")?.n ?? 0,
				complaints24h: suppressionRows.find((row) => row.reason === "complaint")?.n ?? 0,
			},
			lastAlertSentAt: lastAlert?.last_sent_at ?? null,
			lastDigestSentAt: lastDigest?.last_sent_at ?? null,
		};
	} catch {
		// Pre-migration schema or D1 hiccup: honest empty status, never a throw
		// into a status-page render.
		return empty;
	}
}
