import puppeteer from "@cloudflare/puppeteer";

import {
  base64DecodedLengthExceeds,
  readResponseTextWithinLimit,
  utf8ByteLength,
} from "~/lib/bounded-response.server";
import type { AppEnv } from "~/lib/env.server";
import {
  extractLandingPageSignals,
  LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
} from "~/lib/landing-page-signals.server";
import { normalizeHeadline } from "~/lib/normalize";
import { normalizePublicHttpUrl, resolvePublicHttpUrl } from "~/lib/public-url.server";
import type { LandingPageSnapshotData, ProofDeviceProfile, ProofRenderMode } from "~/lib/types";

const TITLE_REGEX = /<title[^>]*>([^<]+)<\/title>/i;
const OG_TITLE_REGEX =
  /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const H1_REGEX = /<h1[^>]*>(.*?)<\/h1>/i;

const MOBILE_RENDER_MODE: ProofRenderMode = "mobile";
const MOBILE_DEVICE_PROFILE: ProofDeviceProfile = "mobile_default";
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
): Promise<LandingPageSnapshotData | null> {
  const publicUrl = await resolvePublicHttpUrl(url);
  if (!env.BROWSER || !publicUrl) {
    return null;
  }

  const targetUrl = publicUrl.toString();
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await installPublicBrowserRequestGuard(page);
    await page.setUserAgent(MOBILE_USER_AGENT);
    await page.setViewport(MOBILE_VIEWPORT);
    await page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });

    const html = await page.content();
    if (utf8ByteLength(html) > MAX_RENDERED_HTML_BYTES) {
      return null;
    }
    const screenshot = await page.screenshot({
      type: "jpeg",
      quality: 85,
      fullPage: false,
    });
    const canonicalUrl = (await resolvePublicHttpUrl(page.url() || targetUrl))?.toString();
    if (!canonicalUrl) {
      return null;
    }

    return buildBrowserRenderedSnapshot(env, {
      url: targetUrl,
      canonicalUrl,
      html,
      screenshot,
      provider: "cloudflare_browser_run",
    });
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function installPublicBrowserRequestGuard(page: BrowserRunPage) {
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

export async function captureRenderedLandingPageSnapshot(
  env: AppEnv,
  url: string,
): Promise<LandingPageSnapshotData | null> {
  return (
    (await captureBrowserRunSnapshot(env, url)) ??
    (await captureBrowserlessProofSnapshot(env, url))
  );
}

export async function captureBrowserlessProofSnapshot(
  env: AppEnv,
  url: string,
): Promise<LandingPageSnapshotData | null> {
  const publicUrl = await resolvePublicHttpUrl(url);
  if (!env.BROWSERLESS_TOKEN?.trim() || !publicUrl || !isBrowserlessProofOriginAllowed(env, publicUrl)) {
    return null;
  }

  const targetUrl = publicUrl.toString();
  try {
    const response = await fetch(buildBrowserlessBqlEndpoint(env), {
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
    });
    const responseText = await readResponseTextWithinLimit(response, MAX_BROWSERLESS_RESPONSE_BYTES);
    if (!responseText) {
      return null;
    }
    const payload = (JSON.parse(responseText) as
      | {
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
        }
      | null) ?? null;

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
      !response.ok ||
      !html ||
      !screenshotBase64 ||
      utf8ByteLength(html) > MAX_RENDERED_HTML_BYTES ||
      base64DecodedLengthExceeds(screenshotBase64, MAX_RENDERED_SCREENSHOT_BYTES) ||
      !canonicalUrl ||
      publicDocumentUrls.some((requestUrl) => !requestUrl)
    ) {
      return null;
    }

    return buildBrowserRenderedSnapshot(env, {
      url: targetUrl,
      canonicalUrl,
      html,
      screenshot: decodeBase64ToUint8Array(screenshotBase64),
      provider: "browserless_bql",
    });
  } catch {
    return null;
  }
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

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.BROWSER_RUN_ACCOUNT_ID.trim()}/browser-rendering/content?cacheTTL=0`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.BROWSER_RUN_API_TOKEN.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...options, url: publicUrl.toString() }),
    },
  );
  const payload = (await response.json().catch(() => null)) as BrowserRunQuickActionEnvelope<string> | null;

  if (!response.ok || !payload?.success || typeof payload.result !== "string") {
    throw buildBrowserRunQuickActionError(response, payload);
  }

  return {
    browserMsUsed: parseBrowserMsUsedHeader(response.headers.get("X-Browser-Ms-Used")),
    content: payload.result,
  };
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

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.BROWSER_RUN_ACCOUNT_ID.trim()}/browser-rendering/scrape?cacheTTL=0`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.BROWSER_RUN_API_TOKEN.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...options, url: publicUrl.toString() }),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | BrowserRunQuickActionEnvelope<BrowserRunQuickActionScrapeResult[]>
    | null;

  if (!response.ok || !payload?.success || !Array.isArray(payload.result)) {
    throw buildBrowserRunQuickActionError(response, payload);
  }

  return {
    browserMsUsed: parseBrowserMsUsedHeader(response.headers.get("X-Browser-Ms-Used")),
    elements: payload.result.flatMap((entry) => normalizeScrapeResults(entry.results)),
  };
}

