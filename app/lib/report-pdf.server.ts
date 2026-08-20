/**
 * Server-rendered PDF export of shared report snapshots (P2, 2026-07-13).
 *
 * GET /share/:token/pdf resolves the share token, gates on the SHARER's
 * `pdf_reports` entitlement, applies fail-closed spend caps (per-IP burst +
 * per-sharer daily), preflights Browser Rendering capacity, then prints the
 * public `?pdf=1` variant of the share page via CDP.
 *
 * Cost posture: Browser Rendering is usage-billed and shares capacity with
 * monitoring scans, so every gate here is a launch requirement, not polish.
 * The render URL is built ONLY from server-configured origin vars plus the
 * D1-validated token — never from request input (SSRF).
 */

import puppeteer from "@cloudflare/puppeteer";

import { isApprovedReportSnapshot } from "~/lib/report-approval";

import {
  mapPdfErrorOutcome,
  recordBrowserJobTelemetry,
  resolveWorkerVersionId,
  type BrowserJobOutcome,
} from "~/lib/browser-job-telemetry.server";
import type { AppEnv } from "~/lib/env.server";
import { promiseWithTimeout } from "~/lib/fetch-timeout.server";
import { canUsePlanFeature } from "~/lib/plan-entitlements";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const PDF_LAUNCH_TIMEOUT_MS = 10_000;
const PDF_CAPACITY_LOOKUP_TIMEOUT_MS = 10_000;
const PDF_RENDER_TIMEOUT_MS = 40_000;
const PDF_NAVIGATION_TIMEOUT_MS = 30_000;
const PDF_REPORT_ROOT_TIMEOUT_MS = 10_000;
const PDF_MAX_BYTES = 10 * 1024 * 1024;
const PDF_REPORT_ROOT_SELECTOR = "[data-report-root]";
const PDF_CAPACITY_DEFAULT_RETRY_AFTER_SECONDS = 60;

interface BrowserRunLimits {
  allowedBrowserAcquisitions: number;
  timeUntilNextAllowedBrowserAcquisition: number;
}

type PdfBrowser = Awaited<ReturnType<typeof puppeteer.launch>>;

