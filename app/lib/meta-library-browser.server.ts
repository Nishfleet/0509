import puppeteer from "@cloudflare/puppeteer";

import { inferDestinationType, inferLanguageLabel, withStructuredAnalysis } from "~/lib/analysis.server";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import {
  type BrowserRunQuickActionScrapeElement,
  BrowserRunQuickActionError,
  captureBrowserRunQuickActionContent,
  captureBrowserRunQuickActionScrape,
  hasBrowserRunQuickActions,
} from "~/lib/browser-run.server";
import { isoFromCountryName } from "~/lib/countries";
import { findStartedRunningLine, parseStartedRunningDate } from "~/lib/meta-ad-dates";
import type { AppEnv, BrowserBinding } from "~/lib/env.server";
import { fetchWithTimeout, promiseWithTimeout } from "~/lib/fetch-timeout.server";
import type {
  AdRecord,
  DiscoveryFailureClass,
  NormalizedSavedQuery,
  SearchResponse,
} from "~/lib/types";

const AD_LIBRARY_RESULT_SELECTOR =
  'a[href*="/ads/library/?id="], a[href*="facebook.com/ads/library/?id="]';
const BROWSER_SESSION_KEEP_ALIVE_MS = 3 * 60 * 1000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const PAGE_READY_TIMEOUT_MS = 8_000;
const MOBILE_VIEWPORT = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const QUICK_ACTION_RUNNER_SCRIPT_ID = "__0509_ad_library_extractor";
const QUICK_ACTION_EXTRACTION_SCRIPT_ID = "__0509_ad_library_payload";
const QUICK_ACTION_WAIT_FOR_TIMEOUT_MS = 1_000;
const QUICK_ACTION_SCRAPE_WAIT_FOR_TIMEOUT_MS = 2_000;
const BROWSERLESS_RENDER_WAIT_MS = 5_000;
const BROWSERLESS_EMPTY_RESULT_MAX_ATTEMPTS = 2;
const BROWSERLESS_META_FETCH_TIMEOUT_MS = 30_000;
const BROWSERLESS_META_JSON_MAX_BYTES = 6_000_000;
const BROWSER_RUN_ACQUIRE_TIMEOUT_MS = 10_000;
const BROWSERLESS_BQL_MUTATION = `
mutation MetaLibraryLiveFallback($url: String!, $userAgent: String!) {
  userAgent(userAgent: $userAgent) {
    time
  }
  viewport(width: 390, height: 844, deviceScaleFactor: 2, mobile: true) {
    width
  }
  goto(url: $url) {
    status
  }
  waitForTimeout(time: ${BROWSERLESS_RENDER_WAIT_MS}) {
    time
  }
  html {
    html
  }
}
`.trim();

interface ExtractedAdCard {
  libraryId: string;
  advertiser: string | null;
  body: string | null;
  previewHeadline: string | null;
  previewSubhead: string | null;
  cta: string | null;
  adSnapshotUrl: string | null;
  landingPageUrl: string | null;
  platforms: string[];
  active: boolean;
  /** Raw "Started running on <date>" card line; parsed server-side into firstSeenAt. */
  startedRunning?: string | null;
}

interface BrowserRunSession {
  sessionId: string;
  startTime: number;
  connectionId?: string;
}

interface BrowserRunLimits {
  allowedBrowserAcquisitions: number;
  timeUntilNextAllowedBrowserAcquisition: number;
}

interface QuickActionExtractionPayload {
  cards: ExtractedAdCard[];
  loginWall: boolean;
  noResults: boolean;
  rateLimited: boolean;
}

type BrowserInstance = Awaited<ReturnType<typeof puppeteer.launch>>;
type BrowserContext = Awaited<ReturnType<BrowserInstance["createBrowserContext"]>>;
type BrowserPage = Awaited<ReturnType<BrowserContext["newPage"]>>;

