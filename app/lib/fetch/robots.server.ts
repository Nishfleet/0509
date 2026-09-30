import robotsParser from "robots-parser";

import { cappedText, fetchOutbound } from "./outbound.server";

const ROBOTS_TIMEOUT_MS = 5_000;

const MAX_ROBOTS_BYTES = 256 * 1024;

const ROBOTS_AGENT = "FiveToNineBot";

export const CRAWLER_USER_AGENT = `${ROBOTS_AGENT}/1.0 (+https://0509.io)`;

const ROBOTS_HEADERS = { "user-agent": CRAWLER_USER_AGENT };

export async function robotsAllows(url: string): Promise<boolean> {
  const robotsUrl = new URL("/robots.txt", url).toString();
  try {
    const response = await fetchOutbound(robotsUrl, {
      headers: ROBOTS_HEADERS,
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return true;
    }
    const body = await cappedText(response, MAX_ROBOTS_BYTES);
    if (body === null) return true;
    return robotsParser(robotsUrl, body).isDisallowed(url, ROBOTS_AGENT) !== true;
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "robots.read_failed",
        error: error instanceof Error ? error.name : typeof error,
      }),
    );
    return true;
  }
}
