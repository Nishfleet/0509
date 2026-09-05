import { reportScheduledTaskFailure } from "../app/lib/cron-failure-alert.server";
import type { AppEnv } from "../app/lib/env.server";
import {
  observeScheduledTask,
  type ReleaseScheduledObservationContext,
} from "../app/lib/release-scheduled-observation.server";

type RecoveryDependencies = {
  recover?: (env: AppEnv) => Promise<number | { attempted: number; alerted: number; failed: number }>;
  reportFailure?: typeof reportScheduledTaskFailure;
  log?: (...values: unknown[]) => void;
  observationContext?: ReleaseScheduledObservationContext;
  observe?: typeof observeScheduledTask;
};

async function recoverDigestScheduleExhaustionAlerts(env: AppEnv) {
  const { reportExhaustedDigestScheduleJobsDetailed } = await import(
    "../app/lib/digest-orchestration.server"
  );
  return reportExhaustedDigestScheduleJobsDetailed(env);
}

export function scheduleDigestScheduleExhaustionRecovery(
  env: AppEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  dependencies: RecoveryDependencies = {},
) {
  const recover = dependencies.recover ?? recoverDigestScheduleExhaustionAlerts;
  const reportFailure = dependencies.reportFailure ?? reportScheduledTaskFailure;
  const log = dependencies.log ?? console.log;
  const recoveryPromise = recover(env);
  if (dependencies.observationContext) {
    (dependencies.observe ?? observeScheduledTask)(
      env,
      ctx,
      {
        ...dependencies.observationContext,
        taskName: "digest_schedule_exhaustion_recovery",
      },
      recoveryPromise,
    );
  }
  ctx.waitUntil(
    recoveryPromise.then(
      (result) => {
        const alerted = typeof result === "number" ? result : result.alerted;
        if (alerted > 0) log("digest schedule exhaustion alerts recovered", { alerted });
      },
      (error) => reportFailure(env, "digest_schedule_exhaustion_recovery", error),
    ),
  );
}
