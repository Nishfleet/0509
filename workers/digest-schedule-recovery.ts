import { reportScheduledTaskFailure } from "../app/lib/cron-failure-alert.server";
import type { AppEnv } from "../app/lib/env.server";

type RecoveryDependencies = {
  recover?: (env: AppEnv) => Promise<number>;
  reportFailure?: typeof reportScheduledTaskFailure;
  log?: (...values: unknown[]) => void;
};

async function recoverDigestScheduleExhaustionAlerts(env: AppEnv) {
  const { reportExhaustedDigestScheduleJobs } = await import(
    "../app/lib/digest-orchestration.server"
  );
  return reportExhaustedDigestScheduleJobs(env);
}

export function scheduleDigestScheduleExhaustionRecovery(
  env: AppEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  dependencies: RecoveryDependencies = {},
) {
  const recover = dependencies.recover ?? recoverDigestScheduleExhaustionAlerts;
  const reportFailure = dependencies.reportFailure ?? reportScheduledTaskFailure;
  const log = dependencies.log ?? console.log;
  ctx.waitUntil(
    recover(env).then(
      (alerted) => {
        if (alerted > 0) log("digest schedule exhaustion alerts recovered", { alerted });
      },
      (error) => reportFailure(env, "digest_schedule_exhaustion_recovery", error),
    ),
  );
}
