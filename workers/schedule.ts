import { ADS_SWEEP_CRON, assertBrowserCap } from "./ads-cap";

export { ADS_SWEEP_CRON };

type AdsSweepStarter = Pick<
  Env,
  "BROWSER_CONCURRENCY_CAP" | "PAGE_SWEEP_MAX_CONCURRENCY" | "ADS_SWEEP"
>;

export function sweepInstanceId(scheduledTime: number): { id: string; tick: string } {
  const tick = new Date(scheduledTime).toISOString().slice(0, 10);
  return { id: `ads-sweep-${tick}`, tick };
}

const INSTANCE_NOT_FOUND = "instance.not_found";
const INSTANCE_ALREADY_EXISTS = "instance.already_exists";

function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  if ("code" in err && typeof err.code === "string") return err.code;
  if (!(err instanceof Error)) return undefined;
  if (err.message === INSTANCE_NOT_FOUND || err.message === INSTANCE_ALREADY_EXISTS) {
    return err.message;
  }
  return undefined;
}

async function workflowInstanceExists(
  binding: AdsSweepStarter["ADS_SWEEP"],
  id: string,
): Promise<boolean> {
  try {
    await binding.get(id);
    return true;
  } catch (err) {
    if (errorCode(err) === INSTANCE_NOT_FOUND) return false;
    throw err;
  }
}

export async function startAdsSweep(
  env: AdsSweepStarter,
  scheduledTime: number,
): Promise<string> {
  assertBrowserCap(
    Number(env.PAGE_SWEEP_MAX_CONCURRENCY),
    Number(env.BROWSER_CONCURRENCY_CAP),
  );
  const instance = sweepInstanceId(scheduledTime);
  if (await workflowInstanceExists(env.ADS_SWEEP, instance.id)) return instance.id;
  try {
    await env.ADS_SWEEP.create({
      id: instance.id,
      params: { tick: instance.tick },
    });
  } catch (err) {
    if (errorCode(err) !== INSTANCE_ALREADY_EXISTS) throw err;
  }
  return instance.id;
}