function buildBrowserRenderedSnapshot(
  env: AppEnv,
  input: {
    url: string;
    canonicalUrl: string;
    html: string;
    provider: string;
    screenshot: Uint8Array | ArrayBuffer | Buffer;
  },
): Promise<LandingPageSnapshotData | null> {
  const html = input.html;
  const screenshotBytes = toUint8Array(input.screenshot);
  if (
    utf8ByteLength(html) > MAX_RENDERED_HTML_BYTES ||
    screenshotBytes.byteLength > MAX_RENDERED_SCREENSHOT_BYTES
  ) {
    return Promise.resolve(null);
  }

  const signals = extractLandingPageSignals(html);
  const headline = resolveHeadline(html);
  const normalized = normalizeHeadline(headline);

  return persistBrowserArtifacts(env, input.canonicalUrl, html, screenshotBytes).then(
    ({ htmlArtifactKey, screenshotArtifactKey }) => ({
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
      artifactKey: htmlArtifactKey,
      metadata: {
        htmlArtifactKey,
        screenshotArtifactKey,
        renderMode: MOBILE_RENDER_MODE,
        deviceProfile: MOBILE_DEVICE_PROFILE,
        renderProvider: input.provider,
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
    }),
  );
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
  screenshot: Uint8Array,
) {
  if (!env.LANDING_PAGE_ARTIFACTS) {
    return {
      htmlArtifactKey: null,
      screenshotArtifactKey: null,
    };
  }

  const baseKey = `landing-pages/${new Date().toISOString().slice(0, 10)}/${crypto
    .randomUUID()
    .replaceAll("-", "")}`;
  const htmlArtifactKey = `${baseKey}.html`;
  const screenshotArtifactKey = `${baseKey}.jpeg`;

  await env.LANDING_PAGE_ARTIFACTS.put(htmlArtifactKey, html, {
    httpMetadata: {
      contentType: "text/html; charset=utf-8",
    },
    customMetadata: {
      sourceUrl: canonicalUrl,
      renderMode: MOBILE_RENDER_MODE,
    },
  });
  await env.LANDING_PAGE_ARTIFACTS.put(screenshotArtifactKey, toUint8Array(screenshot), {
    httpMetadata: {
      contentType: "image/jpeg",
    },
    customMetadata: {
      sourceUrl: canonicalUrl,
      renderMode: MOBILE_RENDER_MODE,
      deviceProfile: MOBILE_DEVICE_PROFILE,
    },
  });

  return {
    htmlArtifactKey,
    screenshotArtifactKey,
  };
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

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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
