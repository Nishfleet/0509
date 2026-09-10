/**
 * Landing-page run audit (issue #1500).
 *
 * The CTA detector was silent for 77 days because the landing-page
 * extraction pipeline could bail out at any of eight stages (html_fetch,
 * html_parse, anchor_resolve, cta_extract, headline_extract,
 * price_extract, form_extract, url_extract) without recording which
 * stage dropped the signal. Issue #949 wired a single end-of-check
 * summary log line; that summary told operators a bail happened, not
 * which stage bailed and why.
 *
 * This module emits one structured JSON log line per stage transition.
 * Every line carries `tag: "lp_run_audit"` so a Workers Logpush filter
 * can extract the audit stream without disturbing the rest of the
 * pipeline log, and so an operator query (or the verify step in the
 * issue) can match on the tag without a brittle substring search:
 *
 *   rg -n 'tag: "lp_run_audit"' app/ worker/
 *   npx wrangler tail --format=json \
 *     | jq 'select(.logs[].message[0] | test("lp_run_audit"))'
 *
 * The emit path is best-effort and never throws — a logging failure
 * must never break the scan. The audit module never writes to D1 and
 * never mutates any extraction state; it is read-only telemetry.
 *
 * Stages and bail-out reason codes are stable strings so a backfill /
 * log query can GROUP BY them and surface the dominant bail-out:
 *   html_fetch      — HTTP fetch itself (timeouts, 4xx, 5xx, redirects)
 *                     bail reasons: landing_rate_limited, landing_blocked,
 *                     landing_http_error, landing_fetch_failed,
 *                     landing_redirect_blocked, landing_content_empty_or_oversized
 *   html_parse      — removeNonVisibleElements / ad-slot strip
 *                     bail reasons: empty_after_strip
 *   anchor_resolve  — extractActionLinks + cleanText
 *                     bail reasons: no_anchors, anchor_chrome_only
 *   cta_extract     — pickBestCta
 *                     bail reasons: no_cta_candidates, only_chrome_buttons,
 *                     only_chrome_anchors, empty_capture
 *   headline_extract — OG/TITLE/H1 regex cascade
 *                     bail reasons: no_og_title, no_title, no_h1,
 *                     headline_only_chrome
 *   price_extract   — pickPrice (PRICE_PATTERNS)
 *                     bail reasons: no_price_pattern
 *   form_extract    — detectFormPresence
 *                     bail reasons: no_lead_input, no_submit_action
 *   url_extract     — resolvePublicHttpUrl / canonical-URL resolution
 *                     bail reasons: landing_url_invalid, redirect_limit
 */

export type LpRunAuditStage =
  | "html_fetch"
  | "html_parse"
  | "anchor_resolve"
  | "cta_extract"
  | "headline_extract"
  | "price_extract"
  | "form_extract"
  | "url_extract";

export type LpRunAuditOutcome = "ok" | `bailed:${string}`;

export interface LpRunAuditContext {
  watchlistId: string;
  runId: string;
  domain: string;
}

export interface LpRunAuditLineInput {
  context: LpRunAuditContext;
  stage: LpRunAuditStage;
  outcome: LpRunAuditOutcome;
  bytesIn: number;
  bytesOut: number;
  ms: number;
}

/**
 * Emit a single `lp_run_audit` JSON line. Best-effort — never throws,
 * never blocks the scan path.
 */
export function emitLpRunAudit(input: LpRunAuditLineInput): void {
  try {
    const payload = {
      tag: "lp_run_audit",
      watchlist_id: input.context.watchlistId,
      run_id: input.context.runId,
      domain: input.context.domain,
      stage: input.stage,
      outcome: input.outcome,
      bytes_in: input.bytesIn,
      bytes_out: input.bytesOut,
      ms: input.ms,
    };
    console.log(JSON.stringify(payload));
  } catch {
    // Instrumentation is best-effort. A serialisation failure must never
    // propagate into the scan path.
  }
}

