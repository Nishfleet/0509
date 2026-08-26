import puppeteer from "@cloudflare/puppeteer";

import {
  base64DecodedLengthExceeds,
  readResponseJsonWithinLimit,
  readResponseTextWithinLimit,
  utf8ByteLength,
} from "~/lib/bounded-response.server";
import { assessCaptureValidity } from "~/lib/capture-validity.server";
import { decodeHtmlEntities as decodeHtml } from "~/lib/decode-html.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import {
  extractLandingPageSignals,
  LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
} from "~/lib/landing-page-signals.server";
import { normalizeHeadline } from "~/lib/normalize";
import { normalizePublicHttpUrl, resolvePublicHttpUrl } from "~/lib/public-url.server";
import {
  recordBrowserJobTelemetry,
  resolveSourceForRouteContext,
  resolveWorkerVersionId,
  type BrowserJobPlanTier,
  type BrowserJobRouteContext,
  type BrowserJobSource,
} from "~/lib/browser-job-telemetry.server";
import type { LandingPageSnapshotData, ProofDeviceProfile, ProofRenderMode } from "~/lib/types";
import { promiseWithTimeout } from "~/lib/fetch-timeout.server";

const TITLE_REGEX = /<title[^>]*>([^<]+)<\/title>/i;
const OG_TITLE_REGEX =
  /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const H1_REGEX = /<h1[^>]*>(.*?)<\/h1>/i;

const MOBILE_RENDER_MODE: ProofRenderMode = "mobile";
const MOBILE_DEVICE_PROFILE: ProofDeviceProfile = "mobile_default";
const BROWSER_RUN_LAUNCH_TIMEOUT_MS = 10_000;
const MOBILE_VIEWPORT = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const BROWSERLESS_PROOF_RENDER_WAIT_MS = 5_000;
const MAX_RENDERED_HTML_BYTES = 1_000_000;
const MAX_RENDERED_SCREENSHOT_BYTES = 3_000_000;
const MAX_BROWSERLESS_RESPONSE_BYTES = 6_000_000;
const BROWSERLESS_PROOF_TIMEOUT_MS = 30_000;
/**
 * JS-heavy pages (SPAs, long-polling, chat widgets) often never reach
 * network idle. The first goto attempt uses networkidle2; on failure the
 * capture retries with `load` so a readable rendered proof is still saved.
 * Bounded: two strategies, never more.
 */
const BROWSER_RUN_GOTO_STRATEGIES = [
  { waitUntil: "networkidle2" as const, timeoutMs: 30_000 },
  { waitUntil: "load" as const, timeoutMs: 20_000 },
];
/** Retry budget for transient Browserless failures (2 attempts total). */
const MAX_BROWSERLESS_PROOF_RETRIES = 1;
const BROWSERLESS_RETRY_DELAY_MS = 300;
/** Retry budget for Browser Run Quick Action calls (2 attempts total). */
const QUICK_ACTION_MAX_ATTEMPTS = 2;
/** Retry budget for a viewport screenshot after HTML is already in hand. */
const SCREENSHOT_CAPTURE_ATTEMPTS = 2;
const QUICK_ACTION_RETRY_MAX_DELAY_MS = 1_000;
const QUICK_ACTION_RETRY_DELAY_MS = 250;
const BROWSER_RUN_QUICK_ACTION_TIMEOUT_MS = 30_000;
const BROWSER_RUN_QUICK_ACTION_JSON_MAX_BYTES = 6_000_000;
const DEFAULT_BROWSERLESS_PROOF_ALLOWED_ORIGINS = new Set([
  "https://0509.io",
  "https://www.0509.io",
]);
const BROWSERLESS_PROOF_SNAPSHOT_MUTATION = `
mutation LandingPageProofFallback($url: String!, $userAgent: String!) {
  userAgent(userAgent: $userAgent) {
    time
  }
  viewport(width: 390, height: 844, deviceScaleFactor: 2, mobile: true) {
    width
  }
  goto(url: $url) {
    status
  }
  waitForTimeout(time: ${BROWSERLESS_PROOF_RENDER_WAIT_MS}) {
    time
  }
  html {
    html
  }
	  screenshot(type: jpeg, fullPage: false, quality: 85) {
	    base64
	  }
	  documentRequests: request(type: [document], wait: false) {
	    url
	  }
	  url {
	    url
	  }
}
`.trim();

interface BrowserRunQuickActionEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{
    message?: string;
  }>;
}

interface BrowserRunQuickActionWaitForSelector {
  selector: string;
  hidden?: true;
  timeout?: number;
  visible?: true;
}

export interface BrowserRunQuickActionScrapeElement {
  attributes?: Array<{
    name?: string;
    value?: string;
  }>;
  height?: number;
  html?: string;
  left?: number;
  text?: string;
  top?: number;
  width?: number;
}

export interface BrowserRunQuickActionContentOptions {
  url: string;
  actionTimeout?: number;
  addScriptTag?: Array<{
    content?: string;
    id?: string;
    type?: string;
    url?: string;
  }>;
  bestAttempt?: boolean;
  gotoOptions?: {
    timeout?: number;
    waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
  };
  userAgent?: string;
  viewport?: {
    deviceScaleFactor?: number;
    hasTouch?: boolean;
    height: number;
    isMobile?: boolean;
    width: number;
  };
  waitForSelector?: BrowserRunQuickActionWaitForSelector;
  waitForTimeout?: number;
}

