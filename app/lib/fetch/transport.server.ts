import { browserContent } from "../site/browser-budget.server";
import { BlockedRedirectError, cappedBody, fetchOutbound, targetRefusal } from "./outbound.server";
import { CRAWLER_USER_AGENT } from "./robots.server";

const MIN_EXTRACTED_CHARS = 200;

const MAX_BODY_BYTES = 5_000_000;

export type Transport = "fetch" | "browser";

export type EscalationReason = "status" | "challenge" | "thin-text" | "timeout" | "learned";

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
  fromArchive?: true;
}

type ReadUrlFailure =
  | { ok: false; reason: "invalid-url"; detail: string }
  | { ok: false; reason: "unreachable"; detail: string }
  | { ok: false; reason: "too-large"; detail: string }
  | { ok: false; reason: "deferred"; detail: string }
  | { ok: false; reason: "escalation-failed"; detail: string };

export type ReadUrlResult = ReadUrlSuccess | ReadUrlFailure;

export type ReadUrlFailureReason = ReadUrlFailure["reason"];

export class ReadUrlError extends Error {
  readonly reason: ReadUrlFailureReason;

  constructor(reason: ReadUrlFailureReason) {
    super(reason);
    this.name = "ReadUrlError";
    this.reason = reason;
  }
}

export function probeFailureReason(error: unknown): string {
  return error instanceof ReadUrlError ? error.reason : "probe-failed";
}

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
  "user-agent": CRAWLER_USER_AGENT,
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

export async function refusalReason(
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

function browserRefused(status: number, html: string): boolean {
  if (status < 200 || status > 299) return true;
  const probe = html.slice(0, 20_000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => probe.includes(marker));
}

function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

function logEscalation(browserMsUsed: number | null, reason: EscalationReason) {
  console.log(
    JSON.stringify({
      event: "browser-escalation",
      browserMsUsed,
      reason,
    }),
  );
}

async function deferUnlessAllowed(options: ReadUrlOptions, reason: EscalationReason): Promise<ReadUrlFailure | null> {
  if (!options.mayEscalate) {
    return { ok: false, reason: "deferred", detail: `no browser budget callback wired (${reason})` };
  }
  if (await options.mayEscalate(reason)) return null;
  return { ok: false, reason: "deferred", detail: `browser budget refused escalation (${reason})` };
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
  const bytes = await cappedBody(res, MAX_BODY_BYTES);
  if (bytes === null) throw new BodyTooLargeError();
  return new TextDecoder().decode(bytes);
}

function invalidUrlFailure(url: string): ReadUrlFailure | null {
  let target: URL;
  try {
    target = new URL(url);
  } catch (error) {
    console.error(
      JSON.stringify({ event: "fetch.url_parse_failed", error: error instanceof Error ? error.name : typeof error }),
    );
    return { ok: false, reason: "invalid-url", detail: `not a URL: ${url}` };
  }
  const refusal = targetRefusal(target);
  if (refusal !== null) return { ok: false, reason: "invalid-url", detail: refusal };
  return null;
}

type FetchOutcome =
  | { kind: "page"; status: number; html: string }
  | { kind: "failure"; failure: ReadUrlFailure }
  | { kind: "timeout"; detail: string };

function classifyFetchError(err: unknown): FetchOutcome {
  if (err instanceof BodyTooLargeError) {
    return { kind: "failure", failure: { ok: false, reason: "too-large", detail: err.message } };
  }
  if (err instanceof BlockedRedirectError) {
    return { kind: "failure", failure: { ok: false, reason: "invalid-url", detail: err.message } };
  }
  const detail = `fetch threw (${err instanceof Error ? err.message : String(err)})`;
  if (err instanceof Error && err.name === "TimeoutError") return { kind: "timeout", detail };
  return { kind: "failure", failure: { ok: false, reason: "unreachable", detail } };
}

async function tryFetch(url: string): Promise<FetchOutcome> {
  try {
    const res = await fetchOutbound(url, { headers: FETCH_HEADERS });
    const html = await cappedText(res);
    return { kind: "page", status: res.status, html };
  } catch (err) {
    return classifyFetchError(err);
  }
}

interface ReadContext {
  url: string;
  started: number;
  options: ReadUrlOptions;
}

async function escalateOrFail(
  ctx: ReadContext,
  reason: EscalationReason,
  detailFor: (cause: string) => string,
): Promise<ReadUrlResult> {
  const deferred = await deferUnlessAllowed(ctx.options, reason);
  if (deferred) return deferred;
  const escalation = await escalate(ctx.url, ctx.started, reason);
  return (
    escalation.result ?? {
      ok: false,
      reason: "escalation-failed",
      detail: detailFor(escalation.cause),
    }
  );
}

export async function readUrl(url: string, options: ReadUrlOptions = {}): Promise<ReadUrlResult> {
  const ctx: ReadContext = { url, started: Date.now(), options };

  const invalid = invalidUrlFailure(url);
  if (invalid !== null) return invalid;

  if (options.startWith === "browser") {
    return escalateOrFail(ctx, "learned", (cause) => `learned browser transport; ${cause}`);
  }

  const outcome = await tryFetch(url);
  if (outcome.kind === "failure") return outcome.failure;
  if (outcome.kind === "timeout") {
    return escalateOrFail(ctx, "timeout", (cause) => `${outcome.detail}; ${cause}`);
  }

  const refused = await refusalReason(outcome.status, outcome.html);
  if (refused) {
    return escalateOrFail(
      ctx,
      refused,
      (cause) => `fetch ${String(outcome.status)} was refused (${refused}); ${cause}`,
    );
  }

  return {
    ok: true,
    html: outcome.html,
    transport: "fetch",
    status: outcome.status,
    ms: Date.now() - ctx.started,
    escalated: false,
  };
}

async function escalate(
  url: string,
  started: number,
  reason: EscalationReason,
): Promise<{ result: ReadUrlSuccess | null; cause: string }> {
  const content = await browserContent(url);
  if (!content.ok) {
    if (content.kind === "threw") logEscalation(null, reason);
    return { result: null, cause: content.cause };
  }
  const res = content.res;

  const browserMsUsed = parseBrowserMs(res);
  logEscalation(browserMsUsed, reason);

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

  if (browserRefused(status, html)) {
    return { result: null, cause: `browser page was refused (${String(status)})` };
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
