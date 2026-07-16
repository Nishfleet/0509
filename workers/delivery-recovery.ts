import { reportScheduledTaskFailure } from "../app/lib/cron-failure-alert.server";
import type { AppEnv } from "../app/lib/env.server";

type BillingLifecycleRecoveryResult = {
	claimed: number;
};

type RecoveryDependencies = {
	recover?: (env: AppEnv) => Promise<BillingLifecycleRecoveryResult>;
	reportFailure?: typeof reportScheduledTaskFailure;
	log?: (...values: unknown[]) => void;
};

async function recoverBillingLifecycleEmails(env: AppEnv) {
	const { recoverAbandonedBillingLifecycleEmails } = await import(
		"../app/lib/delivery.server"
	);
	return recoverAbandonedBillingLifecycleEmails(env);
}

export function scheduleBillingLifecycleEmailRecovery(
	env: AppEnv,
	ctx: Pick<ExecutionContext, "waitUntil">,
	dependencies: RecoveryDependencies = {},
) {
	const recover = dependencies.recover ?? recoverBillingLifecycleEmails;
	const reportFailure = dependencies.reportFailure ?? reportScheduledTaskFailure;
	const log = dependencies.log ?? console.log;

	ctx.waitUntil(
		recover(env).then(
			(result) => {
				if (result.claimed > 0) {
					log("billing lifecycle email recovery completed", result);
				}
			},
			(error) => reportFailure(env, "billing_lifecycle_email_recovery", error),
		),
	);
}
