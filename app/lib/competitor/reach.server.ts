import { env } from "cloudflare:workers";

import { blankEnvString } from "../env.server";
import { CRAWLER_USER_AGENT } from "../fetch/crawler-identity";
import { fetchOutbound } from "../fetch/outbound.server";

const REACH_TIMEOUT_MS = 4000;
const ORIGIN_DNS_ERROR_STATUS = 530;

async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetchOutbound(url, {
      method: "HEAD",
      headers: { "User-Agent": CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.status !== ORIGIN_DNS_ERROR_STATUS;
  } catch (error) {
    return error instanceof Error && error.name === "TimeoutError";
  }
}

export async function domainAnswers(domain: string): Promise<boolean> {
  if (blankEnvString(env.RIVAL_REACH_CHECK) === "off") return true;
  const [apex, www] = await Promise.all([answers(`https://${domain}/`), answers(`https://www.${domain}/`)]);
  return apex || www;
}
