import puppeteer from "@cloudflare/puppeteer";

import { inferDestinationType, inferLanguageLabel, withStructuredAnalysis } from "~/lib/analysis.server";
import {
  BrowserRunQuickActionError,
  captureBrowserRunQuickActionContent,
  hasBrowserRunQuickActions,
} from "~/lib/browser-run.server";
import type { AppEnv } from "~/lib/env.server";
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
const QUICK_ACTION_EXTRACTION_SCRIPT_ID = "__0509_ad_library_payload";
const QUICK_ACTION_WAIT_FOR_TIMEOUT_MS = 1_000;

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

  if (!browserBinding && !hasBrowserRunQuickActions(env)) {
    throw new CommercialDiscoveryError(
      "Browser Run is not configured for commercial discovery.",
      "browser_unavailable",
    );
  }

  if (!browserBinding) {
    return searchMetaLibraryByQuickActions(env, query);
  }

  try {
    return await searchMetaLibraryViaSessions(browserBinding, query);
  } catch (error) {
    const normalizedError = normalizeCommercialDiscoveryError(error);
    if (!shouldUseQuickActionsFallback(env, normalizedError)) {
      throw normalizedError;
    }

    return searchMetaLibraryByQuickActions(env, query);
  }
}

async function searchMetaLibraryViaSessions(
  browserBinding: Fetcher,
  query: NormalizedSavedQuery,
): Promise<SearchResponse> {
  let browser: BrowserInstance | null = null;
  let browserContext: BrowserContext | null = null;
  let page: BrowserPage | null = null;

  try {
    browser = await acquireBrowser(browserBinding);
    browserContext = await browser.createBrowserContext();
    page = await browserContext.newPage();
    await page.setUserAgent(MOBILE_USER_AGENT);
    await page.setViewport(MOBILE_VIEWPORT);
    await page.goto(buildSearchUrl(query), {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await waitForLibrarySurface(page);

    const extractedCards = await page.evaluate(() => {
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

      return anchors
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
            active: !/inactive/i.test(text),
          };
        })
        .filter(Boolean);
    });

    if ((extractedCards as ExtractedAdCard[]).length === 0) {
      const pageSignals = await page.evaluate(() => {
        const text = (document.body?.innerText ?? "").toLowerCase();
        return {
          loginWall:
            /log in|login|sign in|sign into/.test(text) && text.includes("facebook"),
          rateLimited:
            text.includes("rate limit") ||
            text.includes("too many requests") ||
            text.includes("try again later"),
        };
      });

      if (pageSignals.loginWall) {
        throw new CommercialDiscoveryError(
          "Meta Ad Library returned a login wall.",
          "login_wall",
        );
      }

      if (pageSignals.rateLimited) {
        throw new CommercialDiscoveryError(
          "Meta Ad Library is temporarily rate limited.",
          "rate_limited",
        );
      }

      throw new CommercialDiscoveryError(
        "Meta Ad Library returned no extractable ad cards.",
        "empty_result",
      );
    }

    const ads = (extractedCards as ExtractedAdCard[]).map((card) =>
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
    await browser?.disconnect().catch(() => undefined);
  }
}

async function searchMetaLibraryByQuickActions(
  env: AppEnv,
  query: NormalizedSavedQuery,
): Promise<SearchResponse> {
  try {
    const quickActionContent = await captureBrowserRunQuickActionContent(env, {
      url: buildSearchUrl(query),
      actionTimeout: NAVIGATION_TIMEOUT_MS,
      addScriptTag: [
        {
          id: QUICK_ACTION_EXTRACTION_SCRIPT_ID,
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

async function acquireBrowser(browserBinding: Fetcher) {
  const reusableBrowser = await connectToReusableBrowser(browserBinding);
  if (reusableBrowser) {
    return reusableBrowser;
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

  return puppeteer.launch(browserBinding, {
    keep_alive: BROWSER_SESSION_KEEP_ALIVE_MS,
  });
}

async function connectToReusableBrowser(browserBinding: Fetcher) {
  const sessions = await listReusableSessions(browserBinding);

  for (const session of sessions) {
    try {
      return await puppeteer.connect(browserBinding, session.sessionId);
    } catch {
      continue;
    }
  }

  return null;
}

async function listReusableSessions(browserBinding: Fetcher) {
  try {
    const sessions = await puppeteer.sessions(browserBinding);
    return [...(sessions as BrowserRunSession[])]
      .filter((session) => !session.connectionId)
      .sort((left, right) => right.startTime - left.startTime);
  } catch {
    return [];
  }
}

async function readBrowserLimits(browserBinding: Fetcher) {
  try {
    return (await puppeteer.limits(browserBinding)) as BrowserRunLimits;
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
    "rate_limited",
    "timeout",
    "selector_drift",
    "empty_result",
  ].includes(error.failureClass);
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
    : normalizedMessage.includes("timeout")
      ? "timeout"
      : "browser_launch_failed";
  return new CommercialDiscoveryError(message, failureClass);
}

function buildQuickActionExtractionScript() {
  return `
(() => {
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
      const text = normalizeText(card?.textContent ?? anchor.textContent);
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
        active: !/inactive/i.test(text),
      };
    })
    .filter(Boolean);
  const pageText = (document.body?.innerText ?? "").toLowerCase();
  const payload = {
    cards,
    loginWall: /log in|login|sign in|sign into/.test(pageText) && pageText.includes("facebook"),
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

  if (!payloadText) {
    throw new CommercialDiscoveryError(
      "Browser Run Quick Actions returned no extraction payload.",
      "selector_drift",
    );
  }

  try {
    return JSON.parse(payloadText.replace(/<\\\//g, "</")) as QuickActionExtractionPayload;
  } catch {
    throw new CommercialDiscoveryError(
      "Browser Run Quick Actions returned invalid extraction payload.",
      "selector_drift",
    );
  }
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
  const advertiser = card.advertiser || query.filters.query || "Unknown advertiser";
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
    cta: card.cta || "Learn more",
    format: "image",
    languageLabel: inferLanguageLabel(`${previewHeadline} ${body}`),
    destinationType: inferDestinationType(card.landingPageUrl),
    landingPageUrl: card.landingPageUrl,
    adSnapshotUrl:
      card.adSnapshotUrl || `https://www.facebook.com/ads/library/?id=${card.libraryId}`,
    countries: [query.filters.country || "India"],
    platforms: card.platforms,
    firstSeenAt: null,
    lastSeenAt: null,
    active: card.active,
    researchSummary:
      "Captured from the public Meta Ad Library via Browser Run and normalized into 0509’s analysis schema.",
    source: "meta",
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
    return "IN";
  }

  const normalized = country.trim().toLowerCase();
  if (normalized === "india") {
    return "IN";
  }
  if (normalized === "united states" || normalized === "usa" || normalized === "us") {
    return "US";
  }
  if (normalized === "united kingdom" || normalized === "uk") {
    return "GB";
  }

  return country.toUpperCase();
}
