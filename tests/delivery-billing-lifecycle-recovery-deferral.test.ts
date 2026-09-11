import { describe, expect, it, vi } from "vitest";

import { BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS } from "~/lib/delivery-billing-lifecycle-recovery.server";

import { setupBillingLifecycleDelivery } from "./helpers/billing-lifecycle-delivery";

const {
	emailEnv, mockEmailSend, recoveryAttempt, useRecoveryClock,
	recoverBilling, mockBillingDataServer, trackAttemptUpdates,
} = setupBillingLifecycleDelivery();

describe("billing lifecycle recovery deferral", () => {
	it("increments recoveryAttemptCount on each deferral and fails terminally at the cap", async () => {
		useRecoveryClock();
		const sendMock = mockEmailSend("msg_deferral_must_not_send");
		const maxAttempts = BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS;
		const attempt = recoveryAttempt(
			"attempt-deferral-cap",
			"billing_refund_revoked",
			{},
			{ targetValue: "gone@example.com" },
		);
		const listStaleBillingLifecycleEmailAttempts = vi.fn(
			async (
				_env: unknown,
				input: { staleBefore: string; maxRecoveryAttempts: number },
			) => {
				const count = Number(
					attempt.payloadSnapshot.recoveryAttemptCount ?? 0,
				);
				return attempt.status === "pending" &&
					attempt.webhookStatus === "pending" &&
					attempt.updatedAt <= input.staleBefore &&
					count < input.maxRecoveryAttempts
					? [attempt]
					: [];
			},
		);
		const updateDeliveryAttemptResult = trackAttemptUpdates(attempt);
		mockBillingDataServer({
			getUserDeliveryProfile: vi.fn().mockResolvedValue({
				email: "u@x.com",
				emailVerified: false,
				name: "Owner",
			}),
			listStaleBillingLifecycleEmailAttempts,
			updateDeliveryAttemptResult,
		});
		const env = { ...emailEnv, DB: {} } as never;

		const runs: Awaited<ReturnType<typeof recoverBilling>>[] = [];
		for (let i = 0; i <= maxAttempts; i += 1) {
			runs.push(await recoverBilling(env));
			vi.setSystemTime(new Date(Date.now() + 120_000));
		}

		expect(runs[0]).toMatchObject({ scanned: 1, claimed: 1, failed: 0 });
		expect(runs[maxAttempts - 1]).toMatchObject({
			scanned: 1,
			claimed: 1,
			failed: 1,
		});
		expect(runs[maxAttempts]).toMatchObject({ scanned: 0 });
		const lastCall = updateDeliveryAttemptResult.mock.calls.at(-1);
		expect(lastCall?.[2]).toMatchObject({
			status: "failed",
			webhookStatus: "failed",
			errorMessage:
				"Billing lifecycle recovery recipient is not verified.",
		});
		expect(attempt).toMatchObject({
			status: "failed",
			webhookStatus: "failed",
		});
		expect(attempt.payloadSnapshot.recoveryAttemptCount).toBe(maxAttempts);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("counts a reconciled-failure deferral toward the same recovery cap", async () => {
		useRecoveryClock();
		const sendMock = mockEmailSend("msg_reconciled_deferral_must_not_send");
		const maxAttempts = BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS;
		const attempt = recoveryAttempt(
			"attempt-reconciled-deferral",
			"billing_refund_revoked",
			{
				recoveryAttemptCount: maxAttempts - 1,
				billingLifecycleProviderEvidence: {
					reference: "cf-event-deferral",
					classification: "provider_rejected",
					observedAt: "2026-07-13T09:01:00.000Z",
					outcome: "failed",
				},
			},
			{
				status: "failed",
				webhookStatus: "failed",
				providerStatusLastSeenAt: "2026-07-13T09:04:00.000Z",
				failedAt: "2026-07-13T09:04:00.000Z",
				errorMessage: "Provider rejected the billing email.",
			},
		);
		const listStaleBillingLifecycleEmailAttempts = vi.fn(
			async (
				_env: unknown,
				input: { staleBefore: string; maxRecoveryAttempts: number },
			) => {
				const count = Number(
					attempt.payloadSnapshot.recoveryAttemptCount ?? 0,
				);
				const reconciledFailed =
					attempt.status === "failed" &&
					attempt.webhookStatus === "failed" &&
					attempt.providerStatusLastSeenAt !== null &&
					attempt.payloadSnapshot.billingLifecycleProviderEvidence !==
						undefined &&
					count < input.maxRecoveryAttempts;
				const stalePending =
					attempt.status === "pending" &&
					attempt.webhookStatus === "pending" &&
					attempt.updatedAt <= input.staleBefore &&
					count < input.maxRecoveryAttempts;
				return reconciledFailed || stalePending ? [attempt] : [];
			},
		);
		const updateDeliveryAttemptResult = trackAttemptUpdates(attempt);
		mockBillingDataServer({
			getUserDeliveryProfile: vi.fn().mockResolvedValue({
				email: "u@x.com",
				emailVerified: false,
				name: "Owner",
			}),
			listStaleBillingLifecycleEmailAttempts,
			updateDeliveryAttemptResult,
		});
		const env = { ...emailEnv, DB: {} } as never;

		const run = await recoverBilling(env);
		expect(run).toMatchObject({ scanned: 1, claimed: 1, failed: 1 });
		expect(sendMock).not.toHaveBeenCalled();
		expect(attempt).toMatchObject({
			status: "failed",
			webhookStatus: "failed",
		});
		expect(attempt.payloadSnapshot.recoveryAttemptCount).toBe(maxAttempts);
		expect(
			attempt.payloadSnapshot.billingLifecycleProviderEvidence,
		).toBeDefined();

		vi.setSystemTime(new Date(Date.now() + 120_000));
		await expect(recoverBilling(env)).resolves.toMatchObject({ scanned: 0 });
	});
});
