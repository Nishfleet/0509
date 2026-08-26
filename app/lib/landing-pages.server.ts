import { captureRenderedLandingPageSnapshot } from "~/lib/browser-run.server";
import { readResponseTextWithinLimit, utf8ByteLength } from "~/lib/bounded-response.server";
import {
  assessCaptureValidity,
  type CaptureValidityReasonCode,
} from "~/lib/capture-validity.server";
import { decodeHtmlEntities as decodeHtml } from "~/lib/decode-html.server";
import {
  mapLandingFailureOutcome,
  recordBrowserJobTelemetry,
  resolveSourceForRouteContext,
  resolveWorkerVersionId,
  sha256Hex,
  type BrowserJobOutcome,
  type BrowserJobPlanTier,
  type BrowserJobRouteContext,
  type BrowserJobSource,
} from "~/lib/browser-job-telemetry.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import {
  extractLandingPageSignals,
  hasMeaningfulLandingPageBodyText,
  LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
} from "~/lib/landing-page-signals.server";
import {
  recordFetchStage,
  recordRenderStage,
  type LandingPagePipelineCounters,
} from "~/lib/landing-page-pipeline-instrumentation.server";
import { normalizeHeadline } from "~/lib/normalize";
import {
  normalizePublicHttpUrl,
  resolvePublicHttpUrl,
  resolvePublicRedirectUrl,
} from "~/lib/public-url.server";
import type { LandingPageSnapshotData } from "~/lib/types";

const TITLE_REGEX = /<title[^>]*>([^<]+)<\/title>/i;
const OG_TITLE_REGEX =
  /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const H1_REGEX = /<h1[^>]*>(.*?)<\/h1>/i;
const MAX_LANDING_PAGE_REDIRECTS = 5;
const MAX_LANDING_PAGE_HTML_BYTES = 1_000_000;
const LANDING_PAGE_FETCH_TIMEOUT_MS = 12_000;
/**
 * Capture reliability: transient fetch failures (network errors, HTTP 429,
 * and 5xx responses) are retried once before falling back to a rendered
 * capture — a single cold request often loses to a warm one on the same
 * page, and the whole point of the pipeline is a saved real proof.
 */
const MAX_LANDING_PAGE_FETCH_ATTEMPTS = 2;
const LANDING_PAGE_FETCH_RETRY_DELAY_MS = 250;

export type LandingPageCaptureFailureReasonCode =
  | "landing_url_invalid"
  | "landing_redirect_blocked"
  | "landing_redirect_limit"
  | "landing_blocked"
  | "landing_rate_limited"
  | "landing_http_error"
  | "landing_fetch_failed"
  | "landing_content_empty_or_oversized"
  | "screenshot_required"
  | CaptureValidityReasonCode;

export interface LandingPageCaptureFailureDetail {
  reasonCode: LandingPageCaptureFailureReasonCode;
  metadata: Record<string, unknown>;
}

interface CaptureLandingPageSnapshotOptions {
  allowRenderedFallback?: boolean;
  onFailure?: (detail: LandingPageCaptureFailureDetail) => void;
  /** Persist only when the caller will create an owner-addressable D1 reference. */
  persistArtifacts?: boolean;
  /**
   * When true, the capture is only considered successful if it carries a
   * persisted screenshotArtifactKey. This makes the screenshot step mandatory
   * and prevents HTML-only proof captures (issue #1103).
   */
  requireScreenshot?: boolean;
  preferRendered?: boolean;
  /** Attribution context recorded in `browser_job_telemetry` (optional).
   * Never carries URLs, tokens, or content. Defaults derive from existing
   * caller signals: `onFailure` presence ⇒ proof_capture/scheduled, else
   * selection_enrichment/manual. */
  routeContext?: BrowserJobRouteContext;
  planTier?: BrowserJobPlanTier | null;
  source?: BrowserJobSource;
  /**
   * Request ExecutionContext when the caller actually has one. When present,
   * telemetry row writes are registered with `waitUntil` so they still land
   * after the response (background completion preserved) while the bounded
   * race still caps how long the capture may wait on a slow write.
   */
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
  /**
   * Optional pipeline-instrumentation accumulator (issue #949). When present,
   * the fetch and render stages record their outcome and bail-out reason on
   * this counter so the caller can flush a per-check stage summary. The
   * counter is never mutated in a way that affects capture behaviour.
   */
  instrumentation?: LandingPagePipelineCounters | null;
}