export class CommercialDiscoveryError extends Error {
  public readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    public readonly failureClass: DiscoveryFailureClass,
    options: {
      retryAfterSeconds?: number | null;
    } = {},
  ) {
    super(message);
    this.name = "CommercialDiscoveryError";
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export async function searchMetaLibraryByBrowser(
  env: AppEnv,
  query: NormalizedSavedQuery,
): Promise<SearchResponse> {
  const browserBinding = env.BROWSER;

  if (!browserBinding && !hasBrowserRunQuickActions(env) && !hasBrowserlessBql(env)) {
    throw new CommercialDiscoveryError(
      "Browser Run is not configured for commercial discovery.",
      "browser_unavailable",
    );
  }

  try {
    if (!browserBinding) {
      return await searchMetaLibraryByQuickActions(env, query);
    }

    try {
      return await searchMetaLibraryViaSessions(env, browserBinding, query);
    } catch (error) {
      const normalizedError = normalizeCommercialDiscoveryError(error);
      if (!shouldUseQuickActionsFallback(env, normalizedError)) {
        throw normalizedError;
      }

      return await searchMetaLibraryByQuickActions(env, query);
    }
  } catch (error) {
    const normalizedError = normalizeCommercialDiscoveryError(error);
    if (shouldUseBrowserlessFallback(env, normalizedError)) {
      return searchMetaLibraryByBrowserless(env, query);
    }

    throw normalizedError;
  }
}

async function searchMetaLibraryViaSessions(
  env: AppEnv,
  browserBinding: BrowserBinding,
  query: NormalizedSavedQuery,
): Promise<SearchResponse> {
  let browser: BrowserInstance | null = null;
  let browserContext: BrowserContext | null = null;
  let page: BrowserPage | null = null;
  const reuseSession = browserSessionReuseEnabled(env);

  try {
    browser = await acquireBrowser(browserBinding, { reuseSession });
    browserContext = await browser.createBrowserContext();
    page = await browserContext.newPage();
    await page.setUserAgent(MOBILE_USER_AGENT);
    await page.setViewport(MOBILE_VIEWPORT);
    await page.goto(buildSearchUrl(query), {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await waitForLibrarySurface(page);

    const extraction = await page.evaluate(() => {
      const normalizeText = (value: string | null | undefined) =>
        (value ?? "")
          .replace(/\u00a0/g, " ")
          .split("\n")
          .map((part) => part.trim())
          .filter(Boolean)
          .join("\n")
          .trim();

      const seen = new Set<string>();
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/ads/library/?id="], a[href*="facebook.com/ads/library/?id="]',
        ),
      );

      const cards = anchors
        .map((anchor) => {
          const href = anchor.href || anchor.getAttribute("href") || "";
          const idMatch = href.match(/[?&]id=(\d+)/);
          const libraryId = idMatch?.[1];
          if (!libraryId || seen.has(libraryId)) {
            return null;
          }
          seen.add(libraryId);

          const card =
            anchor.closest<HTMLElement>('[role="article"]') ||
            anchor.closest<HTMLElement>("article") ||
            anchor.closest<HTMLElement>("[data-ad-preview]") ||
            anchor.parentElement;
          const links = Array.from(card?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []);
          const externalLink =
            links
              .map((link) => link.href)
              .find(
                (candidate) =>
                  /^https?:/i.test(candidate) &&
                  !/facebook\.com/i.test(candidate) &&
                  !/l\.facebook\.com/i.test(candidate),
              ) ?? null;

          const advertiser =
            card?.querySelector<HTMLElement>("strong, h3, h4, [data-advertiser-name]")?.innerText ??
            null;
          const headline =
            card?.querySelector<HTMLElement>("h1, h2, h3, [data-headline]")?.innerText ?? null;
          const text = normalizeText(card?.innerText ?? anchor.innerText);
          const cta =
            card
              ?.querySelector<HTMLElement>(
                'button, [role="button"], [data-cta], a[aria-label*="Shop"], a[aria-label*="Learn"]',
              )
              ?.innerText ?? null;
          const platformTokens = [
            "Instagram",
            "Facebook",
            "Messenger",
            "WhatsApp",
            "Audience Network",
            "Threads",
          ];
          const platforms = platformTokens.filter((token) => text.includes(token));
          const startedRunning =
            text
              .split("\n")
              .map((line) => line.trim())
              .find((line) => /^started running on\b/i.test(line)) ?? null;

          return {
            libraryId,
            advertiser: normalizeText(advertiser),
            body: text,
            previewHeadline: normalizeText(headline),
            previewSubhead: null,
            cta: normalizeText(cta),
            adSnapshotUrl: new URL(href, location.origin).toString(),
            landingPageUrl: externalLink,
            platforms,
            // Status is a standalone "Inactive" line on the card; matching the
            // word anywhere flags ads whose creative copy merely contains it.
            active: !text.split("\n").some((line) => /^inactive$/i.test(line.trim())),
            startedRunning,
          };
        })
        .filter(Boolean);

      const pageText = document.body?.innerText ?? "";
      const lowerPageText = pageText.toLowerCase();

      return {
        cards,
        pageText,
        loginWall:
          /log in|login|sign in|sign into/.test(lowerPageText) &&
          lowerPageText.includes("facebook"),
        noResults: false,
        rateLimited:
          lowerPageText.includes("rate limit") ||
          lowerPageText.includes("too many requests") ||
          lowerPageText.includes("try again later"),
      };
    });

    const normalizedExtraction = Array.isArray(extraction)
      ? {
          cards: extraction as ExtractedAdCard[],
          pageText: "",
          loginWall: false,
          noResults: false,
          rateLimited: false,
        }
      : extraction as {
          cards: ExtractedAdCard[];
          pageText: string;
          loginWall: boolean;
          noResults: boolean;
          rateLimited: boolean;
        };
    const extractedCards = normalizedExtraction.cards.length > 0
      ? normalizedExtraction.cards
      : extractTextCardsFromVisibleText(normalizedExtraction.pageText);
    const noResults =
      normalizedExtraction.noResults ||
      hasNoResultsSignal(normalizedExtraction.pageText);

    if (extractedCards.length === 0) {
      if (normalizedExtraction.loginWall) {
        throw new CommercialDiscoveryError(
          "Meta Ad Library returned a login wall.",
          "login_wall",
        );
      }

      if (normalizedExtraction.rateLimited) {
        throw new CommercialDiscoveryError(
          "Meta Ad Library is temporarily rate limited.",
          "rate_limited",
        );
      }

      if (noResults) {
        return emptyMetaLibraryResponse();
      }

      throw new CommercialDiscoveryError(
        "Meta Ad Library returned no extractable ad cards.",
        "empty_result",
      );
    }

    const ads = extractedCards.map((card) =>
      normalizeExtractedCard(card, query),
    );

    return {
      ads,
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
    };
  } finally {
    await page?.close().catch(() => undefined);
    await browserContext?.close().catch(() => undefined);
    if (reuseSession) {
      await browser?.disconnect().catch(() => undefined);
    } else {
      await browser?.close().catch(() => undefined);
    }
  }
}

async function searchMetaLibraryByQuickActions(
  env: AppEnv,
  query: NormalizedSavedQuery,
): Promise<SearchResponse> {
  try {
    const extracted = await extractMetaLibraryByQuickActions(env, query);
    if (extracted.cards.length === 0) {
      if (extracted.loginWall) {
        throw new CommercialDiscoveryError(
          "Meta Ad Library returned a login wall.",
          "login_wall",
        );
      }

      if (extracted.rateLimited) {
        throw new CommercialDiscoveryError(
          "Meta Ad Library is temporarily rate limited.",
          "rate_limited",
        );
      }

      if (extracted.noResults) {
        return emptyMetaLibraryResponse();
      }

      throw new CommercialDiscoveryError(
        "Meta Ad Library returned no extractable ad cards.",
        "empty_result",
      );
    }

    return {
      ads: extracted.cards.map((card) => normalizeExtractedCard(card, query)),
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
    };
  } catch (error) {
    throw normalizeCommercialDiscoveryError(error);
  }
}

async function extractMetaLibraryByQuickActions(
  env: AppEnv,
  query: NormalizedSavedQuery,
): Promise<QuickActionExtractionPayload> {
  const url = buildSearchUrl(query);

  try {
    const quickActionContent = await captureBrowserRunQuickActionContent(env, {
      url,
      actionTimeout: NAVIGATION_TIMEOUT_MS,
      addScriptTag: [
        {
          id: QUICK_ACTION_RUNNER_SCRIPT_ID,
          type: "application/javascript",
          content: buildQuickActionExtractionScript(),
        },
      ],
      bestAttempt: true,
      gotoOptions: {
        timeout: NAVIGATION_TIMEOUT_MS,
        waitUntil: "networkidle2",
      },
      userAgent: MOBILE_USER_AGENT,
      viewport: MOBILE_VIEWPORT,
      waitForSelector: {
        selector: AD_LIBRARY_RESULT_SELECTOR,
        timeout: PAGE_READY_TIMEOUT_MS,
      },
      waitForTimeout: QUICK_ACTION_WAIT_FOR_TIMEOUT_MS,
    });

    if (!quickActionContent) {
      throw new CommercialDiscoveryError(
        "Browser Run Quick Actions are not configured for commercial discovery.",
        "browser_unavailable",
      );
    }

    const extracted = parseQuickActionExtractionPayload(quickActionContent.content);
    if (extracted.cards.length === 0) {
      if (!extracted.loginWall && !extracted.rateLimited && !extracted.noResults) {
        return scrapeMetaLibraryByQuickActions(env, url);
      }
    }

    return extracted;
  } catch (error) {
    const normalizedError = normalizeCommercialDiscoveryError(error);
    if (!shouldUseQuickActionScrapeFallback(normalizedError)) {
      throw normalizedError;
    }

    return scrapeMetaLibraryByQuickActions(env, url);
  }
}

function browserSessionReuseEnabled(env: AppEnv) {
  return env.BROWSER_RUN_SESSION_REUSE?.trim() === "1";
}

async function acquireBrowser(
  browserBinding: BrowserBinding,
  options: { reuseSession: boolean },
) {
  if (options.reuseSession) {
    const reusableBrowser = await connectToReusableBrowser(browserBinding);
    if (reusableBrowser) {
      return reusableBrowser;
    }
  }

  const limits = await readBrowserLimits(browserBinding);
  if (limits && limits.allowedBrowserAcquisitions < 1) {
    const retryAfterSeconds = normalizeRetryAfterSeconds(
      limits.timeUntilNextAllowedBrowserAcquisition,
    );
    throw new CommercialDiscoveryError(
      buildRateLimitMessage(limits.timeUntilNextAllowedBrowserAcquisition),
      "rate_limited",
      {
        retryAfterSeconds,
      },
    );
  }

  const launchPromise = options.reuseSession
    ? puppeteer.launch(browserBinding, {
        keep_alive: BROWSER_SESSION_KEEP_ALIVE_MS,
      })
    : puppeteer.launch(browserBinding);

  return promiseWithTimeout(
    launchPromise,
    BROWSER_RUN_ACQUIRE_TIMEOUT_MS,
    "Browser Run launch timed out.",
    (lateBrowser) => lateBrowser.close(),
  );
}

async function connectToReusableBrowser(browserBinding: BrowserBinding) {
  const sessions = await listReusableSessions(browserBinding);

  for (const session of sessions) {
    try {
      return await promiseWithTimeout(
        puppeteer.connect(browserBinding, session.sessionId),
        BROWSER_RUN_ACQUIRE_TIMEOUT_MS,
        "Browser Run connect timed out.",
        (lateBrowser) => lateBrowser.disconnect(),
      );
    } catch {
      continue;
    }
  }

  return null;
}

async function listReusableSessions(browserBinding: BrowserBinding) {
  try {
    const sessions = await promiseWithTimeout(
      puppeteer.sessions(browserBinding),
      BROWSER_RUN_ACQUIRE_TIMEOUT_MS,
      "Browser Run sessions lookup timed out.",
    );
    return [...(sessions as BrowserRunSession[])]
      .filter((session) => !session.connectionId)
      .sort((left, right) => right.startTime - left.startTime);
  } catch {
    return [];
  }
}

async function readBrowserLimits(browserBinding: BrowserBinding) {
  try {
    return (await promiseWithTimeout(
      puppeteer.limits(browserBinding),
      BROWSER_RUN_ACQUIRE_TIMEOUT_MS,
      "Browser Run limits lookup timed out.",
    )) as BrowserRunLimits;
  } catch {
    return null;
  }
}

async function waitForLibrarySurface(page: BrowserPage) {
  await page
    .waitForFunction(
      (selector) => {
        const bodyText = (document.body?.innerText ?? "").toLowerCase();
        const hasTerminalEmptyState =
          bodyText.includes("no ads found") ||
          bodyText.includes("no ads match") ||
          bodyText.includes("no results") ||
          bodyText.includes("couldn't find any ads");
        const hasLoginWall =
          /log in|login|sign in|sign into/.test(bodyText) && bodyText.includes("facebook");
        const hasRateLimit =
          bodyText.includes("rate limit") ||
          bodyText.includes("too many requests") ||
          bodyText.includes("try again later");

        return (
          Boolean(document.querySelector(selector)) ||
          hasTerminalEmptyState ||
          hasLoginWall ||
          hasRateLimit
        );
      },
      {
        timeout: PAGE_READY_TIMEOUT_MS,
      },
      AD_LIBRARY_RESULT_SELECTOR,
    )
    .catch(() => undefined);
}

function shouldUseQuickActionsFallback(
  env: AppEnv,
  error: CommercialDiscoveryError,
) {
  if (!hasBrowserRunQuickActions(env)) {
    return false;
  }

  return [
    "browser_unavailable",
    "browser_launch_failed",
    "login_wall",
    "rate_limited",
    "timeout",
    "selector_drift",
    "empty_result",
  ].includes(error.failureClass);
}

function shouldUseQuickActionScrapeFallback(error: CommercialDiscoveryError) {
  return ["selector_drift", "empty_result"].includes(error.failureClass);
}

function shouldUseBrowserlessFallback(env: AppEnv, error: CommercialDiscoveryError) {
  return (
    hasBrowserlessBql(env) &&
    ["browser_unavailable", "selector_drift", "empty_result", "timeout", "login_wall"].includes(error.failureClass)
  );
}

function hasBrowserlessBql(env: AppEnv) {
  return Boolean(env.BROWSERLESS_TOKEN?.trim());
}

function normalizeCommercialDiscoveryError(error: unknown) {
  if (error instanceof CommercialDiscoveryError) {
    return error;
  }

  if (error instanceof BrowserRunQuickActionError) {
    if (error.status === 429) {
      return new CommercialDiscoveryError(error.message, "rate_limited", {
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    if (error.status === 408) {
      return new CommercialDiscoveryError(error.message, "timeout");
    }
    if (error.status === 401 || error.status === 403) {
      return new CommercialDiscoveryError(
        "Browser Run Quick Actions are not authorized for commercial discovery.",
        "browser_unavailable",
      );
    }
  }

  const message = error instanceof Error ? error.message : "Browser discovery failed.";
  const normalizedMessage = message.toLowerCase();
  const failureClass: DiscoveryFailureClass = normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("429")
    ? "rate_limited"
    : normalizedMessage.includes("timeout") || normalizedMessage.includes("timed out")
      ? "timeout"
      : "browser_launch_failed";
  return new CommercialDiscoveryError(message, failureClass);
}

async function searchMetaLibraryByBrowserless(
  env: AppEnv,
  query: NormalizedSavedQuery,
): Promise<SearchResponse> {
  let lastEmptyResult: CommercialDiscoveryError | null = null;

  for (let attempt = 1; attempt <= BROWSERLESS_EMPTY_RESULT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await searchMetaLibraryByBrowserlessOnce(env, query);
    } catch (error) {
      const normalizedError = normalizeCommercialDiscoveryError(error);
      if (
        normalizedError.failureClass === "empty_result" &&
        attempt < BROWSERLESS_EMPTY_RESULT_MAX_ATTEMPTS
      ) {
        lastEmptyResult = normalizedError;
        continue;
      }

      throw normalizedError;
    }
  }

  throw lastEmptyResult ?? new CommercialDiscoveryError(
    "Browserless returned no extractable Meta Ad Library cards.",
    "empty_result",
  );
}

async function searchMetaLibraryByBrowserlessOnce(
  env: AppEnv,
  query: NormalizedSavedQuery,
): Promise<SearchResponse> {
  const endpoint = buildBrowserlessBqlEndpoint(env);
  let response: Response;
  try {
    response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: BROWSERLESS_BQL_MUTATION,
          variables: {
            url: buildSearchUrl(query),
            userAgent: MOBILE_USER_AGENT,
          },
        }),
      },
      { timeoutMs: BROWSERLESS_META_FETCH_TIMEOUT_MS },
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw normalizeBrowserlessError(408, "Browserless timed out.");
    }
    throw error;
  }
  const payload = (await readResponseJsonWithinLimit(
    response,
    BROWSERLESS_META_JSON_MAX_BYTES,
  )) as
    | {
        data?: {
          html?: {
            html?: string;
          };
        };
        errors?: Array<{
          message?: string;
        }>;
        message?: string;
      }
    | null;

  if (!response.ok) {
    throw normalizeBrowserlessError(response.status, payload?.message ?? null);
  }

  if (!payload) {
    throw normalizeBrowserlessError(408, "Browserless timed out before returning a readable response.");
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const message = payload.errors.map((error) => error.message).filter(Boolean).join(" | ");
    throw normalizeBrowserlessError(response.status, message || "Browserless returned a GraphQL error.");
  }

  const html = payload?.data?.html?.html ?? "";
  const extracted = extractQuickActionPayloadFromRenderedHtml(html);
  if (extracted.cards.length === 0) {
    if (extracted.loginWall) {
      throw new CommercialDiscoveryError("Meta Ad Library returned a login wall.", "login_wall");
    }

    if (extracted.rateLimited) {
      throw new CommercialDiscoveryError("Meta Ad Library is temporarily rate limited.", "rate_limited");
    }

    if (extracted.noResults) {
      return emptyMetaLibraryResponse();
    }

    throw new CommercialDiscoveryError(
      "Browserless returned no extractable Meta Ad Library cards.",
      "empty_result",
    );
  }

  return {
    ads: extracted.cards.map((card) => normalizeExtractedCard(card, query)),
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
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

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeBrowserlessError(status: number, message: string | null) {
  const lower = (message ?? "").toLowerCase();
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return new CommercialDiscoveryError(
      message || "Browserless rate limited this request.",
      "rate_limited",
    );
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return new CommercialDiscoveryError(message || "Browserless timed out.", "timeout");
  }

  return new CommercialDiscoveryError(
    message || `Browserless request failed with status ${status}.`,
    "browser_launch_failed",
  );
}