export async function renderShareReportPdfResponse(
  env: AppEnv,
  request: Request,
  token: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const {
    enforceSharePdfRateLimit,
    enforceSharePdfDailyCap,
    claimSharePdfSingleFlight,
  } = await import("~/lib/rate-limit.server");

  // Browser navigations get a branded HTML page; API callers keep JSON.
  const prefersHtml = requestPrefersHtml(request);

  // Per-IP burst gate first so invalid-token spam is also throttled.
  const ipLimited = await enforceSharePdfRateLimit(request, env, ctx);
  if (ipLimited) {
    return ipLimited;
  }

  if (!token.trim()) {
    return pdfErrorResponse(404, "not_found", "This share link does not exist.", prefersHtml);
  }

  const { getShareLink } = await import("~/lib/data.server");
  const share = await getShareLink(env, token);
  if (!share) {
    return pdfErrorResponse(404, "not_found", "This share link does not exist.", prefersHtml);
  }

  // Snapshots are immutable, so the PDF is truthful. Live shares re-query on
  // every view and could drift between render and read — refuse honestly.
  if (!share.isSnapshot || share.resourceType !== "report") {
    return pdfErrorResponse(
      404,
      "pdf_unavailable",
      "PDF export is only available for report snapshot shares.",
      prefersHtml,
    );
  }

  if (!isApprovedReportSnapshot(share.snapshotPayload)) {
    return pdfErrorResponse(
      409,
      "evidence_not_ready",
      "This report needs a fresh owner review before PDF export.",
      prefersHtml,
    );
  }

  const { getUserPlan } = await import("~/lib/plan.server");
  const sharerPlan = await getUserPlan(env, share.userId);
  if (!canUsePlanFeature(sharerPlan, "pdf_reports")) {
    return pdfErrorResponse(
      403,
      "plan_gated",
      "PDF export is not included in this report owner's plan.",
      prefersHtml,
    );
  }

  // Attribution context (browser_job_telemetry, migration 0075). Recording
  // starts only where a real Cloudflare Browser Run attempt begins: the gates
  // before it (not_found, pdf_unavailable, evidence_not_ready, plan_gated)
  // and the pre-provider config/capacity gates (pdf_unconfigured,
  // capacity_unavailable, capacity_exhausted, single-flight, daily cap)
  // reject the request before any browser job exists, so no row claiming a
  // provider attempt is written there. jobId is a random id per request;
  // idempotencyKey is the immutable report-content SHA-256 fingerprint. Only
  // the sharer's plan family is persisted — never tokens, URLs, or content.
  const pdfJobId = crypto.randomUUID();
  const pdfContentFingerprint = await reportPdfContentFingerprint(share.snapshotPayload);
  // Provider-attempt start: assigned immediately before the actual Browser
  // Run acquisition (after token hashing, capacity lookup, single-flight,
  // and daily-cap gates), so the recorded duration is the provider window
  // only and never claims pre-provider gate milliseconds.
  let pdfProviderStartedAt = new Date().toISOString();
  const recordPdfJob = (
    outcome: BrowserJobOutcome,
    detail: { resultBytes?: number | null } = {},
  ) => {
    // endedAt and durationMs are captured together so the recorded duration
    // is exactly the recorded window from the same recorded startedAt.
    const endedAt = new Date().toISOString();
    return recordBrowserJobTelemetry(env, {
      jobId: pdfJobId,
      idempotencyKey: pdfContentFingerprint,
      jobKind: "report_pdf",
      actualProvider: "cloudflare_browser_run",
      routeContext: "share_pdf",
      planTier: sharerPlan,
      source: "manual",
      attempt: 1,
      startedAt: pdfProviderStartedAt,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(pdfProviderStartedAt)),
      outcome,
      resultCount: null,
      resultBytes: detail.resultBytes ?? null,
      workerVersion: resolveWorkerVersionId(env),
      cronTask: null,
    }, {
      // Preserve background completion: when a real request ExecutionContext
      // exists, the row write is registered with waitUntil so it still lands
      // after the PDF response; the bounded race still caps how long the
      // render path may wait on a slow write.
      executionContext: ctx,
    });
  };

  const origin = resolveConfiguredOrigin(env);
  if (!env.BROWSER || !origin) {
    return pdfErrorResponse(
      503,
      "pdf_unconfigured",
      "PDF rendering is not configured. Use your browser's print option instead.",
      prefersHtml,
    );
  }

  const capacity = await readBrowserLimits(env.BROWSER);
  if (!capacity) {
    return pdfErrorResponse(
      503,
      "capacity_unavailable",
      "PDF rendering capacity could not be verified. Try again shortly.",
      prefersHtml,
      PDF_CAPACITY_DEFAULT_RETRY_AFTER_SECONDS,
    );
  }

  if (capacity.allowedBrowserAcquisitions < 1) {
    const retryAfterSeconds =
      normalizeRetryAfterSeconds(capacity.timeUntilNextAllowedBrowserAcquisition) ??
      PDF_CAPACITY_DEFAULT_RETRY_AFTER_SECONDS;
    return pdfErrorResponse(
      503,
      "capacity_exhausted",
      "PDF rendering capacity is temporarily busy. Try again shortly.",
      prefersHtml,
      retryAfterSeconds,
    );
  }

  const singleFlightLimited = await claimSharePdfSingleFlight(env, {
    sharerUserId: share.userId,
    resourceId: share.resourceId,
    contentFingerprint: pdfContentFingerprint,
  });
  if (singleFlightLimited) {
    return singleFlightLimited;
  }

  // Reserve the sharer's daily render budget only after configuration and
  // provider capacity preflight pass. The reservation is intentionally not
  // refunded after this point: a launch/render failure may already consume
  // usage-billed Browser Run capacity, so every attempted render counts.
  const dailyLimited = await enforceSharePdfDailyCap(request, env, share.userId, ctx);
  if (dailyLimited) {
    return dailyLimited;
  }

  const renderUrl = new URL(`/share/${share.token}`, origin);
  renderUrl.searchParams.set("pdf", "1");

  let browser: PdfBrowser | null = null;
  try {
    // The provider attempt begins here: every pre-provider gate (origin,
    // config, capacity lookup, single-flight, daily cap) has passed, so the
    // recorded startedAt/duration reflect the real Browser Run window only.
    pdfProviderStartedAt = new Date().toISOString();
    browser = await promiseWithTimeout(
      puppeteer.launch(env.BROWSER),
      PDF_LAUNCH_TIMEOUT_MS,
      "Browser Run launch timed out.",
      (lateBrowser) => lateBrowser.close(),
    );
    const pdf = await promiseWithTimeout(
      renderReportPdf(browser, renderUrl.toString()),
      PDF_RENDER_TIMEOUT_MS,
      "Report PDF render timed out.",
    );

    if (pdf.byteLength > PDF_MAX_BYTES) {
      await recordPdfJob(mapPdfErrorOutcome("pdf_too_large"), {
        resultBytes: pdf.byteLength,
      });
      return pdfErrorResponse(
        502,
        "pdf_too_large",
        "The rendered PDF exceeded the size limit. Use your browser's print option instead.",
        prefersHtml,
      );
    }

    await recordPdfJob("succeeded", { resultBytes: pdf.byteLength });

    return new Response(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${reportPdfFilename(share.snapshotPayload)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    // The share token is a bearer credential and the failing URL contains
    // it, so scrub before logging.
    console.error(
      "[share-pdf] render failed:",
      redactShareToken(error instanceof Error ? error.message : String(error ?? ""), share.token),
    );
    if (isPromiseTimeoutError(error)) {
      await recordPdfJob(mapPdfErrorOutcome("pdf_render_timeout"));
      return pdfErrorResponse(
        504,
        "pdf_render_timeout",
        "The report render timed out. Try again shortly.",
        prefersHtml,
      );
    }
    // Truthful attribution: a provider-side 429/rate-limit during the real
    // render attempt is recorded as `rate_limited`, never as a generic
    // failure. The customer-visible response stays unchanged.
    const renderOutcome = isRateLimitedRenderError(error)
      ? "rate_limited"
      : mapPdfErrorOutcome("pdf_render_failed");
    await recordPdfJob(renderOutcome);
    return pdfErrorResponse(
      502,
      "pdf_render_failed",
      "PDF rendering failed. Try again shortly.",
      prefersHtml,
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function renderReportPdf(browser: PdfBrowser, renderUrl: string) {
  const { installPublicBrowserRequestGuard } = await import("~/lib/browser-run.server");
  const page = await browser.newPage();
  await installPublicBrowserRequestGuard(page);
  await page.goto(renderUrl, {
    waitUntil: "networkidle2",
    timeout: PDF_NAVIGATION_TIMEOUT_MS,
  });
  await page.waitForSelector(PDF_REPORT_ROOT_SELECTOR, {
    timeout: PDF_REPORT_ROOT_TIMEOUT_MS,
  });

  return page.pdf({
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
}

// Only server-configured vars may shape the render target; forwarded headers
// and the request URL are client-controlled and must never reach page.goto.
function resolveConfiguredOrigin(env: AppEnv) {
  const configured = (env.APP_ORIGIN ?? env.BETTER_AUTH_URL ?? "").trim();
  if (!configured) {
    return null;
  }

  try {
    const parsed = new URL(configured);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

async function readBrowserLimits(binding: NonNullable<AppEnv["BROWSER"]>) {
  try {
    const limits = (await promiseWithTimeout(
      puppeteer.limits(binding),
      PDF_CAPACITY_LOOKUP_TIMEOUT_MS,
      "Browser Run limits lookup timed out.",
    )) as unknown;
    if (!isBrowserRunLimits(limits)) {
      return null;
    }

    return limits;
  } catch {
    return null;
  }
}

function isBrowserRunLimits(value: unknown): value is BrowserRunLimits {
  if (!value || typeof value !== "object") {
    return false;
  }

  const limits = value as Partial<BrowserRunLimits>;
  return (
    typeof limits.allowedBrowserAcquisitions === "number" &&
    Number.isInteger(limits.allowedBrowserAcquisitions) &&
    limits.allowedBrowserAcquisitions >= 0 &&
    typeof limits.timeUntilNextAllowedBrowserAcquisition === "number" &&
    Number.isFinite(limits.timeUntilNextAllowedBrowserAcquisition) &&
    limits.timeUntilNextAllowedBrowserAcquisition >= 0
  );
}

function normalizeRetryAfterSeconds(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(value / 1000));
}

export function reportPdfFilename(snapshotPayload: Record<string, unknown> | null) {
  const title = snapshotPayload && typeof snapshotPayload.title === "string"
    ? snapshotPayload.title
    : "";
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

  return `${slug || "shared-report"}.pdf`;
}

export async function reportPdfContentFingerprint(
  snapshotPayload: Record<string, unknown> | null,
) {
  const content = snapshotPayload ? { ...snapshotPayload } : snapshotPayload;
  if (content) {
    delete content.generatedAt;
    delete content.token;
    delete content.shareToken;
  }
  const canonical = JSON.stringify(canonicalizePdfValue(content));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalizePdfValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizePdfValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, canonicalizePdfValue(nested)]),
    );
  }
  return value;
}

function redactShareToken(message: string, token: string) {
  return token ? message.split(token).join("<share-token>") : message;
}

// Name-based so it also matches PromiseTimeoutError instances constructed in
// a different module-registry epoch (vitest resetModules).
function isPromiseTimeoutError(error: unknown) {
  return error instanceof Error && error.name === "PromiseTimeoutError";
}

/**
 * A real render attempt that hits a provider 429/rate limit (Browser Run
 * launch, navigation, or CDP) is attributed as `rate_limited`, matching the
 * discovery contract's 429 → rate_limited mapping. Message-based so it also
 * matches provider errors from any module-registry epoch.
 */
function isRateLimitedRenderError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return message.includes("429") || message.includes("rate limit");
}

// GET /share/:token/pdf is reached both by real browser navigations (which send
// `Accept: text/html`) and by API/programmatic callers. Serving raw JSON to a
// browser dumps `{"error":...}` on screen; serve a branded HTML page instead and
// keep JSON for API/Accept: application/json callers.
function requestPrefersHtml(request: Request): boolean {
  return /text\/html/i.test(request.headers.get("accept") ?? "");
}

function pdfErrorResponse(
  status: number,
  error: string,
  message: string,
  prefersHtml: boolean,
  retryAfterSeconds?: number,
) {
  const baseHeaders: Record<string, string> = {
    "cache-control": "no-store",
    ...(retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {}),
  };
  if (prefersHtml) {
    return new Response(renderPdfErrorHtml(error, message), {
      status,
      headers: { ...baseHeaders, "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { ...baseHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

/** Honest, per-kind copy (voice rule 6) for the branded HTML error page. */
function pdfErrorCopy(error: string, fallback: string): { heading: string; body: string } {
  switch (error) {
    case "not_found":
      return {
        heading: "This report isn't available anymore",
        body: "The link may have expired, been turned off, or never existed. Ask whoever shared it for a fresh link.",
      };
    case "pdf_unavailable":
      return {
        heading: "This link can't be exported as a PDF",
        body: "PDF export is only available for shared report snapshots. Open the report link in your browser and use its print option instead.",
      };
    case "evidence_not_ready":
      return {
        heading: "This report needs a fresh review first",
        body: "The owner has to review the current evidence before it can be exported. Check back once they've refreshed it.",
      };
    case "plan_gated":
      return {
        heading: "PDF export isn't on this plan",
        body: "The report owner's plan doesn't include PDF export. You can still open the report link in your browser and print it.",
      };
    case "pdf_unconfigured":
    case "capacity_unavailable":
    case "capacity_exhausted":
      return {
        heading: "PDF rendering is busy right now",
        body: "We couldn't render the PDF this moment. Try again in a few minutes, or open the report link in your browser and use its print option.",
      };
    case "pdf_too_large":
      return {
        heading: "This report is too large to export",
        body: "The rendered PDF went over our size limit. Open the report link in your browser and use its print option instead.",
      };
    case "pdf_render_timeout":
    case "pdf_render_failed":
      return {
        heading: "The PDF didn't finish rendering",
        body: "Something went wrong on our side while building the PDF. Try again shortly, or open the report link in your browser and print it.",
      };
    default:
      return { heading: "This report can't be exported right now", body: fallback };
  }
}

function renderPdfErrorHtml(error: string, message: string) {
  const copy = pdfErrorCopy(error, message);
  const heading = escapePdfHtml(copy.heading);
  const body = escapePdfHtml(copy.body);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${heading} · Five to Nine</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background-color: #f6f5f1; color: #101828; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 24px; }
  .card { width: 100%; max-width: 440px; background-color: #ffffff; border: 1px solid #e4e2db; border-radius: 16px; padding: 32px; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04); }
  .kicker { margin: 0 0 20px; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #98a2b3; font-weight: 700; }
  h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.25; color: #101828; }
  p { margin: 0 0 20px; color: #475467; font-size: 15px; line-height: 1.5; }
  a { color: #101828; font-weight: 600; }
  .foot { margin: 0; font-size: 13px; color: #98a2b3; }
</style>
</head>
<body>
  <main class="card">
    <p class="kicker">Five to Nine</p>
    <h1>${heading}</h1>
    <p>${body}</p>
    <p class="foot">Need a hand? Email <a href="${escapePdfHtml(SUPPORT_MAILTO)}">${escapePdfHtml(SUPPORT_EMAIL)}</a>.</p>
  </main>
</body>
</html>`;
}

function escapePdfHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