interface LandingPageCaptureAttemptState {
  captureWarningCodes: string[];
  renderedAttempted: boolean;
}

/** Bounded attribution context for one landing-snapshot job (never raw content). */
interface LandingPageTelemetryContext {
  /** Random per top-level request; shared by every leg of the job. */
  jobId: string;
  /** Stable SHA-256 fingerprint of the canonical URL — never the raw URL. */
  idempotencyKey: string;
  routeContext: BrowserJobRouteContext;
  planTier: BrowserJobPlanTier | null;
  source: BrowserJobSource;
  startedAt: string;
  /**
   * Start of the current plain-http leg, captured immediately before that
   * leg's first fetch so a rendered-first failure (or any earlier work) is
   * never included in the HTTP leg's recorded duration. Null until the leg
   * actually begins.
   */
  plainHttpStartedAt: string | null;
  /** Caller's optional request ExecutionContext (background completion). */
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  /** Central per-job attempt counter (plain-http legs + rendered legs). */
  attemptUsed: number;
  /** True once the plain-http leg row exists for this job (no double rows). */
  plainHttpRecorded: boolean;
}

export async function captureLandingPageSnapshot(
  env: AppEnv,
  url: string,
  options: CaptureLandingPageSnapshotOptions = {},
): Promise<LandingPageSnapshotData | null> {
  const publicUrl = await resolvePublicHttpUrl(url);
  const routeContext =
    options.routeContext ?? (options.onFailure ? "proof_capture" : "selection_enrichment");
  const telemetry: LandingPageTelemetryContext = {
    jobId: crypto.randomUUID(),
    // Stable across retries of the same URL; the raw URL never reaches the
    // telemetry table (writer bounds reject raw URLs anyway).
    idempotencyKey: await sha256Hex(`landing:${publicUrl?.toString() ?? url}`),
    routeContext,
    planTier: options.planTier ?? null,
    source: resolveSourceForRouteContext(routeContext, options.source),
    startedAt: new Date().toISOString(),
    plainHttpStartedAt: null,
    executionContext: options.executionContext ?? null,
    attemptUsed: 0,
    plainHttpRecorded: false,
  };
  if (!publicUrl) {
    await recordLandingLeg(env, telemetry, mapLandingFailureOutcome("landing_url_invalid"));
    return failLandingCapture(options, "landing_url_invalid");
  }

  return captureLandingPageSnapshotAt(env, publicUrl, options, 0, {
    captureWarningCodes: [],
    renderedAttempted: false,
  }, telemetry);
}

/**
 * One bounded `plain_http` attribution row for this landing job (never
 * throws). The attempt counter increments centrally: the plain-http leg owns
 * the next attempt number, and rendered legs continue after it. The recorded
 * startedAt/duration are the plain-http leg's own window
 * (`plainHttpStartedAt`, captured immediately before the leg's fetch), never
 * the job start — so rendered-first time can never inflate the HTTP duration.
 */
function recordLandingLeg(
  env: AppEnv,
  telemetry: LandingPageTelemetryContext,
  outcome: BrowserJobOutcome,
  detail: { resultCount?: number | null; resultBytes?: number | null } = {},
) {
  telemetry.attemptUsed += 1;
  telemetry.plainHttpRecorded = true;
  // endedAt and durationMs are captured together so the recorded duration is
  // exactly the recorded window (ended_at - started_at), never a re-read of
  // the clock with a different origin. Pre-fetch validation failures fall
  // back to the job start (nothing meaningful ran before them).
  const legStartedAt = telemetry.plainHttpStartedAt ?? telemetry.startedAt;
  const endedAt = new Date().toISOString();
  return recordBrowserJobTelemetry(
    env,
    {
      jobId: telemetry.jobId,
      idempotencyKey: `${telemetry.idempotencyKey}:plain_http`,
      jobKind: "landing_snapshot",
      actualProvider: "plain_http",
      routeContext: telemetry.routeContext,
      planTier: telemetry.planTier,
      source: telemetry.source,
      attempt: telemetry.attemptUsed,
      startedAt: legStartedAt,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(legStartedAt)),
      outcome,
      resultCount: detail.resultCount ?? null,
      resultBytes: detail.resultBytes ?? null,
      workerVersion: resolveWorkerVersionId(env),
      cronTask:
        telemetry.routeContext === "watchlist_scan" ||
        telemetry.routeContext === "scheduled_warmup"
          ? "cron"
          : null,
    },
    {
      // Preserve background completion when the caller has a request
      // ExecutionContext (see `CaptureLandingPageSnapshotOptions`).
      executionContext: telemetry.executionContext,
    },
  );
}

