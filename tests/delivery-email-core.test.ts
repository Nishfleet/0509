import { describe, expect, it, vi } from "vitest";

import {
	isRecipientRejection,
	sendCloudflareEmail,
} from "~/lib/delivery-email-core.server";

const NOW = new Date("2026-09-12T00:00:00.000Z");

/** A bounce row written recently enough to still be inside the TTL. */
function recentBounce(consecutiveFailures: number) {
	return {
		reason: "bounce",
		consecutive_failures: consecutiveFailures,
		updated_at: NOW.toISOString(),
	};
}

type FakeSuppressionRow = {
	reason: string;
	consecutive_failures: number;
	updated_at?: string;
};

/**
 * Minimal D1 double: the suppression consult uses queryAll (`.all()`) and the
 * bookkeeping writes use execute (`.run()`). Executed SQL + bindings are
 * captured so the test asserts the ledger was actually consulted/written, not
 * just that no error surfaced.
 */
function suppressionDb(rows: FakeSuppressionRow[] = []) {
	const ran: Array<{ sql: string; bindings: unknown[] }> = [];
	const db = {
		prepare: (sql: string) => ({
			bind: (...bindings: unknown[]) => ({
				all: async () => ({ results: rows.map((row) => ({ ...row })) }),
				run: async () => {
					ran.push({ sql, bindings });
					return { success: true };
				},
			}),
		}),
	};
	return { db, ran };
}

const baseInput = {
	to: "owner@example.test",
	subject: "Suppression consult",
	html: "<p>Suppression consult</p>",
	tag: "suppression-test",
	unsubscribeUrl: null,
} as const;

