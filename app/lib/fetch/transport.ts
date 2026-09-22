import { env } from "cloudflare:workers";

const FETCH_TIMEOUT_MS = 8_000;

const MIN_EXTRACTED_CHARS = 200;

type Transport = "fetch" | "browser";

interface ReadUrlSuccess {
  ok: true;
  html: string;
  transport: Transport;
  status: number;
  ms: number;
  browserMsUsed?: number;
  escalated: boolean;
}

type ReadUrlFailure =
  | { ok: false; reason: "invalid-url"; detail: string }
  | { ok: false; reason: "fetch-failed"; detail: string }
  | { ok: false; reason: "escalation-failed"; detail: string };

export type ReadUrlResult = ReadUrlSuccess | ReadUrlFailure;

const CHALLENGE_MARKERS = [
  "cf-browser-verification",
  "cf_chl_opt",
  "just a moment",
  "checking if the site connection is secure",
  "attention required! | cloudflare",
  "enable javascript and cookies to continue",
  "ddos protection by cloudflare",
  "détection d'une activité anormale",
  "unusual traffic from your computer network",
  "are you a robot",
  "verification successful. waiting for",
] as const;

export async function countExtractedChars(html: string): Promise<number> {
  let chars = 0;
  let text = "";

  const flush = () => {
    chars += text.length;
    text = "";
  };

  const accumulate = {
    text(chunk: { text: string; lastInTextNode: boolean }) {
      text += chunk.text;
      if (chunk.lastInTextNode) flush();
    },
  };

  const discard = {
    text() {
      text = "";
    },
  };

  const transformed = new HTMLRewriter()
    .on("script, style, noscript, template", discard)
    .on("*", accumulate)
    .transform(new Response(html));

  await transformed.text();
  flush();
  return chars;
}

async function fetchRefused(
  status: number,
  html: string,
): Promise<{ reason: "status" | "challenge" | "thin-text" } | null> {
  if (status < 200 || status > 299) return { reason: "status" };
  const probe = html.slice(0, 20_000).toLowerCase();
  if (CHALLENGE_MARKERS.some((marker) => probe.includes(marker))) {
    return { reason: "challenge" };
  }
  if ((await countExtractedChars(html)) < MIN_EXTRACTED_CHARS) {
    return { reason: "thin-text" };
  }
  return null;
}

function logEscalation(url: string, browserMsUsed: number) {
  console.log(JSON.stringify({
    event: "browser-escalation",
    url,
    browserMsUsed,
  }));
}

export async function readUrl(url: string): Promise<ReadUrlResult> {
  const started = Date.now();

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url", detail: `not a URL: ${url}` };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return {
      ok: false,
      reason: "invalid-url",
      detail: `unsupported scheme: ${target.protocol}`,
    };
  }

  let fetchStatus: number;
  let fetchHtml: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    fetchStatus = res.status;
    fetchHtml = await res.text();
  } catch (err) {
    const escalation = await escalate(url, started);
    return escalation ?? {
      ok: false,
      reason: "fetch-failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const refused = await fetchRefused(fetchStatus, fetchHtml);
  if (refused) {
    const escalation = await escalate(url, started);
    if (escalation !== null) return escalation;
    return {
      ok: false,
      reason: "escalation-failed",
      detail: `fetch ${String(fetchStatus)} was refused (${refused.reason}); browser escalation failed`,
    };
  }

  return {
    ok: true,
    html: fetchHtml,
    transport: "fetch",
    status: fetchStatus,
    ms: Date.now() - started,
    escalated: false,
  };
}

async function escalate(
  url: string,
  started: number,
): Promise<ReadUrlSuccess | null> {
  if (!env.BROWSER || typeof env.BROWSER.quickAction !== "function") {
    return null;
  }

  let res: Response;
  try {
    res = await env.BROWSER.quickAction("content", { url });
  } catch {
    return null;
  }

  const browserMsHeader = res.headers.get("X-Browser-Ms-Used");
  const parsed = browserMsHeader === null ? undefined : Number(browserMsHeader);
  const browserMsUsed =
    parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;

  if (browserMsUsed !== undefined) logEscalation(url, browserMsUsed);

  if (!res.ok) return null;

  let html: string;
  let status: number;
  try {
    const body: {
      success?: boolean;
      result?: unknown;
      meta?: { status?: number };
    } = await res.json();
    const result = body?.result;
    if (typeof result !== "string") return null;
    html = result;
    status = typeof body?.meta?.status === "number" ? body.meta.status : res.status;
  } catch {
    return null;
  }

  return {
    ok: true,
    html,
    transport: "browser",
    status,
    ms: Date.now() - started,
    browserMsUsed,
    escalated: true,
  };
}
