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
});
