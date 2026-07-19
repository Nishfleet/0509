import { describe, expect, it, vi } from "vitest";

import { scheduleBillingLifecycleEmailRecovery } from "../workers/delivery-recovery";

describe("scheduled billing lifecycle email recovery", () => {
	it("registers the bounded recovery promise and logs claimed work", async () => {
		const pending: Promise<unknown>[] = [];
		const recover = vi.fn().mockResolvedValue({ claimed: 1 });
		const reportFailure = vi.fn();
		const log = vi.fn();

		scheduleBillingLifecycleEmailRecovery(
			{} as never,
			{ waitUntil: (promise) => pending.push(promise) },
			{ recover, reportFailure, log },
		);

		expect(pending).toHaveLength(1);
		await pending[0];
		expect(recover).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith(
			"billing lifecycle email recovery completed",
			{ claimed: 1 },
		);
		expect(reportFailure).not.toHaveBeenCalled();
	});

	it("reports recovery failures under the dedicated scheduled-task key", async () => {
		const pending: Promise<unknown>[] = [];
		const error = new Error("recovery failed");
		const recover = vi.fn().mockRejectedValue(error);
		const reportFailure = vi.fn().mockResolvedValue({ sent: false, reason: "no_db" });

		scheduleBillingLifecycleEmailRecovery(
			{} as never,
			{ waitUntil: (promise) => pending.push(promise) },
			{ recover, reportFailure, log: vi.fn() },
		);

		await pending[0];
		expect(reportFailure).toHaveBeenCalledWith(
			expect.anything(),
			"billing_lifecycle_email_recovery",
			error,
		);
	});

	it("observes the exact original recovery promise without changing the existing work chain", async () => {
		const pending: Promise<unknown>[] = [];
		const recoveryPromise = Promise.resolve({ claimed: 0 });
		const recover = vi.fn().mockReturnValue(recoveryPromise);
		const observe = vi.fn((_env, _ctx, _input, promise) => promise);
		const observationContext = { cron: "0 */3 * * *", scheduledTime: 1_768_521_600_000 };

		scheduleBillingLifecycleEmailRecovery(
			{} as never,
			{ waitUntil: (promise) => pending.push(promise) },
			{ recover, observe: observe as never, observationContext },
		);

		expect(observe).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			{ ...observationContext, taskName: "billing_lifecycle_email_recovery" },
			recoveryPromise,
		);
		expect(pending).toHaveLength(1);
		await pending[0];
	});
});
