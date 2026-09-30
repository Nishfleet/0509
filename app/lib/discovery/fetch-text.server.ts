import { cappedText, fetchOutbound } from "../fetch/outbound.server";
import { CRAWLER_USER_AGENT } from "../fetch/robots.server";
import type { FetchText } from "./types";

const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export function defaultFetchText(event: string, timeoutMs = 8_000): FetchText {
  return async (url) => {
    try {
      const response = await fetchOutbound(url, {
        headers: { "user-agent": CRAWLER_USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await cappedText(response, MAX_PAGE_BYTES);
      if (body === null) return { ok: false, status: 0, url, contentType: null, body: "" };
      return {
        ok: response.ok,
        status: response.status,
        url: response.url,
        contentType: response.headers.get("content-type"),
        body,
      };
    } catch (error) {
      console.error(JSON.stringify({ event, error: String(error) }));
      return { ok: false, status: 0, url, contentType: null, body: "" };
    }
  };
}