export interface BrowserRunQuickActionScrapeOptions extends Omit<BrowserRunQuickActionContentOptions, "addScriptTag"> {
  elements: Array<{
    selector: string;
  }>;
}

interface BrowserRunQuickActionScrapeResult {
  selector?: string;
  results?: BrowserRunQuickActionScrapeElement[] | BrowserRunQuickActionScrapeElement;
}

type BrowserRunBrowser = Awaited<ReturnType<typeof puppeteer.launch>>;
type BrowserRunPage = Awaited<ReturnType<BrowserRunBrowser["newPage"]>>;

interface BrowserRequestLike {
  abort(): Promise<void> | void;
  continue(): Promise<void> | void;
  isInterceptResolutionHandled?: () => boolean;
  url(): string;
}

interface RenderedCaptureOptions {
  persistArtifacts?: boolean;
  /**
   * When true, a rendered snapshot is only considered usable if both the
   * screenshot bytes and the persisted screenshot artifact are non-null.
   * This is the default for proof_capture callers and prevents the HTML-only
   * "succeeded" captures that issue #1103 measured.
   */
  requireScreenshot?: boolean;
  /** Bounded attribution context recorded in `browser_job_telemetry` (optional).
   * Never carries URLs, tokens, or content. */
  jobId?: string;
  routeContext?: BrowserJobRouteContext;
  planTier?: BrowserJobPlanTier | null;
  source?: BrowserJobSource;
  /**
   * Attempt number within the job's ordered leg chain. Landing capture passes
   * 2 when this rendered leg follows the plain-http leg (which owns 1).
   */
  attempt?: number;
  /**
   * Stable idempotency fingerprint (SHA-256 of the canonical URL) provided by
   * the orchestrating caller; the row's idempotency_key becomes
   * `<fingerprint>:<provider>`. Defaults to a job-scoped key.
   */
  idempotencyKey?: string;
  /**
   * Out-param attempt counter shared across the rendered chain
   * (browser_run → browserless). Each leg that records a row writes its
   * attempt number here, so the next leg in the chain continues the job's
   * ordered numbering instead of claiming the same attempt again.
   */
  telemetryAttempts?: { used: number };
  /**
   * Request ExecutionContext when the caller actually has one. When present,
   * row writes are registered with `waitUntil` so they still land after the
   * response (background completion preserved) while the bounded race still
   * caps how long this leg may wait on a slow write.
   */
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
}

type RenderedLegOutcome = "succeeded" | "failed" | "rate_limited" | "timeout";

/**
 * Truthful provider-error classification for a rendered leg: a bounded
 * provider timeout (internal Abort, PromiseTimeout, or an explicit timeout
 * signal) is `timeout`, a provider HTTP 429/rate-limit is `rate_limited`,
 * and every other error is `failed`. Message-based so it also matches
 * provider errors from any module-registry epoch (vitest resetModules).
 */
function classifyRenderedLegError(error: unknown): RenderedLegOutcome {
  if (error instanceof Error) {
    const name = error.name;
    const message = error.message.toLowerCase();
    if (name === "AbortError" || name === "PromiseTimeoutError") {
      return "timeout";
    }
    if (message.includes("429") || message.includes("rate limit")) {
      return "rate_limited";
    }
    if (message.includes("timeout") || message.includes("timed out")) {
      return "timeout";
    }
  }
  return "failed";
}

/** Provider HTTP status → truthful leg outcome (429 rate limit, 408/504 timeout). */
function classifyProviderHttpOutcome(status: number): RenderedLegOutcome {
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 408 || status === 504) {
    return "timeout";
  }
  return "failed";
}

export class BrowserRunQuickActionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "BrowserRunQuickActionError";
  }
}

export function hasBrowserRunQuickActions<
  T extends Pick<AppEnv, "BROWSER_RUN_ACCOUNT_ID" | "BROWSER_RUN_API_TOKEN"> | null | undefined,
>(
  env: T,
): env is T & {
  BROWSER_RUN_ACCOUNT_ID: string;
  BROWSER_RUN_API_TOKEN: string;
} {
  return Boolean(env?.BROWSER_RUN_ACCOUNT_ID?.trim() && env?.BROWSER_RUN_API_TOKEN?.trim());
}