async function captureLandingPageSnapshotAt(
  env: AppEnv,
  url: URL,
  options: CaptureLandingPageSnapshotOptions,
  redirectCount: number,
  state: LandingPageCaptureAttemptState,
  telemetry: LandingPageTelemetryContext,
  plainHttpStartedAt: string | null = null,
): Promise<LandingPageSnapshotData | null> {
  // Pre-fetch validation failures keep the leg's start (from the first fetch
  // of the chain when one already ran; otherwise the job start, which is
  // truthful because nothing ran before the validation).
  telemetry.plainHttpStartedAt ??= plainHttpStartedAt;
  if (redirectCount > MAX_LANDING_PAGE_REDIRECTS) {
    await recordLandingLeg(
      env,
      telemetry,
      mapLandingFailureOutcome("landing_redirect_limit"),
    );
    return failLandingCapture(options, "landing_redirect_limit", { redirectCount });
  }

  try {
    const resolvedUrl = await resolvePublicHttpUrl(url);
    if (!resolvedUrl) {
      await recordLandingLeg(
        env,
        telemetry,
        mapLandingFailureOutcome("landing_redirect_blocked"),
      );
      return failLandingCapture(options, "landing_redirect_blocked", { redirectCount });
    }

    const { captureWarningCodes } = state;
    if (options.preferRendered && !state.renderedAttempted) {
      state.renderedAttempted = true;
      const renderedSnapshot = await captureRenderedSnapshot(
        env,
        resolvedUrl.toString(),
        options,
        telemetry,
      );
      if (renderedSnapshot) {
        return renderedSnapshot;
      }
      if (options.requireScreenshot) {
        return failLandingCapture(options, "screenshot_required", {
          renderedFallbackFailed: true,
        });
      }
      captureWarningCodes.push("rendered_fallback_failed");
    }

    // The plain-http leg begins here: its start timestamp is captured
    // immediately before the fetch (once per leg — redirect hops continue
    // the same leg), so rendered-first time or any earlier work is never
    // included in the HTTP leg's recorded duration.
    telemetry.plainHttpStartedAt ??= new Date().toISOString();
    const { fetchAttempts, response } = await fetchLandingPageWithTransientRetry(
      resolvedUrl.toString(),
    );

    if (isRedirectStatus(response.status)) {
      const redirectedUrl = resolvePublicRedirectUrl(response.headers.get("location"), resolvedUrl);
      releaseFetchTimeout(response);
      return redirectedUrl
        ? captureLandingPageSnapshotAt(
            env,
            redirectedUrl,
            options,
            redirectCount + 1,
            state,
            telemetry,
            telemetry.plainHttpStartedAt,
          )
        : recordFailedLanding(env, telemetry, options, "landing_redirect_blocked", {
            fetchStatus: response.status,
            redirectCount,
          });
    }

    const finalUrl = await resolvePublicHttpUrl(response.url || resolvedUrl.toString());
    if (!finalUrl) {
      releaseFetchTimeout(response);
      return recordFailedLanding(env, telemetry, options, "landing_redirect_blocked", {
        fetchStatus: response.status,
        redirectCount,
      });
    }

    if (!response.ok) {
      const fetchStatus = response.status;
      releaseFetchTimeout(response);
      const reasonCode =
        fetchStatus === 429
          ? "landing_rate_limited"
          : fetchStatus === 401 || fetchStatus === 403
            ? "landing_blocked"
            : "landing_http_error";
      if (
        options.allowRenderedFallback !== false &&
        !state.renderedAttempted
      ) {
        // Record the failed plain-http leg BEFORE the rendered fallback runs,
        // so rows keep the job's ordered attempts (plain_http = N, rendered =
        // N+1) instead of writing the failed row after a rendered success.
        state.renderedAttempted = true;
        await recordLandingLeg(env, telemetry, mapLandingFailureOutcome(reasonCode));
        const rendered = await captureRenderedSnapshot(env, finalUrl.toString(), options, telemetry);
        if (rendered) {
          return rendered;
        }
      }
      return recordFailedLanding(env, telemetry, options, reasonCode, { fetchStatus });
    }

    const html = await readResponseTextWithinLimit(response, MAX_LANDING_PAGE_HTML_BYTES);
    if (!html) {
      if (
        options.allowRenderedFallback !== false &&
        !state.renderedAttempted
      ) {
        state.renderedAttempted = true;
        await recordLandingLeg(
          env,
          telemetry,
          mapLandingFailureOutcome("landing_content_empty_or_oversized"),
        );
        const rendered = await captureRenderedSnapshot(env, finalUrl.toString(), options, telemetry);
        if (rendered) {
          return rendered;
        }
      }
      return recordFailedLanding(
        env,
        telemetry,
        options,
        "landing_content_empty_or_oversized",
        { fetchStatus: response.status },
      );
    }
    const signals = extractLandingPageSignals(html, { documentMode: "raw" });
    const hasMeaningfulBodyText = hasMeaningfulLandingPageBodyText(html, {
      documentMode: "raw",
    });
    const looksLikeSignalEmptyShell = !hasMeaningfulBodyText;
    // Capture-validity gate (BET 4): a 200 with a challenge/cookie-wall/partial
    // -SPA/error body is a render failure, not a real page. The extracted
    // signals would come from the wall, not the page, and any diff against the
    // last real proof would be a phantom change. Try the rendered fallback
    // first (the wall may render client-side past the gate); if that fails or
    // is disabled, record a `capture_failed` with the gate's reason and never
    // produce a snapshot from this HTML.
    const validity = assessCaptureValidity({
      html,
      fetchStatus: response.status,
      documentMode: "raw",
    });
    if (!validity.valid) {
      if (
        options.allowRenderedFallback !== false &&
        !state.renderedAttempted
      ) {
        state.renderedAttempted = true;
        await recordLandingLeg(env, telemetry, mapLandingFailureOutcome(validity.reasonCode!), {
          resultCount: 1,
          resultBytes: utf8ByteLength(html),
        });
        const renderedSnapshot = await captureRenderedSnapshot(
          env,
          finalUrl.toString(),
          options,
          telemetry,
        );
        if (renderedSnapshot) {
          return renderedSnapshot;
        }
        captureWarningCodes.push("capture_validity_render_failed");
      }
      return recordFailedLanding(
        env,
        telemetry,
        options,
        validity.reasonCode!,
        {
          fetchStatus: response.status,
          captureValidityReason: validity.reason,
          captureValidityFingerprint: validity.fingerprint,
        },
      );
    }
    const headline =
      decodeHtml(findFirstMatch(html, OG_TITLE_REGEX) ?? "") ||
      decodeHtml(findFirstMatch(html, TITLE_REGEX) ?? "") ||
      decodeHtml(stripTags(findFirstMatch(html, H1_REGEX) ?? "")) ||
      "Landing page";

    const normalized = normalizeHeadline(headline);
    const canonicalUrl = finalUrl.toString();
    if (
      options.allowRenderedFallback !== false &&
      !state.renderedAttempted &&
      looksLikeSignalEmptyShell
    ) {
      state.renderedAttempted = true;
      // The plain-http leg honestly returned an empty shell: record it before
      // the rendered fallback so attempt order stays truthful.
      await recordLandingLeg(env, telemetry, "empty", {
        resultCount: 1,
        resultBytes: utf8ByteLength(html),
      });
      const renderedSnapshot = await captureRenderedSnapshot(env, canonicalUrl, options, telemetry);
      if (renderedSnapshot) {
        return renderedSnapshot;
      }
      captureWarningCodes.push("signal_empty_render_failed");
    }
    if (options.requireScreenshot) {
      return failLandingCapture(options, "screenshot_required", {
        captureMethod: "landing_page_fetch",
      });
    }
    let artifactKey: string | null = null;
    if (options.persistArtifacts !== false && env.LANDING_PAGE_ARTIFACTS) {
      try {
        artifactKey = await persistArtifact(env.LANDING_PAGE_ARTIFACTS, canonicalUrl, html);
      } catch (error) {
        captureWarningCodes.push("artifact_persistence_failed");
        logLandingCaptureWarning("artifact_persistence_failed", error);
      }
    }

    const snapshot: LandingPageSnapshotData = {
      rawUrl: url.toString(),
      canonicalUrl,
      rawHeadline: normalized.raw,
      normalizedHeadline: normalized.normalized,
      normalizedHeadlineHash: normalized.hash,
      ctaText: signals.ctaText,
      priceText: signals.priceText,
      formPresent: signals.formPresent,
      captureMethod: "landing_page_fetch",
      capturedAt: new Date().toISOString(),
      artifactKey,
      metadata: {
        captureMethod: "landing_page_fetch",
        captureWarningCodes,
        captureValidated: true,
        ...(fetchAttempts > 1 ? { fetchAttempts } : {}),
        ...(looksLikeSignalEmptyShell
          ? { unreadableReasonCode: "landing_signals_not_detected" }
          : {}),
        extractionWarnings: buildExtractionWarnings({
          headline,
          ctaText: signals.ctaText,
          priceText: signals.priceText,
          formPresent: signals.formPresent,
        }),
        extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
        fetchStatus: response.status,
      },
    };
    const outcome = looksLikeSignalEmptyShell ? "empty" : "succeeded";
    if (!telemetry.plainHttpRecorded) {
      await recordLandingLeg(env, telemetry, outcome, {
        resultCount: 1,
        resultBytes: utf8ByteLength(html),
      });
    }
    return snapshot;
  } catch (error) {
    logLandingCaptureWarning("landing_fetch_failed", error);
    // Truthful mapping: a fetch that hit the bounded timeout (internal abort
    // signal or PromiseTimeoutError) is attributed as `timeout`, never as a
    // generic failure. The customer-visible reasonCode stays unchanged.
    const timeoutOutcome: BrowserJobOutcome | undefined = isFetchTimeoutError(error)
      ? "timeout"
      : undefined;
    if (
      options.allowRenderedFallback !== false &&
      !state.renderedAttempted
    ) {
      state.renderedAttempted = true;
      await recordLandingLeg(
        env,
        telemetry,
        timeoutOutcome ?? mapLandingFailureOutcome("landing_fetch_failed"),
      );
      const rendered = await captureRenderedSnapshot(env, url.toString(), options, telemetry);
      if (rendered) {
        return rendered;
      }
    }
    return recordFailedLanding(
      env,
      telemetry,
      options,
      "landing_fetch_failed",
      {},
      timeoutOutcome,
    );
  }
}

