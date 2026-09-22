/**
 * The fetch-then-browser transport (identity card P3, 0509#3971).
 *
 * One function, given a URL, returns the page — trying plain `fetch` first and
 * escalating to Browser Rendering when `fetch` is refused. A bot-gating brand
 * site that answers `curl` normally still has to produce a card, and a plain
 * workerd fetch is the thing that gets gated (docs/REBUILD-KEEPLIST.md finding
 * 6: "Anything that must read an arbitrary brand homepage needs the Browser
 * Rendering path by design, not as a subsequent patch"). Fetch stays first because
 * it is free and instant for the majority of sites; the browser is the
 * expensive fallback, not the default.
 *
 * Three shapes this module must not take:
 *
 * 1. **A retry loop.** One escalation, then a typed failure. A loop multiplies
 *    the only metered thing in here — an escalation costs ~8 browser-seconds —
 *    and turns a hard 8 s deadline into an unbounded one.
 * 2. **A browser session.** `quickAction("content")` is a Quick Action: no
 *    `nodejs_compat`, no lifecycle, no `close()`. The forbidden `browser.close()`
 *    per request re-pays the cold-launch seconds every call and burns the
 *    3-instances-per-second rate limit, which is tighter than concurrency for a
 *    burst (docs/REBUILD-STACK.md §4.3). If a session is ever opened here, it
 *    is `disconnect()`ed — and `quickAction` opens none, so there is nothing to
 *    disconnect.
 * 3. **A queue.** This path is interactive and uses the two reserved browser
 *    slots (identity card P3 FORBIDDEN).
 *
 * The escalation's cost is recorded, not hidden: `X-Browser-Ms-Used` is read
 * off the Browser Run response and returned as `browserMsUsed` so a caller can
 * log the one number the cost model is priced from.
 */

/** Deadline for the plain fetch attempt. Per-URL, via AbortSignal.timeout. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Extracted-text floor. Under this, the page is treated as gated: a challenge
 * body or a JS-only redirect clock is usually well under 200 characters once
 * the tags are gone, and a page this thin is not a brand homepage carrying a
 * name, a description and a logo.
 */
const MIN_EXTRACTED_CHARS = 200;

/** Which transport produced the body we returned. */
type Transport = "fetch" | "browser";

/** A read that produced a page. */
interface ReadUrlSuccess {
  ok: true;
  html: string;
  transport: Transport;
  /** Status of the response that carried the body actually returned. */
  status: number;
  /** Wall-clock of the readUrl call, in milliseconds. */
  ms: number;
  /**
   * Browser time consumed, read off the escalation's `X-Browser-Ms-Used`
   * header. Present on every browser read; absent on a fetch read, which metered
   * nothing.
   */
  browserMsUsed?: number;
  /** Whether the plain fetch was tried and failed first. */
  escalated: boolean;
}

/** Why a read failed. Discriminated, so a caller never string-matches. */
type ReadUrlFailure =
  | { ok: false; reason: "invalid-url"; detail: string }
  | { ok: false; reason: "fetch-failed"; detail: string }
  | { ok: false; reason: "escalation-failed"; detail: string };

export type ReadUrlResult = ReadUrlSuccess | ReadUrlFailure;

/**
 * The subset of the Browser Run binding this module uses. Declared structurally
 * rather than by importing the generated binding type, because the generated
 * `worker-configuration.d.ts` is a build artifact that is not in git and the
 * test harness supplies its own implementation.
 */
export interface BrowserBinding {
  quickAction(
    action: "content",
    options: { url: string },
  ): Promise<Response>;
}

/**
 * The env this module needs. `BROWSER` only — `readUrl` does not reach for the
 * whole env, so a caller cannot accidentally hand it something that reads a
 * secret.
 */
export interface TransportEnv {
  BROWSER: BrowserBinding;
}

/**
 * Challenge bodies we recognise. Bot gates answer 200 far more often than they
 * answer 403, so the status code alone cannot tell "gated" from "served", and a
 * challenge page is a 200 whose extracted text is thin. These markers are
 * matched case-insensitively on a lowercased body.
 *
 * This list is deliberately a detector, not a classifier: it is here to decide
 * *fetch-or-escalate*, and it errs toward escalating, because an unnecessary
 * escalation costs browser-seconds while a missed one costs a card.
 */
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