export async function captureBrowserRunSnapshot(
  env: AppEnv,
  url: string,
  options: RenderedCaptureOptions = {},
): Promise<LandingPageSnapshotData | null> {
  const publicUrl = await resolvePublicHttpUrl(url);
  if (!env.BROWSER || !publicUrl) {
    return null;
  }

  const jobId = options.jobId ?? crypto.randomUUID();
  const routeContext = options.routeContext ?? "proof_capture";
  const startedAt = new Date().toISOString();
  // One row per leg at its terminal point; the next leg in the chain
  // continues from the recorded attempt number via the shared out-param.
  let nextAttempt = options.attempt ?? 1;
  const recordRun = (
    outcome: RenderedLegOutcome,
    metadata: { reason?: string; captureWarningCodes?: string[] } = {},
  ) => {
    const attempt = nextAttempt;
    nextAttempt += 1;
    if (options.telemetryAttempts) {
      options.telemetryAttempts.used = attempt;
    }
    const endedAt = new Date().toISOString();
    return recordBrowserJobTelemetry(
      env,
      {
        jobId,
        jobKind: "landing_snapshot",
        actualProvider: "cloudflare_browser_run",
        routeContext,
        planTier: options.planTier ?? null,
        source: resolveSourceForRouteContext(routeContext, options.source),
        attempt,
        startedAt,
        endedAt,
        durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
        browserMsUsed: null,
        outcome,
        resultCount: outcome === "succeeded" ? 1 : null,
        workerVersion: resolveWorkerVersionId(env),
        cronTask: routeContext === "watchlist_scan" || routeContext === "scheduled_warmup" ? "cron" : null,
        idempotencyKey: `${options.idempotencyKey ?? jobId}:cloudflare_browser_run`,
      },
      {
        // Preserve background completion: when a real request ExecutionContext
        // exists, the row write is registered with waitUntil so it still lands
        // after the response; the bounded race still caps the wait here.
        executionContext: options.executionContext,
      },
    );
  };

  const targetUrl = publicUrl.toString();
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await promiseWithTimeout(
      puppeteer.launch(env.BROWSER),
      BROWSER_RUN_LAUNCH_TIMEOUT_MS,
      "Browser Run launch timed out.",
      (lateBrowser) => lateBrowser.close(),
    );
    const page = await browser.newPage();
    await installPublicBrowserRequestGuard(page);
    await page.setUserAgent(MOBILE_USER_AGENT);
    await page.setViewport(MOBILE_VIEWPORT);
    const { pageLoadStrategy, gotoAttempts } = await gotoWithEscalatingWaitStrategy(
      page,
      targetUrl,
    );

    const html = await page.content();
    if (utf8ByteLength(html) > MAX_RENDERED_HTML_BYTES) {
      await recordRun("failed", { reason: "html_oversized" });
      return null;
    }
    const canonicalUrl = (await resolvePublicHttpUrl(page.url() || targetUrl))?.toString();
    if (!canonicalUrl) {
      await recordRun("failed", { reason: "canonical_unresolved" });
      return null;
    }
    let screenshot: Uint8Array | ArrayBuffer | Buffer | null = null;
    const captureWarningCodes: string[] = [];
    for (let attempt = 1; attempt <= SCREENSHOT_CAPTURE_ATTEMPTS; attempt += 1) {
      try {
        screenshot = await page.screenshot({
          type: "jpeg",
          quality: 85,
          fullPage: false,
        });
        break;
      } catch (error) {
        if (attempt >= SCREENSHOT_CAPTURE_ATTEMPTS) {
          captureWarningCodes.push("screenshot_capture_failed");
          logRenderedCaptureWarning("screenshot_capture_failed", error);
        }
      }
    }

    const snapshot = await buildBrowserRenderedSnapshot(env, {
      url: targetUrl,
      canonicalUrl,
      html,
      screenshot,
      provider: "cloudflare_browser_run",
      persistArtifacts: options.persistArtifacts,
      requireScreenshot: options.requireScreenshot,
      captureWarningCodes,
      pageLoadStrategy,
      gotoAttempts,
    });
    if (!snapshot) {
      await recordRun("failed", {
        reason: "snapshot_unusable",
        captureWarningCodes,
      });
      return null;
    }
    await recordRun("succeeded", { captureWarningCodes });
    return snapshot;
  } catch (error) {
    logRenderedCaptureWarning("browser_render_failed", error);
    // Truthful attribution: a bounded provider timeout (launch/navigation
    // abort or PromiseTimeout) is `timeout` and a provider 429/rate-limit is
    // `rate_limited`; only other errors are `failed`. Customer-visible
    // behavior (returning null so the chain falls back) never changes.
    await recordRun(classifyRenderedLegError(error), { reason: "browser_render_failed" });
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function installPublicBrowserRequestGuard(page: BrowserRunPage) {
  await page.setRequestInterception(true);
  page.on("request", (request: BrowserRequestLike) => {
    void handleGuardedBrowserRequest(request);
  });
}

async function handleGuardedBrowserRequest(request: BrowserRequestLike) {
  if (request.isInterceptResolutionHandled?.()) {
    return;
  }

  const requestUrl = request.url();
  const allowed =
    isBrowserInternalUrl(requestUrl) || Boolean(await resolvePublicHttpUrl(requestUrl));

  if (request.isInterceptResolutionHandled?.()) {
    return;
  }

  if (allowed) {
    await request.continue();
  } else {
    await request.abort();
  }
}

function isBrowserInternalUrl(value: string) {
  return /^(?:about|blob|data):/i.test(value);
}

function isBrowserlessProofOriginAllowed(env: AppEnv, url: URL) {
  const configuredOrigins = String(env.BROWSERLESS_PROOF_ALLOWLIST_ORIGINS ?? "")
    .split(/[\s,]+/)
    .map((origin) => normalizePublicHttpUrl(origin)?.origin)
    .filter((origin): origin is string => Boolean(origin));
  const allowedOrigins =
    configuredOrigins.length > 0
      ? new Set(configuredOrigins)
      : DEFAULT_BROWSERLESS_PROOF_ALLOWED_ORIGINS;

  return allowedOrigins.has(url.origin);
}

/**
 * Rendered capture chain: Browser Run session first, Browserless BQL second.
 *
 * One fresh random `jobId` is derived ONCE here and shared by every leg of
 * the chain (callers that already hold a top-level job id pass it through).
 * The shared `telemetryAttempts` out-param keeps the legs' attempt numbers
 * centrally ordered: when the Browser Run leg actually ran and recorded its
 * row, the Browserless leg continues with the next attempt; when the Browser
 * Run binding never ran (unconfigured/unusable), the Browserless leg keeps
 * the caller's attempt so no two legs ever claim the same number.
 */
export async function captureRenderedLandingPageSnapshot(
  env: AppEnv,
  url: string,
  options: RenderedCaptureOptions = {},
): Promise<LandingPageSnapshotData | null> {
  const jobId = options.jobId ?? crypto.randomUUID();
  const telemetryAttempts = options.telemetryAttempts ?? {
    used: (options.attempt ?? 1) - 1,
  };
  const chainOptions = { ...options, jobId, telemetryAttempts };

  const snapshot = await captureBrowserRunSnapshot(env, url, chainOptions);
  if (snapshot) {
    return snapshot;
  }

  return captureBrowserlessProofSnapshot(env, url, {
    ...chainOptions,
    attempt: telemetryAttempts.used + 1,
  });
}

export async function captureBrowserlessProofSnapshot(
  env: AppEnv,
  url: string,
  options: RenderedCaptureOptions = {},
): Promise<LandingPageSnapshotData | null> {
  const publicUrl = await resolvePublicHttpUrl(url);
  if (!env.BROWSERLESS_TOKEN?.trim() || !publicUrl || !isBrowserlessProofOriginAllowed(env, publicUrl)) {
    return null;
  }

  const jobId = options.jobId ?? crypto.randomUUID();
  const routeContext = options.routeContext ?? "proof_capture";
  const startedAt = new Date().toISOString();
  // One row per leg at its terminal point; the attempt number continues the
  // chain set by `captureRenderedLandingPageSnapshot` (see the shared
  // out-param there).
  let nextAttempt = options.attempt ?? 1;
  const recordRun = (
    outcome: RenderedLegOutcome,
    metadata: { reason?: string; captureWarningCodes?: string[] } = {},
  ) => {
    const attempt = nextAttempt;
    nextAttempt += 1;
    if (options.telemetryAttempts) {
      options.telemetryAttempts.used = attempt;
    }
    const endedAt = new Date().toISOString();
    return recordBrowserJobTelemetry(
      env,
      {
        jobId,
        jobKind: "landing_snapshot",
        actualProvider: "browserless_bql",
        routeContext,
        planTier: options.planTier ?? null,
        source: resolveSourceForRouteContext(routeContext, options.source),
        attempt,
        startedAt,
        endedAt,
        durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
        browserMsUsed: null,
        outcome,
        resultCount: outcome === "succeeded" ? 1 : null,
        workerVersion: resolveWorkerVersionId(env),
        cronTask: routeContext === "watchlist_scan" || routeContext === "scheduled_warmup" ? "cron" : null,
        idempotencyKey: `${options.idempotencyKey ?? jobId}:browserless_bql`,
      },
      {
        // Preserve background completion when the caller has a request
        // ExecutionContext (see `RenderedCaptureOptions.executionContext`).
        executionContext: options.executionContext,
      },
    );
  };

  const targetUrl = publicUrl.toString();
  for (let attempt = 1; attempt <= MAX_BROWSERLESS_PROOF_RETRIES + 1; attempt += 1) {
    try {
      const { snapshot, retryable } = await attemptBrowserlessProofSnapshot(
        env,
        targetUrl,
        options,
        recordRun,
      );
      if (snapshot) {
        return snapshot;
      }
      // Permanent validation failures (non-public canonical URL, blocked
      // document requests) are never retried — they would waste a paid call.
      if (!retryable || attempt > MAX_BROWSERLESS_PROOF_RETRIES) {
        return null;
      }
    } catch (error) {
      logRenderedCaptureWarning("browserless_render_failed", error);
      if (attempt > MAX_BROWSERLESS_PROOF_RETRIES) {
        return null;
      }
    }
    await sleep(BROWSERLESS_RETRY_DELAY_MS);
  }
  return null;
}

type BrowserlessProofPayload = {
  data?: {
    html?: {
      html?: string;
    };
        screenshot?: {
          base64?: string;
        };
        documentRequests?: Array<{
          url?: string;
        }>;
        url?: {
          url?: string;
        };
  };
} | null;

async function attemptBrowserlessProofSnapshot(
  env: AppEnv,
  targetUrl: string,
  options: RenderedCaptureOptions,
  recordRun: (
    outcome: RenderedLegOutcome,
    metadata?: { reason?: string; captureWarningCodes?: string[] },
  ) => Promise<unknown>,
): Promise<{
  snapshot: LandingPageSnapshotData | null;
  retryable: boolean;
}> {
  try {
    const response = await fetchWithTimeout(
      buildBrowserlessBqlEndpoint(env),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: BROWSERLESS_PROOF_SNAPSHOT_MUTATION,
          variables: {
            url: targetUrl,
            userAgent: MOBILE_USER_AGENT,
          },
        }),
      },
      { timeoutMs: BROWSERLESS_PROOF_TIMEOUT_MS },
    );
    // Truthful provider-status classification comes BEFORE any body
    // handling: an error-status response with an empty or malformed body must
    // still be attributed by its status (429 → rate_limited, 408/504 →
    // timeout) instead of degrading to a generic `failed` empty/malformed
    // body row. Other error statuses stay `failed` with a bounded reason.
    if (!response.ok) {
      releaseFetchTimeout(response);
      const outcome = classifyProviderHttpOutcome(response.status);
      await recordRun(outcome, {
        reason: "provider_http_error",
      });
      // Only HTTP 429/5xx provider responses are transient and worth a
      // bounded retry; other HTTP errors are permanent.
      return { snapshot: null, retryable: isTransientHttpStatus(response.status) };
    }
    const responseText = await readResponseTextWithinLimit(response, MAX_BROWSERLESS_RESPONSE_BYTES);
    if (!responseText) {
      await recordRun("failed", { reason: "empty_response" });
      return { snapshot: null, retryable: true };
    }
    let payload: BrowserlessProofPayload = null;
    try {
      payload = JSON.parse(responseText) as BrowserlessProofPayload;
    } catch {
      await recordRun("failed", { reason: "malformed_response" });
      return { snapshot: null, retryable: true };
    }

    const html = payload?.data?.html?.html ?? "";
    const screenshotBase64 = payload?.data?.screenshot?.base64 ?? "";
    const canonicalUrl = (await resolvePublicHttpUrl(payload?.data?.url?.url ?? targetUrl))?.toString();
    const documentUrls = (payload?.data?.documentRequests ?? [])
      .map((request) => request.url)
      .filter((requestUrl): requestUrl is string => Boolean(requestUrl));
    const publicDocumentUrls = await Promise.all(
      documentUrls.map((requestUrl) => resolvePublicHttpUrl(requestUrl)),
    );
    if (
      !html ||
      utf8ByteLength(html) > MAX_RENDERED_HTML_BYTES ||
      !canonicalUrl ||
      publicDocumentUrls.some((requestUrl) => !requestUrl)
    ) {
      // Provider HTTP error statuses were already classified above (status
      // first, before the body); these are content/security failures and stay
      // `failed` (they are not provider errors).
      await recordRun("failed", {
        reason: !canonicalUrl
          ? "canonical_unresolved"
          : publicDocumentUrls.some((requestUrl) => !requestUrl)
            ? "non_public_document_request"
            : "html_missing_or_oversized",
      });
      return { snapshot: null, retryable: false };
    }
    const captureWarningCodes: string[] = [];
    let screenshot: Uint8Array | null = null;
    if (!screenshotBase64) {
      captureWarningCodes.push("screenshot_capture_failed");
    } else if (base64DecodedLengthExceeds(screenshotBase64, MAX_RENDERED_SCREENSHOT_BYTES)) {
      captureWarningCodes.push("screenshot_too_large");
    } else {
      try {
        screenshot = decodeBase64ToUint8Array(screenshotBase64);
      } catch (error) {
        captureWarningCodes.push("screenshot_decode_failed");
        logRenderedCaptureWarning("screenshot_decode_failed", error);
      }
    }

    const snapshot = await buildBrowserRenderedSnapshot(env, {
      url: targetUrl,
      canonicalUrl,
      html,
      screenshot,
      provider: "browserless_bql",
      persistArtifacts: options.persistArtifacts,
      requireScreenshot: options.requireScreenshot,
      captureWarningCodes,
    });
    if (!snapshot) {
      await recordRun("failed", {
        reason: "snapshot_unusable",
        captureWarningCodes,
      });
      return { snapshot: null, retryable: false };
    }
    await recordRun("succeeded", { captureWarningCodes });
    return { snapshot, retryable: false };
  } catch (error) {
    logRenderedCaptureWarning("browserless_render_failed", error);
    // Truthful attribution: a bounded provider timeout (fetch abort or
    // PromiseTimeout) is `timeout` and a provider 429/rate-limit is
    // `rate_limited`; only other errors are `failed`. Customer-visible
    // behavior (returning null so the chain falls back) never changes.
    const outcome = classifyRenderedLegError(error);
    await recordRun(outcome, { reason: "browserless_render_failed" });
    // A thrown provider failure (network abort, timeout, rate-limit) is
    // transient and worth a single bounded retry; the wrapper caps attempts
    // so a paid call is never wasted on repeated deterministic failures.
    return { snapshot: null, retryable: true };
  }
}