async function captureRenderedSnapshot(
  env: AppEnv,
  url: string,
  options: CaptureLandingPageSnapshotOptions,
  telemetry: LandingPageTelemetryContext,
) {
  // The rendered chain (Browser Run → Browserless) continues the job's
  // ordered attempt chain and may record more than one row. The shared
  // out-param reports every attempt the chain actually used, and the central
  // counter syncs to it afterwards so any later leg (e.g. a final plain-http
  // record) continues from the true last attempt.
  const attribution = {
    jobId: telemetry.jobId,
    routeContext: telemetry.routeContext,
    planTier: telemetry.planTier,
    source: telemetry.source,
    attempt: telemetry.attemptUsed + 1,
    idempotencyKey: telemetry.idempotencyKey,
    telemetryAttempts: { used: telemetry.attemptUsed },
    executionContext: telemetry.executionContext,
  };
  const renderOptions = {
    ...attribution,
    persistArtifacts: options.persistArtifacts,
    requireScreenshot: options.requireScreenshot,
  };
  try {
    const snapshot = await (options.persistArtifacts === false
      ? captureRenderedLandingPageSnapshot(env, url, {
          ...renderOptions,
          persistArtifacts: false,
        })
      : captureRenderedLandingPageSnapshot(env, url, renderOptions));
    telemetry.attemptUsed = attribution.telemetryAttempts.used;
    if (
      snapshot &&
      options.requireScreenshot &&
      !snapshotHasScreenshotArtifact(snapshot)
    ) {
      if (options.instrumentation) {
        recordRenderStage(options.instrumentation, "failed", "screenshot_required");
      }
      return null;
    }
    if (options.instrumentation) {
      recordRenderStage(options.instrumentation, snapshot ? "succeeded" : "failed");
    }
    return snapshot;
  } catch (error) {
    logLandingCaptureWarning("rendered_fallback_failed", error);
    if (options.instrumentation) {
      recordRenderStage(options.instrumentation, "failed", "rendered_fallback_failed");
    }
    return null;
  }
}

