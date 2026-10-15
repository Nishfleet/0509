import { env } from "cloudflare:workers";

import { cappedText, fetchOutbound } from "../fetch/outbound.server";
import { CRAWLER_USER_AGENT } from "../fetch/robots.server";
import { computeBreakageEvidence, showsBreakage, type BreakageEvidence } from "./breakage-evidence";
import { extractPageText } from "./extract-text";

export const PROBE_TIMEOUT_MS = 10_000;

const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export const PROBE_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "user-agent": CRAWLER_USER_AGENT,
} as const;

export async function readFreshEvidence(url: string, beforeKey: string | null): Promise<BreakageEvidence | null> {
  if (beforeKey === null) return null;
  let response: Response;
  try {
    response = await fetchOutbound(url, {
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "site.own_check_verify_failed",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return null;
  }
  const html = await cappedText(response, MAX_PAGE_BYTES);
  if (html === null) return null;
  const afterText = (await extractPageText(html)).text;
  const before = await env.SNAPSHOTS.get(beforeKey);
  if (before === null) return null;
  return computeBreakageEvidence({
    status: response.status,
    beforeText: await before.text(),
    afterText,
  });
}

export async function breakageConfirmed(evidence: BreakageEvidence, url: string, beforeKey: string): Promise<boolean> {
  if (!showsBreakage(evidence)) return false;
  const fresh = await readFreshEvidence(url, beforeKey);
  return fresh === null || showsBreakage(fresh);
}
