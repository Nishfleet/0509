import { describe, expect, it } from "vitest";

describe("billing lifecycle delivery facade", () => {
	it("keeps the exact runtime export surface and delivery.server identities", async () => {
		const billing = await import("~/lib/delivery-billing-lifecycle.server");
		const delivery = await import("~/lib/delivery.server");
		const exportedNames = [
			"BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS",
			"BillingLifecycleEmailExplicitFailure",
			"isBillingLifecycleEmailExplicitFailure",
			"prepareBillingLifecycleEmailOutbox",
			"reconcileBillingLifecycleEmailDelivery",
			"recoverAbandonedBillingLifecycleEmails",
			"sendBillingCancellationEmail",
			"sendBillingPaymentIssueEmail",
			"sendBillingRefundEmail",
		].sort();

		expect(Object.keys(billing).sort()).toEqual(exportedNames);
		for (const name of exportedNames) {
			expect((delivery as Record<string, unknown>)[name]).toBe(
				(billing as Record<string, unknown>)[name],
			);
		}
	});
});