async function fetchLandingPageWithTransientRetry(
  url: string,
): Promise<{ fetchAttempts: number; response: Response }> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_LANDING_PAGE_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          redirect: "manual",
          headers: {
            "user-agent": "0509-bot/1.0 (+https://0509.io)",
          },
        },
        { timeoutMs: LANDING_PAGE_FETCH_TIMEOUT_MS },
      );
      // Redirects are handled by the caller; only 429/5xx responses are
      // transient. 4xx failures (blocked, not found) are never retried.
      if (
        attempt < MAX_LANDING_PAGE_FETCH_ATTEMPTS &&
        !isRedirectStatus(response.status) &&
        isTransientFetchStatus(response.status)
      ) {
        releaseFetchTimeout(response);
        await sleep(LANDING_PAGE_FETCH_RETRY_DELAY_MS);
        continue;
      }
      return { fetchAttempts: attempt, response };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_LANDING_PAGE_FETCH_ATTEMPTS) {
        throw error;
      }
      await sleep(LANDING_PAGE_FETCH_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

function isTransientFetchStatus(status: number) {
  return status === 429 || status >= 500;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400;
}

/**
 * Record the failed plain-http leg (once per job), then run the caller's
 * failure hook. Legs already recorded before a rendered fallback never
 * double-record. `outcomeOverride` lets the caller attribute a truthful
 * outcome (e.g. `timeout`) without changing the customer-visible reasonCode.
 */
async function recordFailedLanding(
  env: AppEnv,
  telemetry: LandingPageTelemetryContext,
  options: CaptureLandingPageSnapshotOptions,
  reasonCode: LandingPageCaptureFailureReasonCode,
  metadata: Record<string, unknown> = {},
  outcomeOverride?: BrowserJobOutcome,
) {
  if (!telemetry.plainHttpRecorded) {
    await recordLandingLeg(
      env,
      telemetry,
      outcomeOverride ?? mapLandingFailureOutcome(reasonCode),
    );
  }
  return failLandingCapture(options, reasonCode, metadata);
}

/** A fetch that hit the bounded timeout: internal abort or promise timeout. */
function isFetchTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "PromiseTimeoutError")
  );
}

