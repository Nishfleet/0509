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

export async function breakageRepaired(url: string, beforeKey: string | null): Promise<boolean> {
  if (beforeKey === null) return false;
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
    return false;
  }
  const html = await cappedText(response, MAX_PAGE_BYTES);
  if (html === null) return false;
  const afterText = (await extractPageText(html)).text;
  const before = await env.SNAPSHOTS.get(beforeKey);
  if (before === null) return false;
  const e = computeBreakageEvidence({
    status: response.status,
    beforeText: await before.text(),
    afterText,
  });
  return !showsBreakage(e);
}

export async function breakageConfirmed(evidence: BreakageEvidence, url: string, beforeKey: string): Promise<boolean> {
  return showsBreakage(evidence) && !(await breakageRepaired(url, beforeKey));
}