function buildQuickActionExtractionScript() {
  return `
(() => {
  const renderedText = (element) => {
    if (!element) {
      return "";
    }
    return typeof element.innerText === "string" ? element.innerText : element.textContent ?? "";
  };
  const normalizeText = (value) =>
    (value ?? "")
      .replace(/\\u00a0/g, " ")
      .split("\\n")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\\n")
      .trim();

  const seen = new Set();
  const anchors = Array.from(document.querySelectorAll(${JSON.stringify(AD_LIBRARY_RESULT_SELECTOR)}));
  const cards = anchors
    .map((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) {
        return null;
      }

      const href = anchor.href || anchor.getAttribute("href") || "";
      const idMatch = href.match(/[?&]id=(\\d+)/);
      const libraryId = idMatch?.[1];
      if (!libraryId || seen.has(libraryId)) {
        return null;
      }
      seen.add(libraryId);

      const card =
        anchor.closest('[role="article"]') ||
        anchor.closest("article") ||
        anchor.closest("[data-ad-preview]") ||
        anchor.parentElement;
      const links = Array.from(card?.querySelectorAll('a[href]') ?? []);
      const externalLink =
        links
          .map((link) => (link instanceof HTMLAnchorElement ? link.href : link.getAttribute("href") || ""))
          .find(
            (candidate) =>
              /^https?:/i.test(candidate) &&
              !/facebook\\.com/i.test(candidate) &&
              !/l\\.facebook\\.com/i.test(candidate),
          ) ?? null;
      const advertiser = card?.querySelector("strong, h3, h4, [data-advertiser-name]")?.textContent ?? null;
      const headline = card?.querySelector("h1, h2, h3, [data-headline]")?.textContent ?? null;
      const text = normalizeText(renderedText(card) || renderedText(anchor));
      const cta =
        card
          ?.querySelector(
            'button, [role="button"], [data-cta], a[aria-label*="Shop"], a[aria-label*="Learn"]',
          )
          ?.textContent ?? null;
      const platformTokens = [
        "Instagram",
        "Facebook",
        "Messenger",
        "WhatsApp",
        "Audience Network",
        "Threads",
      ];
      const platforms = platformTokens.filter((token) => text.includes(token));
      const startedRunning =
        text
          .split("\\n")
          .map((line) => line.trim())
          .find((line) => /^started running on\\b/i.test(line)) ?? null;

      return {
        libraryId,
        advertiser: normalizeText(advertiser),
        body: text,
        previewHeadline: normalizeText(headline),
        previewSubhead: null,
        cta: normalizeText(cta),
        adSnapshotUrl: new URL(href, location.origin).toString(),
        landingPageUrl: externalLink,
        platforms,
        active: !text.split("\\n").some((line) => /^inactive$/i.test(line.trim())),
        startedRunning,
      };
    })
    .filter(Boolean);
  const pageText = (document.body?.innerText ?? "").toLowerCase();
  const payload = {
    cards,
    loginWall: /log in|login|sign in|sign into/.test(pageText) && pageText.includes("facebook"),
    noResults:
      pageText.includes("no ads found") ||
      pageText.includes("no ads match") ||
      pageText.includes("no results") ||
      /\\b0\\s+results?\\b/.test(pageText) ||
      /\\bno\\s+(ads?|results?)\\s+(match|matched|found|available)\\b/.test(pageText) ||
      /\\bcouldn.?t find any ads\\b/.test(pageText) ||
      /\\bcould not find any ads\\b/.test(pageText) ||
      /\\bwe (didn't|did not) find any results\\b/.test(pageText) ||
      /\\bthere are no ads\\b/.test(pageText),
    rateLimited:
      pageText.includes("rate limit") ||
      pageText.includes("too many requests") ||
      pageText.includes("try again later"),
  };
  let payloadScript = document.getElementById(${JSON.stringify(QUICK_ACTION_EXTRACTION_SCRIPT_ID)});
  if (!(payloadScript instanceof HTMLScriptElement)) {
    payloadScript = document.createElement("script");
    payloadScript.id = ${JSON.stringify(QUICK_ACTION_EXTRACTION_SCRIPT_ID)};
    payloadScript.type = "application/json";
    document.documentElement.appendChild(payloadScript);
  }
  payloadScript.textContent = JSON.stringify(payload).replace(/<\\//g, "<\\\\/");
})();
`;
}

