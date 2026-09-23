import { env } from "cloudflare:workers";
import { z } from "zod";

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
  | { ok: false; reason: "escalation-failed"; detail: string };

export type ReadUrlResult = ReadUrlSuccess | ReadUrlFailure;

const ReadUrlSuccessSchema = z.object({
  ok: z.literal(true),
  html: z.string(),
  transport: z.enum(["fetch", "browser"]),
  status: z.number(),
  ms: z.number(),
  browserMsUsed: z.number().optional(),
  escalated: z.boolean(),
});
const ReadUrlFailureSchema = z.object({
  ok: z.literal(false),
  reason: z.enum(["invalid-url", "escalation-failed"]),
  detail: z.string(),
});
export const ReadUrlResultSchema = z.union([ReadUrlSuccessSchema, ReadUrlFailureSchema]);

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

const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "user-agent": "FiveToNineBot/1.0 (+https://0509.io)",
} as const;

export async function countExtractedChars(html: string): Promise<number> {
  let chars = 0;
  let text = "";

  const flush = () => {
    chars += text.length;
    text = "";
  };

  const accumulate = {
    text(chunk: Text) {
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

async function refusalReason(
  status: number,
  html: string,
): Promise<"status" | "challenge" | "thin-text" | null> {
  if (status < 200 || status > 299) return "status";
  const probe = html.slice(0, 20_000).toLowerCase();
  if (CHALLENGE_MARKERS.some((marker) => probe.includes(marker))) {
    return "challenge";
  }
  if ((await countExtractedChars(html)) < MIN_EXTRACTED_CHARS) {
    return "thin-text";
  }
  return null;
}

function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

function logEscalation(url: string, browserMsUsed: number | null) {
  console.log(JSON.stringify({
    event: "browser-escalation",
    url,
    browserMsUsed,
  }));
}

function parseBrowserMs(res: Response): number | null {
  const header = res.headers.get("X-Browser-Ms-Used");
  if (header === null) return null;
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export async function probeFetch(
  url: string,
  init?: { accept?: string; signal?: AbortSignal },
): Promise<Response> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error(`not a URL: ${url}`);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`unsupported scheme: ${target.protocol}`);
  }
  return fetch(url, {
    headers: {
      accept: init?.accept ?? "*/*",
      "user-agent": FETCH_HEADERS["user-agent"],
    },
    signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
}

export async function readJson(url: string): Promise<unknown> {
  const res = await probeFetch(url, { accept: "application/json" });
  if (!res.ok) throw new Error(`json fetch answered ${String(res.status)}`);
  return res.json();
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
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    fetchStatus = res.status;
    fetchHtml = await res.text();
  } catch (err) {
    const escalation = await escalate(url, started);
    return escalation.result ?? {
      ok: false,
      reason: "escalation-failed",
      detail: `fetch threw (${err instanceof Error ? err.message : String(err)}); ${escalation.cause}`,
    };
  }

  const refused = await refusalReason(fetchStatus, fetchHtml);
  if (refused) {
    const escalation = await escalate(url, started);
    if (escalation.result !== null) return escalation.result;
    return {
      ok: false,
      reason: "escalation-failed",
      detail: `fetch ${String(fetchStatus)} was refused (${refused}); ${escalation.cause}`,
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
): Promise<{ result: ReadUrlSuccess | null; cause: string }> {
  if (!env.BROWSER || typeof env.BROWSER.quickAction !== "function") {
    return { result: null, cause: "browser binding is not configured" };
  }

  let res: Response;
  try {
    res = await env.BROWSER.quickAction("content", { url });
  } catch (err) {
    logEscalation(url, null);
    return {
      result: null,
      cause: `browser call threw (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  const browserMsUsed = parseBrowserMs(res);
  logEscalation(url, browserMsUsed);

  if (!res.ok) return { result: null, cause: `browser answered ${String(res.status)}` };

  let html: string;
  let status: number;
  try {
    const body: unknown = await res.json();
    const result = readField(body, "result");
    if (typeof result !== "string") return { result: null, cause: "browser body had no string result" };
    html = result;
    const meta = readField(body, "meta");
    const metaStatus = readField(meta, "status");
    status = typeof metaStatus === "number" ? metaStatus : res.status;
  } catch (err) {
    return {
      result: null,
      cause: `browser body was unreadable (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  return {
    result: {
      ok: true,
      html,
      transport: "browser",
      status,
      ms: Date.now() - started,
      browserMsUsed: browserMsUsed ?? undefined,
      escalated: true,
    },
    cause: "",
  };
}