describe("Cloudflare email provider boundary", () => {
	it("classifies a missing provider binding as a definite pre-dispatch failure", async () => {
		const send = vi.fn();

		await expect(
			sendCloudflareEmail(
				{
					EMAIL_FROM_EMAIL: "alerts@0509.io",
				} as never,
				{ ...baseInput },
			),
		).resolves.toMatchObject({
			status: "failed",
			webhookStatus: "failed",
			providerMessageId: null,
			providerStatusLastSeenAt: null,
		});
		expect(send).not.toHaveBeenCalled();
	});

	it("never calls the provider for a complaint-suppressed address (issue #2983)", async () => {
		const { db, ran } = suppressionDb([{ reason: "complaint", consecutive_failures: 0 }]);
		const send = vi.fn(async () => ({ messageId: "m1" }));

		await expect(
			sendCloudflareEmail(
				{ EMAIL_FROM_EMAIL: "alerts@0509.io", EMAIL: { send }, DB: db } as never,
				{ ...baseInput },
			),
		).resolves.toMatchObject({
			status: "failed",
			webhookStatus: "failed",
			errorMessage: expect.stringContaining("complaint-suppressed"),
		});
		expect(send).not.toHaveBeenCalled();
		expect(ran).toHaveLength(0);
	});

	it("never calls the provider once consecutive bounces reach the threshold (issue #2983)", async () => {
		const { db, ran } = suppressionDb([recentBounce(3)]);
		const send = vi.fn(async () => ({ messageId: "m2" }));

		await expect(
			sendCloudflareEmail(
				{ EMAIL_FROM_EMAIL: "alerts@0509.io", EMAIL: { send }, DB: db } as never,
				{ ...baseInput },
			),
		).resolves.toMatchObject({
			status: "failed",
			errorMessage: expect.stringContaining("bounce-suppressed after 3 consecutive"),
		});
		expect(send).not.toHaveBeenCalled();
		expect(ran).toHaveLength(0);
	});

	it("still sends when consecutive bounces are below the threshold, and the acceptance clears the bounce ledger", async () => {
		const { db, ran } = suppressionDb([recentBounce(2)]);
		const send = vi.fn(async () => ({ messageId: "m3" }));

		await expect(
			sendCloudflareEmail(
				{ EMAIL_FROM_EMAIL: "alerts@0509.io", EMAIL: { send }, DB: db } as never,
				{ ...baseInput },
			),
		).resolves.toMatchObject({ status: "sent", providerMessageId: "m3" });
		expect(send).toHaveBeenCalledTimes(1);

		const deletes = ran.filter((entry) => /DELETE FROM email_suppression/.test(entry.sql));
		expect(deletes).toHaveLength(1);
		expect(deletes[0].bindings).toEqual(["owner@example.test"]);
	});

	it("records a consecutive bounce when the provider definitively fails (issue #2983)", async () => {
		const { db, ran } = suppressionDb([]);
		const send = vi.fn(async () => {
			throw new Error("no such mailbox here");
		});

		await expect(
			sendCloudflareEmail(
				{ EMAIL_FROM_EMAIL: "alerts@0509.io", EMAIL: { send }, DB: db } as never,
				{ ...baseInput },
			),
		).resolves.toMatchObject({
			status: "failed",
			errorMessage: expect.stringContaining("no such mailbox here"),
		});
		expect(send).toHaveBeenCalledTimes(1);

		const inserts = ran.filter((entry) => /INSERT INTO email_suppression/.test(entry.sql));
		expect(inserts).toHaveLength(1);
		expect(inserts[0].bindings).toEqual([
			"owner@example.test",
			"provider_recipient_rejected",
			"no such mailbox here",
			expect.any(String),
			expect.any(String),
		]);
	});

	it("does NOT count a provider outage as a bounce (issue #2983 review)", async () => {
		// A 5xx/rate-limit/misconfiguration fails every recipient on the same
		// tick. Counting it would suppress the whole customer base at once.
		const { db, ran } = suppressionDb([]);
		const send = vi.fn(async () => {
			throw new Error("502 Bad Gateway from provider");
		});

		await expect(
			sendCloudflareEmail(
				{ EMAIL_FROM_EMAIL: "alerts@0509.io", EMAIL: { send }, DB: db } as never,
				{ ...baseInput },
			),
		).resolves.toMatchObject({
			status: "failed",
			errorMessage: expect.stringContaining("502 Bad Gateway"),
		});

		expect(
			ran.filter((entry) => /INSERT INTO email_suppression/.test(entry.sql)),
		).toHaveLength(0);
	});

	it("does NOT count an unclassified error as a bounce (issue #2983 review)", async () => {
		const { db, ran } = suppressionDb([]);
		const send = vi.fn(async () => {
			throw new Error("Error: connect ECONNREFUSED");
		});

		await sendCloudflareEmail(
			{ EMAIL_FROM_EMAIL: "alerts@0509.io", EMAIL: { send }, DB: db } as never,
			{ ...baseInput },
		);

		expect(
			ran.filter((entry) => /INSERT INTO email_suppression/.test(entry.sql)),
		).toHaveLength(0);
	});

	it("keeps sending when no DB binding exists — the consult fails open (issue #2983)", async () => {
		const send = vi.fn(async () => ({ messageId: "m4" }));

		await expect(
			sendCloudflareEmail(
				{ EMAIL_FROM_EMAIL: "alerts@0509.io", EMAIL: { send } } as never,
				{ ...baseInput },
			),
		).resolves.toMatchObject({ status: "sent", providerMessageId: "m4" });
		expect(send).toHaveBeenCalledTimes(1);
	});
});

describe("isRecipientRejection — outage vs dead mailbox (issue #2983 review)", () => {
	it("counts errors that name the recipient or mailbox", () => {
		for (const message of [
			"550 5.1.1 recipient address rejected",
			"Invalid recipient: owner@example.test",
			"no such mailbox here",
			"User unknown",
			"invalid address format",
		]) {
			expect(isRecipientRejection(new Error(message)), message).toBe(true);
		}
	});

	it("does NOT count a provider-wide fault, so an outage cannot suppress everyone", () => {
		for (const message of [
			"502 Bad Gateway",
			"503 Service Unavailable",
			"429 Too Many Requests",
			"connect ECONNREFUSED 127.0.0.1:443",
			"Email sending is not configured for this environment.",
			"upstream request timeout",
		]) {
			expect(isRecipientRejection(new Error(message)), message).toBe(false);
		}
	});

	it("does not count a thrown non-Error", () => {
		expect(isRecipientRejection("recipient rejected")).toBe(false);
		expect(isRecipientRejection(undefined)).toBe(false);
	});
});