function parseQuickActionExtractionPayload(content: string): QuickActionExtractionPayload {
  const markerIndex = [
    `id="${QUICK_ACTION_EXTRACTION_SCRIPT_ID}"`,
    `id='${QUICK_ACTION_EXTRACTION_SCRIPT_ID}'`,
  ]
    .map((marker) => content.indexOf(marker))
    .find((index) => index >= 0);
  const scriptStart = markerIndex !== undefined ? content.indexOf(">", markerIndex) : -1;
  const scriptEnd = scriptStart >= 0 ? content.indexOf("</script>", scriptStart) : -1;
  const payloadText =
    scriptStart >= 0 && scriptEnd > scriptStart
      ? content.slice(scriptStart + 1, scriptEnd).trim()
      : null;

  const renderedHtmlPayload = extractQuickActionPayloadFromRenderedHtml(content);
  if (!payloadText) {
    if (
      renderedHtmlPayload.cards.length > 0 ||
      renderedHtmlPayload.loginWall ||
      renderedHtmlPayload.noResults ||
      renderedHtmlPayload.rateLimited
    ) {
      return renderedHtmlPayload;
    }

    throw new CommercialDiscoveryError(
      "Browser Run Quick Actions returned no extraction payload.",
      "selector_drift",
    );
  }

  try {
    const parsed = JSON.parse(payloadText.replace(/<\\\//g, "</")) as QuickActionExtractionPayload;
    if (
      (!Array.isArray(parsed.cards) || parsed.cards.length === 0) &&
      renderedHtmlPayload.cards.length > 0
    ) {
      return renderedHtmlPayload;
    }

    return parsed;
  } catch {
    if (
      renderedHtmlPayload.cards.length > 0 ||
      renderedHtmlPayload.loginWall ||
      renderedHtmlPayload.noResults ||
      renderedHtmlPayload.rateLimited
    ) {
      return renderedHtmlPayload;
    }

    throw new CommercialDiscoveryError(
      "Browser Run Quick Actions returned invalid extraction payload.",
      "selector_drift",
    );
  }
}

async function scrapeMetaLibraryByQuickActions(
  env: AppEnv,
  url: string,
): Promise<QuickActionExtractionPayload> {
  const scraped = await captureBrowserRunQuickActionScrape(env, {
    url,
    actionTimeout: NAVIGATION_TIMEOUT_MS,
    bestAttempt: true,
    elements: [
      {
        selector: AD_LIBRARY_RESULT_SELECTOR,
      },
    ],
    gotoOptions: {
      timeout: NAVIGATION_TIMEOUT_MS,
      waitUntil: "networkidle2",
    },
    userAgent: MOBILE_USER_AGENT,
    viewport: MOBILE_VIEWPORT,
    waitForSelector: {
      selector: AD_LIBRARY_RESULT_SELECTOR,
      timeout: PAGE_READY_TIMEOUT_MS,
    },
    waitForTimeout: QUICK_ACTION_SCRAPE_WAIT_FOR_TIMEOUT_MS,
  });

  if (!scraped) {
    throw new CommercialDiscoveryError(
      "Browser Run Quick Actions are not configured for commercial discovery.",
      "browser_unavailable",
    );
  }

  return extractQuickActionPayloadFromScrape(scraped.elements);
}

function extractQuickActionPayloadFromScrape(
  elements: BrowserRunQuickActionScrapeElement[],
): QuickActionExtractionPayload {
  const cards: ExtractedAdCard[] = [];
  const seen = new Set<string>();

  for (const element of elements) {
    const href = extractHrefFromScrapeElement(element);
    if (!href) {
      continue;
    }

    const idMatch = href.match(/[?&](?:amp;)?id=(\d+)/);
    const libraryId = idMatch?.[1];
    if (!libraryId || seen.has(libraryId)) {
      continue;
    }
    seen.add(libraryId);

    const html = element.html ?? "";
    const text = stripHtml(html) || element.text?.trim() || "Meta Ad Library result";
    const lineText = stripHtmlPreservingLines(html);

    cards.push({
      libraryId,
      advertiser: null,
      body: text,
      previewHeadline: element.text?.trim() || text.slice(0, 120),
      previewSubhead: null,
      cta: inferCta(text),
      adSnapshotUrl: absolutizeMetaAdUrl(href),
      landingPageUrl: extractExternalLink(html),
      platforms: inferPlatforms(text),
      active: !hasStandaloneInactiveLine(lineText),
      startedRunning: findStartedRunningLine(lineText),
    });
  }

  return {
    cards,
    loginWall: false,
    noResults: false,
    rateLimited: false,
  };
}

function extractHrefFromScrapeElement(element: BrowserRunQuickActionScrapeElement) {
  const attrHref = element.attributes?.find((attribute) => attribute.name?.toLowerCase() === "href")
    ?.value;
  if (attrHref) {
    return decodeHtmlEntity(attrHref);
  }

  const htmlHref = element.html?.match(/\bhref=(["'])(.*?)\1/i)?.[2];
  return htmlHref ? decodeHtmlEntity(htmlHref) : null;
}

function extractQuickActionPayloadFromRenderedHtml(content: string): QuickActionExtractionPayload {
  const visibleText = stripHtmlPreservingLines(content);
  const text = visibleText.toLowerCase();
  const cards: ExtractedAdCard[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of content.matchAll(anchorRegex)) {
    const href = decodeHtmlEntity(match[2] ?? "");
    if (!/\/ads\/library\/\?/.test(href) && !/facebook\.com\/ads\/library\/\?/.test(href)) {
      continue;
    }

    const idMatch = href.match(/[?&](?:amp;)?id=(\d+)/);
    const libraryId = idMatch?.[1];
    if (!libraryId || seen.has(libraryId)) {
      continue;
    }
    seen.add(libraryId);

    const contextStart = Math.max(0, (match.index ?? 0) - 1200);
    const contextEnd = Math.min(content.length, (match.index ?? 0) + match[0].length + 1800);
    const contextHtml = content.slice(contextStart, contextEnd);
    const contextLineText = stripHtmlPreservingLines(contextHtml);
    const body = stripHtml(contextHtml) || stripHtml(match[3] ?? "");
    const landingPageUrl = extractExternalLink(contextHtml);

    cards.push({
      libraryId,
      advertiser: null,
      body,
      previewHeadline: stripHtml(match[3] ?? "") || null,
      previewSubhead: null,
      cta: inferCta(body),
      adSnapshotUrl: absolutizeMetaAdUrl(href),
      landingPageUrl,
      platforms: inferPlatforms(body),
      active: !hasStandaloneInactiveLine(contextLineText),
      startedRunning: findStartedRunningLine(contextLineText),
    });
  }

  return {
    cards: cards.length > 0 ? cards : extractTextCardsFromVisibleText(visibleText),
    loginWall:
      /log in|login|sign in|sign into/.test(text) && text.includes("facebook"),
    noResults: hasNoResultsSignal(visibleText),
    rateLimited:
      text.includes("rate limit") ||
      text.includes("too many requests") ||
      text.includes("try again later"),
  };
}

function extractTextCardsFromVisibleText(value: string): ExtractedAdCard[] {
  const lines = value
    .replace(/\u200b/g, "\n")
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const idIndexes = lines
    .map((line, index) => ({
      index,
      match: line.match(/^Library ID:\s*(\d+)/i),
    }))
    .filter((entry): entry is { index: number; match: RegExpMatchArray } => Boolean(entry.match));
  const cards: ExtractedAdCard[] = [];
  const seen = new Set<string>();

  for (let entryIndex = 0; entryIndex < idIndexes.length; entryIndex += 1) {
    const entry = idIndexes[entryIndex];
    const libraryId = entry.match[1];
    if (!libraryId || seen.has(libraryId)) {
      continue;
    }

    const previousLine = lines[entry.index - 1]?.toLowerCase();
    const blockStart = previousLine === "active" || previousLine === "inactive"
      ? entry.index - 1
      : entry.index;
    const blockEnd = idIndexes[entryIndex + 1]?.index ?? lines.length;
    const block = lines.slice(blockStart, blockEnd);
    if (!block.some((line) => /^Sponsored$/i.test(line))) {
      continue;
    }

    const advertiser = inferAdvertiserFromTextBlock(block);
    const bodyLines = extractAdBodyLines(block);
    const body = bodyLines.join("\n").trim();
    const blockText = block.join("\n");
    seen.add(libraryId);

    cards.push({
      libraryId,
      advertiser,
      body: body || advertiser || blockText,
      previewHeadline: bodyLines[0] ?? advertiser,
      previewSubhead: bodyLines.slice(1, 3).join(" ") || null,
      cta: inferCta(blockText),
      adSnapshotUrl: `https://www.facebook.com/ads/library/?id=${libraryId}`,
      landingPageUrl: inferLandingPageFromTextBlock(block),
      platforms: inferPlatforms(blockText),
      active: !block.some((line) => /^Inactive$/i.test(line)),
      // isTextCardUiLine keeps this line out of the ad body; the block still
      // carries it, so capture Meta's published start date before it drops.
      startedRunning: findStartedRunningLine(blockText),
    });
  }

  return cards;
}

function emptyMetaLibraryResponse(): SearchResponse {
  return {
    ads: [],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
    discoveryEmptyReason: "no_results",
  };
}

function hasNoResultsSignal(value: string) {
  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return (
    normalized.includes("no ads found") ||
    normalized.includes("no ads match") ||
    normalized.includes("no results") ||
    /\b0\s+results?\b/.test(normalized) ||
    /\bno\s+(ads?|results?)\s+(match|matched|found|available)\b/.test(normalized) ||
    /\bcouldn.?t find any ads\b/.test(normalized) ||
    /\bcould not find any ads\b/.test(normalized) ||
    /\bwe (didn't|did not) find any results\b/.test(normalized) ||
    /\bthere are no ads\b/.test(normalized)
  );
}

function inferAdvertiserFromTextBlock(block: string[]) {
  const detailIndex = block.findIndex((line) => /^See (ad|summary) details$/i.test(line));
  if (detailIndex >= 0) {
    const advertiser = block
      .slice(detailIndex + 1)
      .find((line) => !isTextCardUiLine(line) && !/^Sponsored$/i.test(line));
    if (advertiser) {
      return advertiser;
    }
  }

  const sponsoredIndex = block.findIndex((line) => /^Sponsored$/i.test(line));
  for (let index = sponsoredIndex - 1; index >= 0; index -= 1) {
    const line = block[index];
    if (line && !isTextCardUiLine(line)) {
      return line;
    }
  }

  return null;
}

function extractAdBodyLines(block: string[]) {
  const sponsoredIndex = block.findIndex((line) => /^Sponsored$/i.test(line));
  const afterSponsored = sponsoredIndex >= 0 ? block.slice(sponsoredIndex + 1) : block;
  const bodyLines: string[] = [];
  const seen = new Set<string>();

  for (const line of afterSponsored) {
    if (isTextCardUiLine(line) || /^Sponsored$/i.test(line)) {
      continue;
    }
    const normalized = normalizeExtractedBodyLine(line);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    bodyLines.push(line);
  }

  return bodyLines;
}

function normalizeExtractedBodyLine(line: string) {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isTextCardUiLine(line: string) {
  return (
    /^Active$/i.test(line) ||
    /^Inactive$/i.test(line) ||
    /^Library ID:\s*\d+/i.test(line) ||
    /^Started running on\b/i.test(line) ||
    /^Platforms$/i.test(line) ||
    /^This ad has multiple versions$/i.test(line) ||
    /^\d+\s+ads?\s+use this creative and text$/i.test(line) ||
    /^Menu$/i.test(line) ||
    /^See (ad|summary) details$/i.test(line) ||
    /^\d+:\d+\s*\/\s*\d+:\d+/.test(line)
  );
}

function inferLandingPageFromTextBlock(block: string[]) {
  const domainLine = block.find((line) => /^[A-Z0-9.-]+\.[A-Z]{2,}(?:\/\S*)?$/i.test(line));
  if (!domainLine) {
    return null;
  }

  try {
    return new URL(`https://${domainLine.toLowerCase()}`).toString();
  } catch {
    return null;
  }
}

function stripHtml(value: string) {
  return decodeHtmlEntity(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

// The Ad Library shows ad status as its own "Active"/"Inactive" line at the
// top of each card. Only a standalone line counts: matching the word anywhere
// marked ads inactive whenever their creative copy contained "inactive".
function hasStandaloneInactiveLine(text: string) {
  return text.split("\n").some((line) => /^inactive$/i.test(line.trim()));
}

function stripHtmlPreservingLines(value: string) {
  return decodeHtmlEntity(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:article|aside|button|div|h[1-6]|li|main|p|section|strong)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n"),
  );
}

function decodeHtmlEntity(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, " ")
    .trim();
}

function extractExternalLink(html: string) {
  const hrefRegex = /\bhref=(["'])(.*?)\1/gi;
  for (const match of html.matchAll(hrefRegex)) {
    const href = decodeHtmlEntity(match[2] ?? "");
    if (
      /^https?:/i.test(href) &&
      !/facebook\.com/i.test(href) &&
      !/l\.facebook\.com/i.test(href)
    ) {
      return href;
    }
  }

  return null;
}

function absolutizeMetaAdUrl(href: string) {
  try {
    return new URL(href, "https://www.facebook.com").toString();
  } catch {
    return `https://www.facebook.com/ads/library/?id=${href}`;
  }
}

function inferCta(text: string | null) {
  if (!text) {
    return null;
  }

  const match = text.match(/\b(Shop now|Learn more|Sign up|Apply now|Book now|Contact us)\b/i);
  return match?.[1] ?? null;
}

function inferPlatforms(text: string | null) {
  const value = text ?? "";
  return ["Instagram", "Facebook", "Messenger", "WhatsApp", "Audience Network", "Threads"].filter(
    (token) => value.includes(token),
  );
}

function buildRateLimitMessage(timeUntilNextAllowedBrowserAcquisition: number) {
  const retryAfterSeconds = normalizeRetryAfterSeconds(timeUntilNextAllowedBrowserAcquisition);
  if (retryAfterSeconds) {
    return `Browser Run rate limited this request. Retry after about ${retryAfterSeconds}s.`;
  }

  return "Browser Run rate limited this request.";
}

function normalizeRetryAfterSeconds(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(value / 1000));
}

function normalizeExtractedCard(card: ExtractedAdCard, query: NormalizedSavedQuery): AdRecord {
  // Never back-fill the advertiser with the customer's search term or the CTA
  // with a guessed default: presenting extraction gaps as scraped facts can
  // attribute ads to brands that never ran them. Empty means "unconfirmed"
  // and the display layer labels it that way.
  const advertiser = card.advertiser || "";
  const body = card.body || advertiser;
  const previewHeadline = card.previewHeadline || advertiser;
  const previewSubhead = card.previewSubhead || body.slice(0, 120);

  return withStructuredAnalysis({
    metaAdId: card.libraryId,
    advertiser,
    body,
    previewHeadline,
    previewSubhead,
    hook: previewHeadline,
    offer: body,
    cta: card.cta || "",
    format: "image",
    languageLabel: inferLanguageLabel(`${previewHeadline} ${body}`),
    destinationType: inferDestinationType(card.landingPageUrl),
    landingPageUrl: card.landingPageUrl,
    adSnapshotUrl:
      card.adSnapshotUrl || `https://www.facebook.com/ads/library/?id=${card.libraryId}`,
    countries: [query.filters.country || "all"],
    platforms: card.platforms,
    // Meta publishes the ad's start date on every Ad Library card ("Started
    // running on <date>"). Treat it as firstSeenAt exactly like the Meta API
    // path treats ad_delivery_start_time; unparseable stays an honest null.
    firstSeenAt: parseStartedRunningDate(card.startedRunning ?? null),
    lastSeenAt: null,
    active: card.active,
    researchSummary:
      "Captured from the public Meta Ad Library via Browser Run and normalized into Five to Nine’s analysis schema.",
    source: "meta_library_browser",
  });
}

function buildSearchUrl(query: NormalizedSavedQuery) {
  const params = new URLSearchParams();
  params.set("active_status", "all");
  params.set("ad_type", "all");
  params.set("country", countryCode(query.filters.country));
  params.set("is_targeted_country", "false");
  params.set("media_type", "all");
  params.set(
    "search_type",
    query.mode === "advertiser" ? "keyword_exact_phrase" : "keyword_unordered",
  );
  params.set("q", query.filters.query || "");

  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

function countryCode(country: string | undefined) {
  if (!country) {
    return "ALL";
  }

  return isoFromCountryName(country) ?? country.toUpperCase();
}