function isTransientHttpStatus(status: number) {
  return status === 429 || status >= 500;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureBrowserRunQuickActionContent(
  env: AppEnv,
  options: BrowserRunQuickActionContentOptions,
): Promise<{
  browserMsUsed: number | null;
  content: string;
} | null> {
  const publicUrl = options.url ? await resolvePublicHttpUrl(options.url) : null;
  if (!hasBrowserRunQuickActions(env) || !publicUrl) {
    return null;
  }

  return fetchQuickActionWithRetry(
    env,
    `https://api.cloudflare.com/client/v4/accounts/${env.BROWSER_RUN_ACCOUNT_ID.trim()}/browser-rendering/content?cacheTTL=0`,
    { ...options, url: publicUrl.toString() },
    (response, payload) => {
      if (response.ok && !payload) {
        throw buildBrowserRunQuickActionTimeoutError();
      }
      if (!response.ok || !payload?.success || typeof payload.result !== "string") {
        throw buildBrowserRunQuickActionError(response, payload);
      }
      return {
        browserMsUsed: parseBrowserMsUsedHeader(response.headers.get("X-Browser-Ms-Used")),
        content: payload.result,
      };
    },
  );
}

export async function captureBrowserRunQuickActionScrape(
  env: AppEnv,
  options: BrowserRunQuickActionScrapeOptions,
): Promise<{
  browserMsUsed: number | null;
  elements: BrowserRunQuickActionScrapeElement[];
} | null> {
  const publicUrl = options.url ? await resolvePublicHttpUrl(options.url) : null;
  if (!hasBrowserRunQuickActions(env) || !publicUrl) {
    return null;
  }

  return fetchQuickActionWithRetry(
    env,
    `https://api.cloudflare.com/client/v4/accounts/${env.BROWSER_RUN_ACCOUNT_ID.trim()}/browser-rendering/scrape?cacheTTL=0`,
    { ...options, url: publicUrl.toString() },
    (response, payload) => {
      if (response.ok && !payload) {
        throw buildBrowserRunQuickActionTimeoutError();
      }
      if (!response.ok || !payload?.success || !Array.isArray(payload.result)) {
        throw buildBrowserRunQuickActionError(response, payload);
      }
      return {
        browserMsUsed: parseBrowserMsUsedHeader(response.headers.get("X-Browser-Ms-Used")),
        elements: payload.result.flatMap((entry) => normalizeScrapeResults(entry.results)),
      };
    },
  );
}

/**
 * Bounded retry for Browser Run Quick Action calls. Transient failures
 * (429 rate limits, timeouts, 5xx, network errors) are retried once with a
 * short bounded backoff that honors Retry-After without ever waiting long.
 * The final error is preserved so callers can classify it honestly.
 */
async function fetchQuickActionWithRetry<TPayload, TResult>(
  env: {
    BROWSER_RUN_ACCOUNT_ID: string;
    BROWSER_RUN_API_TOKEN: string;
  },
  endpoint: string,
  body: unknown,
  onResolved: (
    response: Response,
    payload: BrowserRunQuickActionEnvelope<TPayload> | null,
  ) => TResult,
): Promise<TResult> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= QUICK_ACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          endpoint,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${env.BROWSER_RUN_API_TOKEN.trim()}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          },
          { timeoutMs: BROWSER_RUN_QUICK_ACTION_TIMEOUT_MS },
        );
      } catch (error) {
        if (isAbortError(error)) {
          throw buildBrowserRunQuickActionTimeoutError();
        }
        throw error;
      }
      const payload = await readResponseJsonWithinLimit<
        BrowserRunQuickActionEnvelope<TPayload>
      >(response, BROWSER_RUN_QUICK_ACTION_JSON_MAX_BYTES);

      return onResolved(response, payload);
    } catch (error) {
      lastError = error;
      if (!isQuickActionRetryable(error) || attempt >= QUICK_ACTION_MAX_ATTEMPTS) {
        throw error;
      }
      const retryAfterMs =
        error instanceof BrowserRunQuickActionError &&
        error.retryAfterSeconds &&
        error.retryAfterSeconds > 0
          ? Math.min(error.retryAfterSeconds * 1000, QUICK_ACTION_RETRY_MAX_DELAY_MS)
          : QUICK_ACTION_RETRY_DELAY_MS;
      await sleep(retryAfterMs);
    }
  }
  throw lastError;
}

