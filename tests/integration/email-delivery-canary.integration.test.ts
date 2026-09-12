import { describe, expect, it } from "vitest";

import {
	buildCanarySubject,
	EMAIL_DELIVERY_CANARY_ADDRESS,
	EMAIL_DELIVERY_CANARY_LATE_MS,
	getEmailDeliveryStatus,
	makeCanaryToken,
	recordCanaryReceipt,
	sweepCanaryRows,
} from "~/lib/email-delivery-canary.server";

import { appEnv, db } from "./fixtures";

/**
 * Issue #3188 — migration 0098 (email_delivery_canary) against the REAL
 * migrated D1 (the workers project applied the full migration chain).
 *
 * What this proves that the mocked node suite cannot:
 *   - WRITE: the receipt handler's INSERT/UPDATE land on the real table —
 *     its CHECK (status enum, latency_ms >= 0) and column names — and the
 *     late-sweep UPDATE marks rows the same way;
 *   - READ: getEmailDeliveryStatus aggregates the real rows, excluding
 *     forged unmatched receipts from the public success rate.
 *
 * The provider send itself is a binding call already covered by the node
 * suite; the 'sent' rows here are inserted with the same SQL shape the send
 * path writes. Storage is isolated per FILE, so token-scoped assertions are
 * exact and the global-rollup assertions in the second test rely on the two
 * tests' fixtures being the only canary rows present.
 */

function canaryMessage(subject: string | null) {
	return {
		to: EMAIL_DELIVERY_CANARY_ADDRESS,
		headers: {
			get: (name: string) => (name === "subject" ? subject : null),
		},
	};
}

async function insertSentRow(token: string, sentAt: Date) {
	const iso = sentAt.toISOString();
	await db()
		.prepare(
			`INSERT INTO email_delivery_canary (token, status, sent_at, received_at, latency_ms, error, created_at)
			 VALUES (?, 'sent', ?, NULL, NULL, NULL, ?)`,
		)
		.bind(token, iso, iso)
		.run();
}

describe("email_delivery_canary on real D1 (issue #3188)", () => {
	it("writes a send row, completes the round trip on receipt, and reads it in the status rollup", async () => {
		const token = makeCanaryToken();
		const sentAt = new Date(Date.now() - 30_000);
		await insertSentRow(token, sentAt);

		const outcome = await recordCanaryReceipt(
			appEnv,
			canaryMessage(buildCanarySubject(token)),
		);
		expect(outcome).toMatchObject({ kind: "received", token });
		if (outcome.kind !== "received") return;
		expect(outcome.latencyMs).toBeGreaterThanOrEqual(30_000);

		const row = await db()
			.prepare(
				`SELECT status, received_at, latency_ms FROM email_delivery_canary WHERE token = ?`,
			)
			.bind(token)
			.first<{ status: string; received_at: string | null; latency_ms: number | null }>();
		expect(row?.status).toBe("received");
		expect(row?.received_at).toBeTruthy();
		expect(row?.latency_ms).toBe(outcome.latencyMs);

		const status = await getEmailDeliveryStatus(appEnv);
		expect(status.canary.sends).toBe(1);
		expect(status.canary.received).toBe(1);
		expect(status.canary.failed).toBe(0);
		expect(status.canary.successRate).toBe(1);
		expect(status.canary.p50LatencyMs).toBe(outcome.latencyMs);
		expect(status.canary.lastReceivedAt).toBe(row?.received_at);
	});

	it("sweeps late sends to failed and keeps forged unmatched receipts out of the public rate", async () => {
		// A send older than the 10-minute deadline with no receipt is swept to
		// failed by the next tick's sweep — the real UPDATE on the real CHECK.
		const lateToken = makeCanaryToken();
		await insertSentRow(lateToken, new Date(Date.now() - EMAIL_DELIVERY_CANARY_LATE_MS - 60_000));
		const sweep = await sweepCanaryRows(appEnv);
		expect(sweep.markedLate).toBeGreaterThanOrEqual(1);
		const lateRow = await db()
			.prepare(`SELECT status, error FROM email_delivery_canary WHERE token = ?`)
			.bind(lateToken)
			.first<{ status: string; error: string | null }>();
		expect(lateRow?.status).toBe("failed");
		expect(lateRow?.error).toContain("late");

		// A token with no sent row is a forged/unmatched receipt: stored as
		// failed for the sink, but excluded from every public metric.
		const forgedToken = makeCanaryToken();
		const forged = await recordCanaryReceipt(
			appEnv,
			canaryMessage(buildCanarySubject(forgedToken)),
		);
		expect(forged).toMatchObject({ kind: "unmatched", token: forgedToken });
		const forgedRow = await db()
			.prepare(`SELECT status, error FROM email_delivery_canary WHERE token = ?`)
			.bind(forgedToken)
			.first<{ status: string; error: string | null }>();
		expect(forgedRow?.status).toBe("failed");
		expect(forgedRow?.error).toContain("unmatched receipt");

		// Subject lines without a token are unparsable, not failures.
		const unparsable = await recordCanaryReceipt(appEnv, canaryMessage("no token here"));
		expect(unparsable.kind).toBe("unparsable");

		// File-scoped rollup: this file's fixtures are the only canary rows —
		// 1 received (test 1), 1 swept-late failed, 1 forged-unmatched failed.
		const status = await getEmailDeliveryStatus(appEnv);
		expect(status.canary.sends).toBe(2);
		expect(status.canary.received).toBe(1);
		expect(status.canary.failed).toBe(1);
		expect(status.canary.successRate).toBe(0.5);
		expect(status.canary.lastFailure?.error).toContain("late");
		expect(status.canary.lastFailure?.error).not.toContain("unmatched");
	});
});
