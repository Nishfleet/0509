import { describe, expect, it, vi } from "vitest";

import { sendCloudflareEmail } from "~/lib/delivery-email-core.server";

type FakeSuppressionRow = {
	reason: string;
	consecutive_failures: number;
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
		const { db, ran } = suppressionDb([{ reason: "bounce", consecutive_failures: 3 }]);
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
		const { db, ran } = suppressionDb([{ reason: "bounce", consecutive_failures: 2 }]);
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
			"provider_send_failed",
			"no such mailbox here",
			expect.any(String),
			expect.any(String),
		]);
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
