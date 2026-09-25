import { env } from "cloudflare:workers";
import { parse } from "tldts";

const FETCH_TIMEOUT_MS = 8_000;

const MIN_EXTRACTED_CHARS = 200;

const MAX_BODY_BYTES = 5_000_000;

export type Transport = "fetch" | "browser";

export type EscalationReason =
  | "status"
  | "challenge"
  | "thin-text"
  | "timeout"
  | "learned";

export interface ReadUrlOptions {
  startWith?: Transport;
  mayEscalate?: (reason: EscalationReason) => Promise<boolean>;
}

interface ReadUrlSuccess {
  ok: true;
  html: string;
  transport: Transport;
  status: number;
  ms: number;
  browserMsUsed?: number;
  escalated: boolean;
  escalationReason?: EscalationReason;
}

type ReadUrlFailure =
  | { ok: false; reason: "invalid-url"; detail: string }
  | { ok: false; reason: "unreachable"; detail: string }
  | { ok: false; reason: "too-large"; detail: string }
  | { ok: false; reason: "deferred"; detail: string }
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
): Promise<Exclude<EscalationReason, "timeout" | "learned"> | null> {
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

function logEscalation(
  url: string,
  browserMsUsed: number | null,
  reason: EscalationReason,
) {
  console.log(JSON.stringify({
    event: "browser-escalation",
    url,
    browserMsUsed,
    reason,
  }));
}

function deferredByBudget(reason: EscalationReason): ReadUrlFailure {
  return {
    ok: false,
    reason: "deferred",
    detail: `browser budget refused escalation (${reason})`,
  };
}

function parseBrowserMs(res: Response): number | null {
  const header = res.headers.get("X-Browser-Ms-Used");
  if (header === null) return null;
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

class BodyTooLargeError extends Error {
  constructor() {
    super(`body is over ${String(MAX_BODY_BYTES)} bytes`);
    this.name = "BodyTooLargeError";
  }
}

async function cappedText(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await res.body?.cancel();
    throw new BodyTooLargeError();
  }
  if (res.body === null) return "";
  let seen = 0;
  const capped = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > MAX_BODY_BYTES) {
          controller.error(new BodyTooLargeError());
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(capped).text();
}

export async function readUrl(
  url: string,
  options: ReadUrlOptions = {},
): Promise<ReadUrlResult> {
  const started = Date.now();

  let target: URL;
  try {
    target = new URL(url);
  } catch (error) {
    console.error(JSON.stringify({ event: "fetch.url_parse_failed", error: String(error) }));
    return { ok: false, reason: "invalid-url", detail: `not a URL: ${url}` };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return {
      ok: false,
      reason: "invalid-url",
      detail: `unsupported scheme: ${target.protocol}`,
    };
  }
  const host = parse(target.hostname);
  if (host.isIp === true || host.isIcann !== true) {
    return {
      ok: false,
      reason: "invalid-url",
      detail: `not a public internet host: ${target.hostname}`,
    };
  }

  if (options.startWith === "browser") {
    if (options.mayEscalate && !(await options.mayEscalate("learned"))) {
      return deferredByBudget("learned");
    }
    const learned = await escalate(url, started, "learned");
    return learned.result ?? {
      ok: false,
      reason: "escalation-failed",
      detail: `learned browser transport; ${learned.cause}`,
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
    fetchHtml = await cappedText(res);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return { ok: false, reason: "too-large", detail: err.message };
    }
    const detail = `fetch threw (${err instanceof Error ? err.message : String(err)})`;
    if (!(err instanceof Error && err.name === "TimeoutError")) {
      return { ok: false, reason: "unreachable", detail };
    }
    if (options.mayEscalate && !(await options.mayEscalate("timeout"))) {
      return deferredByBudget("timeout");
    }
    const escalation = await escalate(url, started, "timeout");
    return escalation.result ?? {
      ok: false,
      reason: "escalation-failed",
      detail: `${detail}; ${escalation.cause}`,
    };
  }

  const refused = await refusalReason(fetchStatus, fetchHtml);
  if (refused) {
    if (options.mayEscalate && !(await options.mayEscalate(refused))) {
      return deferredByBudget(refused);
    }
    const escalation = await escalate(url, started, refused);
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
  reason: EscalationReason,
): Promise<{ result: ReadUrlSuccess | null; cause: string }> {
  if (!env.BROWSER || typeof env.BROWSER.quickAction !== "function") {
    return { result: null, cause: "browser binding is not configured" };
  }

  let res: Response;
  try {
    res = await env.BROWSER.quickAction("content", { url });
  } catch (err) {
    logEscalation(url, null, reason);
    return {
      result: null,
      cause: `browser call threw (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  const browserMsUsed = parseBrowserMs(res);
  logEscalation(url, browserMsUsed, reason);

  if (!res.ok) return { result: null, cause: `browser answered ${String(res.status)}` };

  let html: string;
  let status: number;
  try {
    const body: unknown = JSON.parse(await cappedText(res));
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
      escalationReason: reason,
    },
    cause: "",
  };
}