function failLandingCapture(
  options: CaptureLandingPageSnapshotOptions,
  reasonCode: LandingPageCaptureFailureReasonCode,
  metadata: Record<string, unknown> = {},
) {
  options.onFailure?.({ reasonCode, metadata });
  return null;
}

function snapshotHasScreenshotArtifact(snapshot: LandingPageSnapshotData): boolean {
  const key = snapshot.metadata?.screenshotArtifactKey;
  return typeof key === "string" && key.length > 0;
}

function buildExtractionWarnings(input: {
  headline: string;
  ctaText: string | null;
  priceText: string | null;
  formPresent: boolean;
}) {
  return [
    ...(input.headline === "Landing page" ? ["headline_not_detected"] : []),
    ...(!input.ctaText ? ["cta_not_detected"] : []),
    ...(!input.priceText ? ["price_not_detected"] : []),
    ...(!input.formPresent ? ["form_not_detected"] : []),
  ];
}

function logLandingCaptureWarning(reasonCode: string, error: unknown) {
  console.warn(
    JSON.stringify({
      event: "landing_page_capture_warning",
      reasonCode,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }),
  );
}

async function persistArtifact(bucket: R2Bucket, url: string, html: string) {
  const objectKey = `landing-pages/${new Date().toISOString().slice(0, 10)}/${crypto
    .randomUUID()
    .replaceAll("-", "")}.html`;
  await bucket.put(objectKey, html, {
    httpMetadata: {
      contentType: "text/html; charset=utf-8",
    },
    customMetadata: {
      sourceUrl: url,
    },
  });
  return objectKey;
}

function findFirstMatch(value: string, regex: RegExp) {
  return value.match(regex)?.[1]?.trim() ?? null;
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