function isQuickActionRetryable(error: unknown) {
  if (error instanceof BrowserRunQuickActionError) {
    return error.status === 429 || error.status === 408 || error.status >= 500;
  }
  return false;
}

/**
 * Navigate to a possibly JS-heavy page, escalating the wait strategy on
 * failure. networkidle2 can hang forever on long-polling/chat/analytics
 * pages; the second attempt uses `load`, which settles once the document
 * loads. Returns which strategy succeeded and how many attempts were used.
 */
async function gotoWithEscalatingWaitStrategy(page: BrowserRunPage, targetUrl: string) {
  let pageLoadStrategy: "networkidle2" | "load" = "networkidle2";
  for (let attempt = 1; attempt <= BROWSER_RUN_GOTO_STRATEGIES.length; attempt += 1) {
    const strategy = BROWSER_RUN_GOTO_STRATEGIES[attempt - 1];
    try {
      await page.goto(targetUrl, {
        waitUntil: strategy.waitUntil,
        timeout: strategy.timeoutMs,
      });
      pageLoadStrategy = strategy.waitUntil;
      return { pageLoadStrategy, gotoAttempts: attempt };
    } catch (error) {
      if (attempt >= BROWSER_RUN_GOTO_STRATEGIES.length) {
        throw error;
      }
      logRenderedCaptureWarning("browser_goto_retry", error);
    }
  }
  return { pageLoadStrategy, gotoAttempts: BROWSER_RUN_GOTO_STRATEGIES.length };
}

