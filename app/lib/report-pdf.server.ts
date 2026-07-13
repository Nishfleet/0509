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

import type { AppEnv } from "~/lib/env.server";
import { promiseWithTimeout } from "~/lib/fetch-timeout.server";
import { canUsePlanFeature } from "~/lib/plan-entitlements";

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
  const { enforceSharePdfRateLimit, enforceSharePdfDailyCap } = await import(
    "~/lib/rate-limit.server"
  );

  // Per-IP burst gate first so invalid-token spam is also throttled.
  const ipLimited = await enforceSharePdfRateLimit(request, env, ctx);
  if (ipLimited) {
    return ipLimited;
  }

  if (!token.trim()) {
    return pdfErrorResponse(404, "not_found", "This share link does not exist.");
  }

  const { getShareLink } = await import("~/lib/data.server");
  const share = await getShareLink(env, token);
  if (!share) {
    return pdfErrorResponse(404, "not_found", "This share link does not exist.");
  }

  // Snapshots are immutable, so the PDF is truthful. Live shares re-query on
  // every view and could drift between render and read — refuse honestly.
  if (!share.isSnapshot || share.resourceType !== "report") {
    return pdfErrorResponse(
      404,
      "pdf_unavailable",
      "PDF export is only available for report snapshot shares.",
    );
  }

  const { getUserPlan } = await import("~/lib/plan.server");
  const sharerPlan = await getUserPlan(env, share.userId);
  if (!canUsePlanFeature(sharerPlan, "pdf_reports")) {
    return pdfErrorResponse(
      403,
      "plan_gated",
      "PDF export is not included in this report owner's plan.",
    );
  }

  const origin = resolveConfiguredOrigin(env);
  if (!env.BROWSER || !origin) {
    return pdfErrorResponse(
      503,
      "pdf_unconfigured",
      "PDF rendering is not configured. Use your browser's print option instead.",
    );
  }

  const capacity = await readBrowserLimits(env.BROWSER);
  if (!capacity) {
    return pdfErrorResponse(
      503,
      "capacity_unavailable",
      "PDF rendering capacity could not be verified. Try again shortly.",
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
      retryAfterSeconds,
    );
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
      return pdfErrorResponse(
        502,
        "pdf_too_large",
        "The rendered PDF exceeded the size limit. Use your browser's print option instead.",
      );
    }

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
      return pdfErrorResponse(
        504,
        "pdf_render_timeout",
        "The report render timed out. Try again shortly.",
      );
    }
    return pdfErrorResponse(
      502,
      "pdf_render_failed",
      "PDF rendering failed. Try again shortly.",
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

function redactShareToken(message: string, token: string) {
  return token ? message.split(token).join("<share-token>") : message;
}

// Name-based so it also matches PromiseTimeoutError instances constructed in
// a different module-registry epoch (vitest resetModules).
function isPromiseTimeoutError(error: unknown) {
  return error instanceof Error && error.name === "PromiseTimeoutError";
}

function pdfErrorResponse(
  status: number,
  error: string,
  message: string,
  retryAfterSeconds?: number,
) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {}),
    },
  });
}
