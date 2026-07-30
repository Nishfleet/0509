import { captureRenderedLandingPageSnapshot } from "~/lib/browser-run.server";
import { readResponseTextWithinLimit } from "~/lib/bounded-response.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import {
  extractLandingPageSignals,
  hasMeaningfulLandingPageBodyText,
  LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
} from "~/lib/landing-page-signals.server";
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

export type LandingPageCaptureFailureReasonCode =
  | "landing_url_invalid"
  | "landing_redirect_blocked"
  | "landing_redirect_limit"
  | "landing_blocked"
  | "landing_http_error"
  | "landing_fetch_failed"
  | "landing_content_empty_or_oversized";

export interface LandingPageCaptureFailureDetail {
  reasonCode: LandingPageCaptureFailureReasonCode;
  metadata: Record<string, unknown>;
}

interface CaptureLandingPageSnapshotOptions {
  allowRenderedFallback?: boolean;
  onFailure?: (detail: LandingPageCaptureFailureDetail) => void;
  /** Persist only when the caller will create an owner-addressable D1 reference. */
  persistArtifacts?: boolean;
  preferRendered?: boolean;
}

interface LandingPageCaptureAttemptState {
  captureWarningCodes: string[];
  renderedAttempted: boolean;
}

export async function captureLandingPageSnapshot(
  env: AppEnv,
  url: string,
  options: CaptureLandingPageSnapshotOptions = {},
): Promise<LandingPageSnapshotData | null> {
  const publicUrl = await resolvePublicHttpUrl(url);
  if (!publicUrl) {
    return failLandingCapture(options, "landing_url_invalid");
  }

  return captureLandingPageSnapshotAt(env, publicUrl, options, 0, {
    captureWarningCodes: [],
    renderedAttempted: false,
  });
}

async function captureLandingPageSnapshotAt(
  env: AppEnv,
  url: URL,
  options: CaptureLandingPageSnapshotOptions,
  redirectCount: number,
  state: LandingPageCaptureAttemptState,
): Promise<LandingPageSnapshotData | null> {
  if (redirectCount > MAX_LANDING_PAGE_REDIRECTS) {
    return failLandingCapture(options, "landing_redirect_limit", { redirectCount });
  }

  try {
    const resolvedUrl = await resolvePublicHttpUrl(url);
    if (!resolvedUrl) {
      return failLandingCapture(options, "landing_redirect_blocked", { redirectCount });
    }

    const { captureWarningCodes } = state;
    if (options.preferRendered && !state.renderedAttempted) {
      state.renderedAttempted = true;
      const renderedSnapshot = await captureRenderedSnapshot(
        env,
        resolvedUrl.toString(),
        options,
      );
      if (renderedSnapshot) {
        return renderedSnapshot;
      }
      captureWarningCodes.push("rendered_fallback_failed");
    }

    const response = await fetchWithTimeout(
      resolvedUrl.toString(),
      {
        redirect: "manual",
        headers: {
          "user-agent": "0509-bot/1.0 (+https://0509.io)",
        },
      },
      { timeoutMs: LANDING_PAGE_FETCH_TIMEOUT_MS },
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
          )
        : failLandingCapture(options, "landing_redirect_blocked", {
            fetchStatus: response.status,
            redirectCount,
          });
    }

    const finalUrl = await resolvePublicHttpUrl(response.url || resolvedUrl.toString());
    if (!finalUrl) {
      releaseFetchTimeout(response);
      return failLandingCapture(options, "landing_redirect_blocked", {
        fetchStatus: response.status,
        redirectCount,
      });
    }

    if (!response.ok) {
      const fetchStatus = response.status;
      releaseFetchTimeout(response);
      const reasonCode =
        fetchStatus === 401 || fetchStatus === 403 || fetchStatus === 429
          ? "landing_blocked"
          : "landing_http_error";
      if (
        options.allowRenderedFallback !== false &&
        !state.renderedAttempted
      ) {
        state.renderedAttempted = true;
        const rendered = await captureRenderedSnapshot(env, finalUrl.toString(), options);
        if (rendered) return rendered;
      }
      return failLandingCapture(options, reasonCode, { fetchStatus });
    }

    const html = await readResponseTextWithinLimit(response, MAX_LANDING_PAGE_HTML_BYTES);
    if (!html) {
      if (
        options.allowRenderedFallback !== false &&
        !state.renderedAttempted
      ) {
        state.renderedAttempted = true;
        const rendered = await captureRenderedSnapshot(env, finalUrl.toString(), options);
        if (rendered) return rendered;
      }
      return failLandingCapture(options, "landing_content_empty_or_oversized", {
        fetchStatus: response.status,
      });
    }
    const signals = extractLandingPageSignals(html, { documentMode: "raw" });
    const hasMeaningfulBodyText = hasMeaningfulLandingPageBodyText(html, {
      documentMode: "raw",
    });
    const signalsAreEmpty =
      !signals.ctaText && !signals.priceText && !signals.formPresent;
    const looksLikeSignalEmptyShell = signalsAreEmpty && !hasMeaningfulBodyText;
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
      const renderedSnapshot = await captureRenderedSnapshot(env, canonicalUrl, options);
      if (renderedSnapshot) {
        return renderedSnapshot;
      }
      captureWarningCodes.push("signal_empty_render_failed");
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

    return {
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
  } catch (error) {
    logLandingCaptureWarning("landing_fetch_failed", error);
    if (
      options.allowRenderedFallback !== false &&
      !state.renderedAttempted
    ) {
      state.renderedAttempted = true;
      const rendered = await captureRenderedSnapshot(env, url.toString(), options);
      if (rendered) return rendered;
    }
    return failLandingCapture(options, "landing_fetch_failed");
  }
}

function captureRenderedSnapshot(
  env: AppEnv,
  url: string,
  options: CaptureLandingPageSnapshotOptions,
) {
  return options.persistArtifacts === false
    ? captureRenderedLandingPageSnapshot(env, url, { persistArtifacts: false })
    : captureRenderedLandingPageSnapshot(env, url);
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400;
}

function failLandingCapture(
  options: CaptureLandingPageSnapshotOptions,
  reasonCode: LandingPageCaptureFailureReasonCode,
  metadata: Record<string, unknown> = {},
) {
  options.onFailure?.({ reasonCode, metadata });
  return null;
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

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
