import { browserContent } from "../site/browser-budget.server";
import {
  browserContentEmpty,
  browserRefused,
  CHALLENGE_MARKERS,
  type BrowserEngine,
} from "./browser-refusal";
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
  browserEngine?: BrowserEngine;
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

function logEscalation(browserMsUsed: number | null, reason: EscalationReason, engine: BrowserEngine) {
  console.log(
    JSON.stringify({
      event: "browser-escalation",
      browserMsUsed,
      reason,
      engine,
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

async function parseBrowserPage(
  res: Response,
): Promise<{ html: string; status: number } | { cause: string }> {
  let body: unknown;
  try {
    body = JSON.parse(await cappedText(res));
  } catch (err) {
    return { cause: `browser body was unreadable (${err instanceof Error ? err.message : String(err)})` };
  }
  const html = readField(body, "result");
  if (typeof html !== "string") return { cause: "browser body had no string result" };
  const meta = readField(body, "meta");
  const metaStatus = readField(meta, "status");
  const status = typeof metaStatus === "number" ? metaStatus : res.status;
  if (browserRefused(status, html)) {
    return { cause: `browser page was refused (${String(status)})` };
  }
  return { html, status };
}

interface BrowserAttemptArgs {
  url: string;
  started: number;
  reason: EscalationReason;
  engine: BrowserEngine;
}

async function browserAttempt(
  args: BrowserAttemptArgs,
): Promise<{ result: ReadUrlSuccess | null; cause: string; msUsed: number | null }> {
  const { url, started, reason, engine } = args;
  const content = await browserContent(url, engine);
  if (!content.ok) {
    if (content.kind === "threw") logEscalation(null, reason, engine);
    return { result: null, cause: content.cause, msUsed: null };
  }
  const res = content.res;
  const msUsed = parseBrowserMs(res);
  logEscalation(msUsed, reason, engine);

  if (!res.ok) return { result: null, cause: `browser answered ${String(res.status)}`, msUsed };

  const page = await parseBrowserPage(res);
  if ("cause" in page) return { result: null, cause: page.cause, msUsed };
  if (engine === "kitesurf" && browserContentEmpty(page.html)) {
    return { result: null, cause: "kitesurf returned empty content", msUsed };
  }

  return {
    result: {
      ok: true,
      html: page.html,
      transport: "browser",
      status: page.status,
      ms: Date.now() - started,
      browserMsUsed: msUsed ?? undefined,
      browserEngine: engine,
      escalated: true,
      escalationReason: reason,
    },
    cause: "",
    msUsed,
  };
}

function sumBrowserMs(first: number | null, second: number | null): number | undefined {
  if (first === null && second === null) return undefined;
  return (first ?? 0) + (second ?? 0);
}

async function escalate(
  url: string,
  started: number,
  reason: EscalationReason,
): Promise<{ result: ReadUrlSuccess | null; cause: string }> {
  const first = await browserAttempt({ url, started, reason, engine: "kitesurf" });
  if (first.result !== null) return { result: first.result, cause: "" };
  const second = await browserAttempt({ url, started, reason, engine: "chromium" });
  if (second.result !== null) {
    second.result.browserMsUsed = sumBrowserMs(first.msUsed, second.msUsed);
    return { result: second.result, cause: "" };
  }
  return { result: null, cause: `kitesurf: ${first.cause}; chromium: ${second.cause}` };
}