/**
 * Extracted visible text, counted. A length predicate needs text length, and
 * "extracted text" is the P2 extractor's normalised visible text — which is not
 * built yet (P2 is a separate packet), so this is the minimal honest version of
 * the same idea rather than a hand-rolled second extractor.
 *
 * HTMLRewriter is the platform primitive P2 chose and the FORBIDDEN list in
 * REBUILD-STACK.md §5.1/§5.4 rules out every scraper dependency; running it
 * here means one text-extraction primitive in the codebase when P2 lands, not two.
 *
 * Only element text nodes are counted, and `script`/`style` are skipped: markup
 * that never renders is not "extracted text", and counting it would let a
 * script-tag-heavy shell pass a thin-page test.
 */
export async function countExtractedChars(html: string): Promise<number> {
  let chars = 0;
  let text = "";
  // A text node arrives across several `text()` calls, so the run is only
  // counted once `lastInTextNode` says the node is complete
  // (docs/REBUILD-STACK.md §5.1: "text chunks are not text nodes").
  const addText = () => {
    chars += text.length;
    text = "";
  };
  const accumulate = {
    text(chunk: { text: string; lastInTextNode: boolean }) {
      text += chunk.text;
      if (chunk.lastInTextNode) addText();
    },
  };
  // Text inside a non-rendering element is not extracted text. The selector is
  // more specific than `*`, and HTMLRewriter routes a text chunk to the closest
  // matching element, so these chunks never reach the accumulator.
  const discard = {
    text() {
      // Safe because a visible run is already flushed: `*`'s handler counts a
      // run at its `lastInTextNode` chunk, which is the chunk HTMLRewriter
      // delivers at the element boundary before this element's text follows.
      text = "";
    },
  };
  const transformed = new HTMLRewriter()
    .on("script, style, noscript, template", discard)
    .on("*", accumulate)
    .transform(new Response(html));
  // HTMLRewriter is lazy: it rewrites as the body is read, so the transform
  // output must be consumed before the count means anything.
  await transformed.text();
  // A trailing text run with no closing element is flushed by the read above
  // only if it carried a lastInTextNode chunk; anything still buffered is
  // counted here so nothing is silently dropped.
  addText();
  return chars;
}

/**
 * The escalation predicate: does this response mean "fetch was refused"?
 *
 * Three triggers, exactly as P3 states them, evaluated in this order:
 *   1. non-2xx,
 *   2. a challenge body,
 *   3. under 200 characters of extracted text.
 *
 * Returns the reason for logging, or null when the fetch stood.
 */
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

/**
 * Read one URL, fetching first and escalating at most once.
 *
 * Returns a typed failure for every way this can go wrong — it never throws, so
 * the card's per-probe wrapper (identity card P3's "wrapped in one helper ...
 * never throws" graft) does not need a try/catch of its own.
 */
export async function readUrl(
  url: string,
  env: TransportEnv,
): Promise<ReadUrlResult> {
  const started = Date.now();

  // A relative or malformed URL never reaches fetch: it would surface as a
  // confusing "Failed to parse URL" TypeError after the timer had started.
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
    // A transport-level failure is an escalation trigger too: a refused
    // connection and a timeout are exactly the "plain fetch is not a
    // general-purpose page reader" case finding 6 describes.
    const escalation = await escalate(target, env, started);
    return escalation ?? {
      ok: false,
      reason: "fetch-failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const refused = await fetchRefused(fetchStatus, fetchHtml);
  if (refused) {
    const escalation = await escalate(target, env, started);
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

/**
 * The one escalation. Returns null when the browser could not produce a page,
 * which the caller turns into a typed failure — there is no second attempt.
 */
async function escalate(
  target: URL,
  env: TransportEnv,
  started: number,
): Promise<ReadUrlSuccess | null> {
  if (!env.BROWSER || typeof env.BROWSER.quickAction !== "function") {
    return null;
  }

  let res: Response;
  try {
    // `url` (not the parsed URL object) so what the browser navigates to is
    // exactly what the caller asked for.
    res = await env.BROWSER.quickAction("content", { url: target.toString() });
  } catch {
    return null;
  }

  const browserMsHeader = res.headers.get("X-Browser-Ms-Used");
  const browserMsUsed = browserMsHeader === null ? undefined : Number(browserMsHeader);

  if (!res.ok) return null;

  let html: string;
  let status: number;
  try {
    // /content answers JSON: { success, result, meta }. The rendered page's own
    // status lives in meta, which is the status worth reporting — the browser's
    // HTTP status is ours, not the page's.
    const body: {
      success?: boolean;
      result?: unknown;
      meta?: { status?: number };
    } = await res.json();
    const result = body?.result;
    if (typeof body?.result !== "string") return null;
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
    browserMsUsed: Number.isFinite(browserMsUsed) ? browserMsUsed : undefined,
    escalated: true,
  };
}
