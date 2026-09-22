import { z } from "zod";

const ContentResponse = z.object({ success: z.boolean().optional(), result: z.string().optional() });

export interface BrowserBinding {
  quickAction(
    action: "content",
    options: { url: string; timeout?: number },
  ): Promise<Response>;
}

export type TransportResult =
  | {
      ok: true;
      html: string;
      transport: "fetch" | "browser";
      status: number;
      ms: number;
      browserMsUsed: number | null;
    }
  | { ok: false; reason: string; status: number | null; ms: number };

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MIN_TEXT_CHARS = 200;
const PROBE_TIMEOUT_MS = 8_000;

function visibleLength(html: string): number {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

export async function fetchPage(
  url: string,
  browser?: BrowserBinding,
  fetchImpl: typeof fetch = fetch,
): Promise<TransportResult> {
  const started = Date.now();
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    const html = res.ok ? await res.text() : "";
    if (res.ok && visibleLength(html) >= MIN_TEXT_CHARS) {
      return { ok: true, html, transport: "fetch", status: res.status, ms: Date.now() - started, browserMsUsed: null };
    }
    if (!browser) {
      return {
        ok: false,
        reason: res.ok ? "thin-body" : `http-${String(res.status)}`,
        status: res.status,
        ms: Date.now() - started,
      };
    }
  } catch (err) {
    if (!browser) {
      return {
        ok: false,
        reason: err instanceof Error ? err.name : "fetch-failed",
        status: null,
        ms: Date.now() - started,
      };
    }
  }

  if (!browser) {
    return { ok: false, reason: "no-browser", status: null, ms: Date.now() - started };
  }
  try {
    const res = await browser.quickAction("content", { url });
    const browserMsUsed = Number(res.headers.get("X-Browser-Ms-Used") ?? "") || null;
    if (!res.ok) {
      return { ok: false, reason: `browser-${String(res.status)}`, status: res.status, ms: Date.now() - started };
    }
    const body = ContentResponse.parse(await res.json());
    const html = typeof body.result === "string" ? body.result : "";
    if (!html) {
      return { ok: false, reason: "browser-empty", status: res.status, ms: Date.now() - started };
    }
    return { ok: true, html, transport: "browser", status: res.status, ms: Date.now() - started, browserMsUsed };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.name : "browser-failed",
      status: null,
      ms: Date.now() - started,
    };
  }
}
