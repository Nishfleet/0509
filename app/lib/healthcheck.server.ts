import { env } from "cloudflare:workers";

import { blankEnvString } from "./env.server";
import { fetchOutbound } from "./fetch/outbound.server";

export type CheckSignal = "start" | "ok" | "fail";

const PING_KEY = /^[A-Za-z0-9_-]{8,}$/;
const SLUG = /^[a-z0-9-]+$/;

export function checkUrl(key: string | null, slug: string, signal: CheckSignal): string | null {
  if (key === null || !PING_KEY.test(key) || !SLUG.test(slug)) return null;
  const path = signal === "ok" ? slug : `${slug}/${signal}`;
  return `https://hc-ping.com/${key}/${path}?create=1`;
}

function pingEvent(event: string, fields: Record<string, number | string>): void {
  console.warn(JSON.stringify({ event, ...fields }));
}

export async function pingCheck(check: string, signal: CheckSignal, body?: string): Promise<null> {
  const url = checkUrl(blankEnvString(Reflect.get(env, "HEALTHCHECKS_PING_KEY")), check, signal);
  if (url === null) {
    pingEvent("healthcheck.ping_skipped", { check, signal });
    return null;
  }
  try {
    const response = await fetchOutbound(url, {
      method: "POST",
      headers: {},
      body,
      signal: AbortSignal.timeout(10_000),
    });
    pingEvent(response.ok ? "healthcheck.ping_ok" : "healthcheck.ping_failed", {
      check,
      signal,
      status: response.status,
    });
  } catch (error) {
    pingEvent("healthcheck.ping_failed", { check, signal, kind: error instanceof Error ? error.name : "unknown" });
  }
  return null;
}
