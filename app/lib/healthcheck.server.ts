import { env } from "cloudflare:workers";

import { blankEnvString } from "./env.server";
import { pingLiveness } from "./liveness-ping.server";

export type CheckSignal = "start" | "ok" | "fail";

const PING_KEY = /^[A-Za-z0-9_-]{8,}$/;
const SLUG = /^[a-z0-9-]+$/;

export function checkUrl(key: string | null, slug: string, signal: CheckSignal): string | null {
  if (key === null || !PING_KEY.test(key) || !SLUG.test(slug)) return null;
  const path = signal === "ok" ? slug : `${slug}/${signal}`;
  return `https://hc-ping.com/${key}/${path}?create=1`;
}

export async function pingCheck(slug: string, signal: CheckSignal): Promise<null> {
  const url = checkUrl(blankEnvString(Reflect.get(env, "HEALTHCHECKS_PING_KEY")), slug, signal);
  try {
    await pingLiveness(url ?? undefined);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "healthcheck.ping_failed",
        signal,
        kind: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
  return null;
}