async function buildBrowserRenderedSnapshot(
  env: AppEnv,
  input: {
    url: string;
    canonicalUrl: string;
    html: string;
    provider: string;
    persistArtifacts?: boolean;
    requireScreenshot?: boolean;
    screenshot: Uint8Array | ArrayBuffer | Buffer | null;
    captureWarningCodes?: string[];
    pageLoadStrategy?: "networkidle2" | "load";
    gotoAttempts?: number;
  },
): Promise<LandingPageSnapshotData | null> {
  const html = input.html;
  const requestedScreenshotBytes = input.screenshot
    ? toUint8Array(input.screenshot)
    : null;
  if (utf8ByteLength(html) > MAX_RENDERED_HTML_BYTES) {
    return null;
  }
  const screenshotTooLarge =
    (requestedScreenshotBytes?.byteLength ?? 0) >
    MAX_RENDERED_SCREENSHOT_BYTES;
  const screenshotBytes = screenshotTooLarge
    ? null
    : requestedScreenshotBytes;

  const signals = extractLandingPageSignals(html, { documentMode: "rendered" });
  const headline = resolveHeadline(html);
  const normalized = normalizeHeadline(headline);

  // Capture-validity gate (BET 4): the rendered leg is the last line of
  // defense. A challenge/cookie-wall/partial-SPA/error body that survived the
  // plain-http leg (or came straight to render) is still a render failure
  // here. Returning null records a `capture_failed` and never produces a
  // snapshot from this HTML — no diff, no event, no alert.
  const validity = assessCaptureValidity({
    html,
    fetchStatus: 200,
    documentMode: "rendered",
  });
  if (!validity.valid) {
    return null;
  }

  const persisted = await persistBrowserArtifacts(
    env,
    input.canonicalUrl,
    html,
    screenshotBytes,
    input.persistArtifacts !== false,
    input.requireScreenshot === true,
  );
  const captureWarningCodes = [
    ...(input.captureWarningCodes ?? []),
    ...(screenshotTooLarge ? ["screenshot_too_large"] : []),
    ...persisted.captureWarningCodes,
  ];
  if (input.requireScreenshot && !persisted.screenshotArtifactKey) {
    return null;
  }
  // Screenshot corroboration (BET 4): the extracted price/CTA signals are
  // corroborated by a real rendered screenshot, not by markdown extraction
  // alone. A non-null screenshot that survived the gate is positive
  // corroboration; a missing/oversized screenshot is neutral (the gate still
  // passed on the HTML) and is recorded honestly.
  const screenshotCorroborates = Boolean(screenshotBytes);

  return {
      rawUrl: input.url,
      canonicalUrl: input.canonicalUrl,
      rawHeadline: normalized.raw,
      normalizedHeadline: normalized.normalized,
      normalizedHeadlineHash: normalized.hash,
      ctaText: signals.ctaText,
      priceText: signals.priceText,
      formPresent: signals.formPresent,
      captureMethod: "browser_render",
      capturedAt: new Date().toISOString(),
      artifactKey: persisted.htmlArtifactKey,
      metadata: {
        captureMethod: "browser_render",
        htmlArtifactKey: persisted.htmlArtifactKey,
        screenshotArtifactKey: persisted.screenshotArtifactKey,
        captureWarningCodes,
        captureValidated: true,
        screenshotCorroborates,
        ...(headline === "Landing page" &&
        !signals.ctaText &&
        !signals.priceText &&
        !signals.formPresent
          ? { unreadableReasonCode: "landing_signals_not_detected" }
          : {}),
        renderMode: MOBILE_RENDER_MODE,
        deviceProfile: MOBILE_DEVICE_PROFILE,
        renderProvider: input.provider,
        pageLoadStrategy: input.pageLoadStrategy,
        ...(input.gotoAttempts && input.gotoAttempts > 1
          ? { gotoAttempts: input.gotoAttempts }
          : {}),
        extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
        extractionWarnings: buildExtractionWarnings({
          headline,
          ctaText: signals.ctaText,
          priceText: signals.priceText,
          formPresent: signals.formPresent,
        }),
        extractedFieldConfidence: {
          headline: 0.95,
          ctaText: signals.ctaText ? 0.9 : 0.3,
          priceText: signals.priceText ? 0.85 : 0.25,
          formPresent: typeof signals.formPresent === "boolean" ? 0.9 : 0.25,
        },
      },
    };
}

