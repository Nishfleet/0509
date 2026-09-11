import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
	clearEmailBounceSuppression,
	listEmailSuppressionRows,
	recordEmailBounceFailure,
	recordEmailComplaintSuppression,
	EMAIL_SUPPRESS_AFTER_CONSECUTIVE_FAILURES,
} from "~/lib/data/delivery-records-email-suppression.server";
import { sendCloudflareEmail } from "~/lib/delivery-email-core.server";

import { appEnv, uid } from "./fixtures";

/**
 * Issue #2983 — bounce/complaint suppression, exercised against the REAL D1
 * (the workers project applied the full migration chain, 0096 included).
 *
 * Three truths, no mocks of the suppression module:
 *   1. WRITE: a definite provider failure records a consecutive bounce, and a
 *      successful acceptance clears it;
 *   2. READ: a suppressed address is consulted BEFORE the provider send, so
 *      the EMAIL binding is never called for it (the "never sent to" test);
 *   3. the module's SQL survives the real migration's CHECK/UNIQUE shape
 *      (upsert conflict target, composite (address, reason) key).
 */

function emailEnv(emailSend: (msg: unknown) => Promise<{ messageId: string }>): AppEnv {
	return {
		...appEnv,
		EMAIL: { send: vi.fn(emailSend) },
		EMAIL_FROM_EMAIL: "alerts@0509.io",
	} as AppEnv;
}

function uniqueAddress(tag: string) {
	return `${tag}-${uid("a").toLowerCase()}@example.test`;
}

describe("email suppression (issue #2983) — real migrated D1", () => {
	it("records consecutive bounces on definite failures and clears on acceptance", async () => {
		const address = uniqueAddress("bounce");
		const failing = emailEnv(async () => {
			throw new Error("no such mailbox");
		});

		for (let i = 1; i <= EMAIL_SUPPRESS_AFTER_CONSECUTIVE_FAILURES - 1; i += 1) {
			await expect(
				sendCloudflareEmail(failing, {
					to: address,
					subject: "bounce counting",
					html: "<p>bounce counting</p>",
					tag: "suppression-test",
					unsubscribeUrl: null,
				}),
			).resolves.toMatchObject({ status: "failed" });

			const rows = await listEmailSuppressionRows(appEnv, address);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				address,
				reason: "bounce",
				source: "provider_send_failed",
				consecutiveFailures: i,
			});
		}

		// A successful acceptance heals the address: the bounce row is deleted.
		const succeeding = emailEnv(async () => ({ messageId: "m1" }));
		await expect(
			sendCloudflareEmail(succeeding, {
				to: address,
				subject: "heals",
				html: "<p>heals</p>",
				tag: "suppression-test",
				unsubscribeUrl: null,
			}),
		).resolves.toMatchObject({ status: "sent" });
		expect(await listEmailSuppressionRows(appEnv, address)).toHaveLength(0);

		// Failure counting starts over from 1 after the heal.
		await expect(
			sendCloudflareEmail(failing, {
				to: address,
				subject: "counting restarts",
				html: "<p>counting restarts</p>",
				tag: "suppression-test",
				unsubscribeUrl: null,
			}),
		).resolves.toMatchObject({ status: "failed" });
		const restarted = await listEmailSuppressionRows(appEnv, address);
		expect(restarted).toHaveLength(1);
		expect(restarted[0]).toMatchObject({ consecutiveFailures: 1 });

		// Clearing is a no-op (not a throw) for an address that was never
		// recorded — the success bookkeeping runs on every accepted send.
		await clearEmailBounceSuppression(appEnv, uniqueAddress("never"));
	});

	it("never calls the provider for a bounce-suppressed address", async () => {
		const address = uniqueAddress("suppressed");

		const failing = emailEnv(async () => {
			throw new Error("hard bounce");
		});
		for (let i = 0; i < EMAIL_SUPPRESS_AFTER_CONSECUTIVE_FAILURES; i += 1) {
			await sendCloudflareEmail(failing, {
				to: address,
				subject: "counting",
				html: "<p>counting</p>",
				tag: "suppression-test",
				unsubscribeUrl: null,
			});
		}

		const untouched = emailEnv(async () => ({ messageId: "m2" }));
		const email = untouched.EMAIL!.send as ReturnType<typeof vi.fn>;
		await expect(
			sendCloudflareEmail(untouched, {
				to: address,
				subject: "must be skipped",
				html: "<p>must be skipped</p>",
				tag: "suppression-test",
				unsubscribeUrl: null,
			}),
		).resolves.toMatchObject({
			status: "failed",
			errorMessage: expect.stringContaining("bounce-suppressed after 3 consecutive"),
		});
		expect(email).not.toHaveBeenCalled();
	});

	it("never calls the provider for a complaint-suppressed address, even with zero failures", async () => {
		const address = uniqueAddress("complaint");
		await recordEmailComplaintSuppression(appEnv, {
			address,
			source: "relay_complaint_test",
			detail: "feedback loop",
		});

		const env = emailEnv(async () => ({ messageId: "m3" }));
		const email = env.EMAIL!.send as ReturnType<typeof vi.fn>;
		await expect(
			sendCloudflareEmail(env, {
				to: address,
				subject: "complaint skip",
				html: "<p>complaint skip</p>",
				tag: "suppression-test",
				unsubscribeUrl: null,
			}),
		).resolves.toMatchObject({
			status: "failed",
			errorMessage: expect.stringContaining("complaint-suppressed"),
		});
		expect(email).not.toHaveBeenCalled();
	});
});
