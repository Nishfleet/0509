import { env } from "cloudflare:workers";

import { blankEnvString } from "../env.server";
import { CRAWLER_USER_AGENT } from "../fetch/crawler-identity";
import { fetchOutbound } from "../fetch/outbound.server";

const REACH_TIMEOUT_MS = 4000;

async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetchOutbound(url, {
      method: "HEAD",
      headers: { "User-Agent": CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return true;
  } catch (error) {
    return error instanceof Error && error.name === "TimeoutError";
  }
}

export async function domainAnswers(domain: string): Promise<boolean> {
  if (blankEnvString(env.RIVAL_REACH_CHECK) === "off") return true;
  return (await answers(`https://${domain}/`)) || (await answers(`https://www.${domain}/`));
}