function buildBrowserlessBqlEndpoint(env: AppEnv) {
  const rawBase =
    env.BROWSERLESS_BQL_URL ||
    "https://production-sfo.browserless.io/stealth/bql";
  const url = new URL(rawBase);
  if (!url.pathname.endsWith("/stealth/bql") && !url.pathname.endsWith("/chromium/bql")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/stealth/bql`;
  }
  url.searchParams.set("token", env.BROWSERLESS_TOKEN?.trim() ?? "");
  return url.toString();
}

function decodeBase64ToUint8Array(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function persistBrowserArtifacts(
  env: AppEnv,
  canonicalUrl: string,
  html: string,
  screenshot: Uint8Array | null,
  persistArtifacts: boolean,
  requireScreenshot: boolean = false,
) {
  if (!persistArtifacts || !env.LANDING_PAGE_ARTIFACTS) {
    return {
      htmlArtifactKey: null,
      screenshotArtifactKey: null,
      captureWarningCodes: [] as string[],
    };
  }

  const baseKey = `landing-pages/${new Date().toISOString().slice(0, 10)}/${crypto
    .randomUUID()
    .replaceAll("-", "")}`;
  const htmlArtifactKey = `${baseKey}.html`;
  const screenshotArtifactKey = `${baseKey}.jpeg`;

  let persistedScreenshotArtifactKey: string | null = null;
  let persistedHtmlArtifactKey: string | null = null;
  const captureWarningCodes: string[] = [];
  if (screenshot) {
    try {
      await env.LANDING_PAGE_ARTIFACTS.put(screenshotArtifactKey, screenshot, {
        httpMetadata: {
          contentType: "image/jpeg",
        },
        customMetadata: {
          sourceUrl: canonicalUrl,
          renderMode: MOBILE_RENDER_MODE,
          deviceProfile: MOBILE_DEVICE_PROFILE,
        },
      });
      persistedScreenshotArtifactKey = screenshotArtifactKey;
    } catch (error) {
      captureWarningCodes.push("screenshot_persistence_failed");
      logRenderedCaptureWarning("screenshot_persistence_failed", error);
    }
  }
  if (!requireScreenshot || persistedScreenshotArtifactKey) {
    try {
      await env.LANDING_PAGE_ARTIFACTS.put(htmlArtifactKey, html, {
        httpMetadata: {
          contentType: "text/html; charset=utf-8",
        },
        customMetadata: {
          sourceUrl: canonicalUrl,
          renderMode: MOBILE_RENDER_MODE,
        },
      });
      persistedHtmlArtifactKey = htmlArtifactKey;
    } catch (error) {
      captureWarningCodes.push("html_persistence_failed");
      logRenderedCaptureWarning("html_persistence_failed", error);
    }
  }

  return {
    htmlArtifactKey: persistedHtmlArtifactKey,
    screenshotArtifactKey: persistedScreenshotArtifactKey,
    captureWarningCodes,
  };
}

function logRenderedCaptureWarning(reasonCode: string, error: unknown) {
  console.warn(
    JSON.stringify({
      event: "landing_render_capture_warning",
      reasonCode,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }),
  );
}

function resolveHeadline(html: string) {
  return (
    decodeHtml(findFirstMatch(html, OG_TITLE_REGEX) ?? "") ||
    decodeHtml(findFirstMatch(html, TITLE_REGEX) ?? "") ||
    decodeHtml(stripTags(findFirstMatch(html, H1_REGEX) ?? "")) ||
    "Landing page"
  );
}

function buildExtractionWarnings(input: {
  headline: string | null;
  ctaText: string | null;
  priceText: string | null;
  formPresent: boolean | null;
}) {
  const warnings: string[] = [];

  if (!input.headline) {
    warnings.push("headline_missing");
  }
  if (!input.ctaText) {
    warnings.push("cta_missing");
  }
  if (!input.priceText) {
    warnings.push("offer_missing");
  }
  if (input.formPresent === false) {
    warnings.push("form_not_detected");
  }

  return warnings.filter((warning) => warning !== "form_not_detected");
}

function toUint8Array(value: Uint8Array | ArrayBuffer | Buffer) {
  if (value instanceof Uint8Array) {
    return value;
  }

  return new Uint8Array(value);
}

function findFirstMatch(value: string, regex: RegExp) {
  return value.match(regex)?.[1]?.trim() ?? null;
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function buildBrowserRunQuickActionError(
  response: Response,
  payload: BrowserRunQuickActionEnvelope<unknown> | null,
) {
  const retryAfterSeconds = parseRetryAfterHeader(response.headers.get("Retry-After"));
  const apiMessage = payload?.errors?.[0]?.message?.trim() || null;

  if (response.status === 429) {
    const message =
      retryAfterSeconds && retryAfterSeconds > 0
        ? `Browser Run Quick Actions rate limited this request. Retry after about ${retryAfterSeconds}s.`
        : "Browser Run Quick Actions rate limited this request.";
    return new BrowserRunQuickActionError(message, response.status, retryAfterSeconds);
  }

  return new BrowserRunQuickActionError(
    apiMessage || `Browser Run Quick Actions request failed with status ${response.status}.`,
    response.status,
    retryAfterSeconds,
  );
}

function buildBrowserRunQuickActionTimeoutError() {
  return new BrowserRunQuickActionError(
    "Browser Run Quick Actions timeout before returning a readable response.",
    408,
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function parseBrowserMsUsedHeader(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeScrapeResults(
  results: BrowserRunQuickActionScrapeResult["results"],
): BrowserRunQuickActionScrapeElement[] {
  if (Array.isArray(results)) {
    return results;
  }
  if (results && typeof results === "object") {
    return [results];
  }
  return [];
}

function parseRetryAfterHeader(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
