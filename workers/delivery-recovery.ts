import { reportScheduledTaskFailure } from "../app/lib/cron-failure-alert.server";
import type { AppEnv } from "../app/lib/env.server";
import {
	observeScheduledTask,
	type ReleaseScheduledObservationContext,
} from "../app/lib/release-scheduled-observation.server";

type BillingLifecycleRecoveryResult = {
	claimed: number;
};

type RecoveryDependencies = {
	recover?: (env: AppEnv) => Promise<BillingLifecycleRecoveryResult>;
	reportFailure?: typeof reportScheduledTaskFailure;
	log?: (...values: unknown[]) => void;
	observationContext?: ReleaseScheduledObservationContext;
	observe?: typeof observeScheduledTask;
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
	const recoveryPromise = recover(env);
	if (dependencies.observationContext) {
		(dependencies.observe ?? observeScheduledTask)(
			env,
			ctx,
			{
				...dependencies.observationContext,
				taskName: "billing_lifecycle_email_recovery",
			},
			recoveryPromise,
		);
	}

	ctx.waitUntil(
		recoveryPromise.then(
			(result) => {
				if (result.claimed > 0) {
					log("billing lifecycle email recovery completed", result);
				}
			},
			(error) => reportFailure(env, "billing_lifecycle_email_recovery", error),
		),
	);
}