/**
 * Run a stage, time it, measure bytes in/out, and emit one audit line.
 * The optional `bailReasonFor` classifies the outcome — when it returns
 * a string the audit line is emitted as `bailed:<reason>`, otherwise
 * `ok`. Returning the original result lets callers keep their existing
 * return-shape contracts; the audit line is purely a side effect.
 */
export interface RunLpRunAuditStageOptions<T> {
  context: LpRunAuditContext;
  stage: LpRunAuditStage;
  bytesIn: number;
  bailReasonFor: (result: T) => string | null;
  /**
   * Optional byte-length measurement for the stage's output. Defaults
   * to UTF-8 byte length of a JSON.stringify of the result, which is
   * good enough for the existing extractor shape — a stage that needs
   * a tighter measurement (e.g. raw HTML) can pass an explicit number.
   */
  bytesOutFor?: (result: T) => number;
  fn: () => T;
}

export function runLpRunAuditStage<T>(
  options: RunLpRunAuditStageOptions<T>,
): T {
  const startedAt = Date.now();
  const result = options.fn();
  const ms = Math.max(0, Date.now() - startedAt);
  const bailReason = options.bailReasonFor(result);
  const outcome: LpRunAuditOutcome =
    bailReason === null ? "ok" : (`bailed:${bailReason}` as const);
  const bytesOut =
    options.bytesOutFor !== undefined
      ? options.bytesOutFor(result)
      : utf8ByteLengthSafe(result);
  emitLpRunAudit({
    context: options.context,
    stage: options.stage,
    outcome,
    bytesIn: options.bytesIn,
    bytesOut,
    ms,
  });
  return result;
}

/**
 * Same shape as `runLpRunAuditStage` but awaits the stage fn — used for
 * the `html_fetch` stage which is async. Same best-effort emission
 * contract: a logging failure never rejects the returned promise.
 */
export interface RunLpRunAuditStageAsyncOptions<T> {
  context: LpRunAuditContext;
  stage: LpRunAuditStage;
  bytesIn: number;
  /**
   * Classifies the resolved value of `fn`. Returns a string for
   * `bailed:<reason>` and `null` for `ok`.
   */
  bailReasonFor: (result: T) => string | null;
  /**
   * Optional byte-length measurement for the stage's output. Defaults
   * to UTF-8 byte length of a JSON.stringify of the resolved value.
   */
  bytesOutFor?: (result: T) => number;
  /**
   * Async stage fn. The returned promise resolves to the value passed
   * to `bailReasonFor` / `bytesOutFor`.
   */
  fn: () => Promise<T>;
}

export async function runLpRunAuditStageAsync<T>(
  options: RunLpRunAuditStageAsyncOptions<T>,
): Promise<T> {
  const startedAt = Date.now();
  const result = await options.fn();
  const ms = Math.max(0, Date.now() - startedAt);
  const bailReason = options.bailReasonFor(result);
  const outcome: LpRunAuditOutcome =
    bailReason === null ? "ok" : (`bailed:${bailReason}` as const);
  const bytesOut =
    options.bytesOutFor !== undefined
      ? options.bytesOutFor(result)
      : utf8ByteLengthSafe(result);
  emitLpRunAudit({
    context: options.context,
    stage: options.stage,
    outcome,
    bytesIn: options.bytesIn,
    bytesOut,
    ms,
  });
  return result;
}

/**
 * UTF-8 byte length without depending on Buffer (Workers / Node both
 * expose TextEncoder; the existing `utf8ByteLength` helper is in
 * `bounded-response.server` and not safe to import from a thin
 * pure-logic module that this test suite exercises in isolation).
 */
function utf8ByteLengthSafe(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

/**
 * Build a context object. Convenience for callers that have the raw
 * fields — keeps the issue-required field names (`watchlist_id`,
 * `run_id`, `domain`) stable across call sites so a future query
 * never has to chase a typo in the wiring layer.
 */
export function createLpRunAuditContext(input: {
  watchlistId: string;
  runId: string;
  domain: string;
}): LpRunAuditContext {
  return {
    watchlistId: input.watchlistId,
    runId: input.runId,
    domain: input.domain,
  };
}
