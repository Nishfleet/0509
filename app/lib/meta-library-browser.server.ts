import puppeteer from "@cloudflare/puppeteer";

import {
  inferDestinationType,
  inferLanguageLabel,
  resolveHookAndOffer,
  withStructuredAnalysis,
} from "~/lib/analysis.server";
import {
  mapDiscoveryFailureOutcome,
  recordBrowserJobTelemetry,
  resolveSourceForRouteContext,
  resolveWorkerVersionId,
  sha256Hex,
  type ActualBrowserProvider,
  type BrowserJobPlanTier,
  type BrowserJobRouteContext,
  type BrowserJobSource,
} from "~/lib/browser-job-telemetry.server";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import {
  type BrowserRunQuickActionScrapeElement,
  BrowserRunQuickActionError,
  captureBrowserRunQuickActionContent,
  captureBrowserRunQuickActionScrape,
  hasBrowserRunQuickActions,
} from "~/lib/browser-run.server";
import { isoFromCountryName } from "~/lib/countries";
import { fingerprintSavedQuery, normalizeNumericPageId } from "~/lib/normalize";
import { truncateTextSafe } from "~/lib/text-safe";
import {
  findStartedRunningLine,
  parseStartedRunningDate,
} from "~/lib/meta-ad-dates";
import {
  absolutizeMetaAdUrl,
  applyRelayPageIdentitiesToCards,
  decodeHtmlEntity,
  extractAdArchivePageIdentities,
  extractCreativeMediaFromHtml,
  extractAdCopyFromCardText,
  extractExternalLink,
  extractTextCardsFromVisibleText,
  hasNoResultsSignal,
  inferCta,
  inferPlatforms,
  isAdLibraryChromeCta,
  parseRenderedMetaLibraryHtml,
  readStandaloneActiveStatus,
  stripHtml,
  stripHtmlPreservingLines,
  type ExtractedAdCard,
} from "~/lib/meta-library-rendered-card-parser.server";
import type { AppEnv, BrowserBinding } from "~/lib/env.server";
import {
  fetchWithTimeout,
  promiseWithTimeout,
} from "~/lib/fetch-timeout.server";
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
/** Interactive public search only: scroll-and-collect depth (not watchlist scans). */
const INTERACTIVE_SCROLL_PASSES = 3;
const INTERACTIVE_SCROLL_WAIT_MS = 2_000;
const INTERACTIVE_SCROLL_BUDGET_MS = 10_000;
const INTERACTIVE_TARGET_CARD_COUNT = 50;
/** Meta API interactive first-page depth: follow real after-cursor this many extra times. */
const INTERACTIVE_META_API_EXTRA_PAGES = 2;

export type MetaLibraryBrowserMode = "interactive" | "shallow";

export interface SearchMetaLibraryByBrowserOptions {
  /**
   * `interactive` enables scroll-and-collect depth for public search.
   * Default `shallow` keeps scheduled/watchlist scans on their existing page budget.
   */
  mode?: MetaLibraryBrowserMode;
  /** Attribution context recorded in `browser_job_telemetry` (optional). */
  routeContext?: BrowserJobRouteContext;
  planTier?: BrowserJobPlanTier | null;
  source?: BrowserJobSource;
  /**
   * Top-level job correlation id. Callers that orchestrate a multi-leg job
   * (ad-source resolver) pass the SAME random id to every provider leg so one
   * job = one chain of attempts. Defaults to a fresh random id.
   */
  jobId?: string;
  /**
   * Out-param attempt counter. When provided, it is incremented as legs are
   * recorded so the caller can continue numbering a later fallback leg
   * (e.g. customer Meta API after the browser chain failed).
   */
  telemetryAttempts?: { used: number };
  /**
   * Request ExecutionContext when the caller actually has one. When present,
   * telemetry row writes are registered with `waitUntil` so they still land
   * after the response (background completion preserved) while the bounded
   * race still caps how long discovery may wait on a slow write.
   */
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
}
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
  /** Provider-reported browser milliseconds (X-Browser-Ms-Used) when known. */
  browserMsUsed?: number | null;
}

type BrowserInstance = Awaited<ReturnType<typeof puppeteer.launch>>;
type BrowserContext = Awaited<
  ReturnType<BrowserInstance["createBrowserContext"]>
>;
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
  options: SearchMetaLibraryByBrowserOptions = {},
): Promise<SearchResponse> {
  const browserBinding = env.BROWSER;
  const mode: MetaLibraryBrowserMode = options.mode ?? "shallow";

  if (
    !browserBinding &&
    !hasBrowserRunQuickActions(env) &&
    !hasBrowserlessBql(env)
  ) {
    throw new CommercialDiscoveryError(
      "Browser Run is not configured for commercial discovery.",
      "browser_unavailable",
    );
  }

  const jobId = options.jobId ?? crypto.randomUUID();
  // Started immediately but only awaited at leg terminal points, so the
  // provider path never waits on the digest (also keeps fake-timer tests
  // deterministic: the launch-timeout timer registers on the call stack).
  const idempotencyKeyPromise = sha256Hex(`meta_discovery:${fingerprintSavedQuery(query)}`);
  const routeContext = options.routeContext ?? "public_search";
  const planTier = options.planTier ?? null;
  const source = resolveSourceForRouteContext(routeContext, options.source);
  let attempt = 0;
  const nextAttempt = () => {
    attempt += 1;
    if (options.telemetryAttempts) {
      options.telemetryAttempts.used = attempt;
    }
    return attempt;
  };

  // One bounded row per leg attempt: the actual provider (Cloudflare Browser
  // Run sessions, Quick Actions, or Browserless BQL) is only knowable inside
  // the fallback chain, so attribution is recorded here at each leg's
  // terminal point. Queries that need one row per job pick the last attempt
  // per job_id. Never throws into the product path.
  const recordAttempt = async (
    actualProvider: ActualBrowserProvider,
    startedAt: string,
    result: SearchResponse | null,
    error: CommercialDiscoveryError | null,
    browserMsUsed: number | null,
  ) => {
    // Duration is measured from the SAME recorded startedAt: endedAt and
    // durationMs are captured together up front, before the idempotency
    // digest await, so a slow digest can never inflate the recorded window.
    const endedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
    return recordBrowserJobTelemetry(
      env,
      {
        jobId,
        idempotencyKey: await idempotencyKeyPromise,
        jobKind: "meta_discovery",
        actualProvider,
        routeContext,
        planTier,
        source,
        attempt: nextAttempt(),
        startedAt,
        endedAt,
        durationMs,
        browserMsUsed,
        outcome: error
          ? mapDiscoveryFailureOutcome(error.failureClass)
          : result && result.ads.length === 0
            ? "empty"
            : "succeeded",
        resultCount: result?.ads.length ?? null,
        workerVersion: resolveWorkerVersionId(env),
      },
      {
        // Preserve background completion when the caller has a request
        // ExecutionContext (see `SearchMetaLibraryByBrowserOptions`).
        executionContext: options.executionContext,
      },
    );
  };

  const runLeg = async (
    actualProvider: ActualBrowserProvider,
    startedAt: string,
    fn: () => Promise<MetaDiscoveryLegResult>,
  ) => {
    try {
      const { result, browserMsUsed } = await fn();
      await recordAttempt(actualProvider, startedAt, result, null, browserMsUsed);
      return result;
    } catch (error) {
      const normalizedError = normalizeCommercialDiscoveryError(error);
      await recordAttempt(actualProvider, startedAt, null, normalizedError, null);
      throw normalizedError;
    }
  };

  try {
    if (!browserBinding) {
      return await runLeg("cloudflare_quick_actions", new Date().toISOString(), () =>
        searchMetaLibraryByQuickActions(env, query),
      );
    }

    try {
      return await runLeg("cloudflare_browser_run", new Date().toISOString(), async () => ({
        result: await searchMetaLibraryViaSessions(env, browserBinding, query, mode),
        browserMsUsed: null,
      }));
    } catch (error) {
      const normalizedError = normalizeCommercialDiscoveryError(error);
      if (!shouldUseQuickActionsFallback(env, normalizedError)) {
        throw normalizedError;
      }

      return await runLeg("cloudflare_quick_actions", new Date().toISOString(), () =>
        searchMetaLibraryByQuickActions(env, query),
      );
    }
  } catch (error) {
    const normalizedError = normalizeCommercialDiscoveryError(error);
    if (shouldUseBrowserlessFallback(env, normalizedError)) {
      return await runLeg("browserless_bql", new Date().toISOString(), async () => ({
        result: await searchMetaLibraryByBrowserless(env, query),
        browserMsUsed: null,
      }));
    }

    throw normalizedError;
  }
}

interface MetaDiscoveryLegResult {
  result: SearchResponse;
  /** Provider-reported browser milliseconds (Quick Actions header) when known. */
  browserMsUsed: number | null;
}

/** Keep first occurrence per library id (stable order across scroll passes). */
export function dedupeExtractedCardsByLibraryId(
  cards: ExtractedAdCard[],
): ExtractedAdCard[] {
  const seen = new Set<string>();
  const result: ExtractedAdCard[] = [];
  for (const card of cards) {
    if (!card.libraryId || seen.has(card.libraryId)) {
      continue;
    }
    seen.add(card.libraryId);
    result.push(card);
  }
  return result;
}

export function getInteractiveMetaApiExtraPages() {
  return INTERACTIVE_META_API_EXTRA_PAGES;
}

async function searchMetaLibraryViaSessions(
  env: AppEnv,
  browserBinding: BrowserBinding,
  query: NormalizedSavedQuery,
  mode: MetaLibraryBrowserMode,
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

    const extraction = await page.evaluate(createSessionCardExtractionScript());

    const normalizedExtraction = Array.isArray(extraction)
      ? {
          cards: extraction as ExtractedAdCard[],
          pageText: "",
          loginWall: false,
          noResults: false,
          rateLimited: false,
        }
      : (extraction as {
          cards: ExtractedAdCard[];
          pageText: string;
          loginWall: boolean;
          noResults: boolean;
          rateLimited: boolean;
        });
    let extractedCards =
      normalizedExtraction.cards.length > 0
        ? normalizedExtraction.cards
        : extractTextCardsFromVisibleText(normalizedExtraction.pageText);
    // Relay page_name is the authoritative advertiser identity. The in-page
    // DOM extractor often leaves advertiser empty on the logged-out grid
    // (no strong/h3 wrapper), while page_id was already captured. Re-read
    // identities from the full HTML and fill advertiser/pageId gaps only.
    extractedCards = await mergeRelayIdentitiesFromPage(page, extractedCards);
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

    // Deep scroll only for interactive public search — watchlist/scheduled
    // scans stay shallow and keep DEFAULT_PAGE_BUDGET cost bounds.
    if (mode === "interactive" && page) {
      extractedCards = await collectCardsWithInteractiveScroll(
        page,
        extractedCards,
      );
      extractedCards = await mergeRelayIdentitiesFromPage(page, extractedCards);
    } else {
      extractedCards = dedupeExtractedCardsByLibraryId(extractedCards);
    }

    let ads = normalizeAndFilterExtractedCards(extractedCards, query).filter(
      adHasUsableContent,
    );

    // Belt-and-suspenders for the logged-out Browser Rendering DOM: if DOM card
    // discovery produced no ad with usable content (advertiser/body/headline/
    // creative), re-derive from the page's rendered text with the hardened
    // parser before returning an empty result. DOM discovery emitting
    // content-free "ghost" cards must never suppress this fallback.
    if (ads.length === 0 && normalizedExtraction.pageText) {
      const textAds = normalizeAndFilterExtractedCards(
        extractTextCardsFromVisibleText(normalizedExtraction.pageText),
        query,
      ).filter(adHasUsableContent);
      if (textAds.length > 0) {
        ads = textAds;
      }
    }

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

async function collectCardsWithInteractiveScroll(
  page: BrowserPage,
  initialCards: ExtractedAdCard[],
): Promise<ExtractedAdCard[]> {
  let cards = dedupeExtractedCardsByLibraryId(initialCards);
  const startedAt = Date.now();

  for (let pass = 0; pass < INTERACTIVE_SCROLL_PASSES; pass += 1) {
    if (cards.length >= INTERACTIVE_TARGET_CARD_COUNT) {
      break;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= INTERACTIVE_SCROLL_BUDGET_MS) {
      break;
    }

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    const remainingBudget =
      INTERACTIVE_SCROLL_BUDGET_MS - (Date.now() - startedAt);
    if (remainingBudget <= 0) {
      break;
    }
    await delayMs(Math.min(INTERACTIVE_SCROLL_WAIT_MS, remainingBudget));

    const passExtraction = await page.evaluate(
      createSessionCardExtractionScript(),
    );
    const passCards = Array.isArray(passExtraction)
      ? (passExtraction as ExtractedAdCard[])
      : ((passExtraction as { cards?: ExtractedAdCard[] }).cards ?? []);
    cards = dedupeExtractedCardsByLibraryId([...cards, ...passCards]);
  }

  return cards;
}

/**
 * Re-read the full page HTML for Relay ad_archive_id → page_id/page_name and
 * fill advertiser/pageId gaps on already-scraped cards. Never overwrites a
 * DOM-captured advertiser name and never invents one from the search query.
 */
async function mergeRelayIdentitiesFromPage(
  page: BrowserPage,
  cards: ExtractedAdCard[],
): Promise<ExtractedAdCard[]> {
  if (cards.length === 0) {
    return cards;
  }

  try {
    const pageHtml = await page.content();
    return applyRelayPageIdentitiesToCards(
      cards,
      extractAdArchivePageIdentities(pageHtml),
    );
  } catch {
    return cards;
  }
}

function delayMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/**
 * DOM extraction script for session-based Ad Library scrapes.
 * Must stay a pure function (no outer closures) so page.evaluate can serialize it.
 * Exported for unit tests that run the script against a DOM.
 */
export function createSessionCardExtractionScript() {
  return () => {
    const normalizeText = (value: string | null | undefined) =>
      (value ?? "")
        .replace(/\u00a0/g, " ")
        .split("\n")
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n")
        .trim();

    function isCreativeCdnHost(host: string) {
      const lower = host.toLowerCase();
      return lower.includes("fbcdn") || lower.includes("scontent");
    }

    /**
     * Pick the ad's real CTA button. FIX-14: the first `button`/`[role="button"]`
     * in a card is Ad Library chrome (the overflow "Menu"/"Open Drop-down"
     * button, "See ad details"), so plain first-match picks chrome as the CTA.
     * Filter chrome by exact label, prefer a real CTA verb, and only then fall
     * back to the first remaining candidate.
     */
    function pickCtaFromCard(
      cardRoot: HTMLElement | null | undefined,
    ): string | null {
      if (!cardRoot) {
        return null;
      }
      const candidates = Array.from(
        cardRoot.querySelectorAll<HTMLElement>(
          'button, [role="button"], [data-cta], a[aria-label*="Shop"], a[aria-label*="Learn"]',
        ),
      );
      const labelOf = (element: HTMLElement) =>
        (element.getAttribute("aria-label") ||
          element.innerText ||
          element.textContent ||
          "")
          .replace(/\u00a0/g, " ")
          .split("\n")
          .map((part) => part.trim())
          .filter(Boolean)
          .join(" ")
          .trim();
      const isChromeLabel = (value: string) =>
        /^(?:menu|open drop-down|see ad details|see summary details|view ad details|meta ad library result|more|report ad)$/i.test(
          value,
        );
      const isCtaVerb = (value: string) =>
        /^(?:shop now|learn more|sign up|apply now|book now|contact us)$/i.test(
          value,
        );
      const usable = candidates.filter(
        (element) => !isChromeLabel(labelOf(element)),
      );
      if (usable.length === 0) {
        return null;
      }
      const verbCta = usable.find((element) => isCtaVerb(labelOf(element)));
      return (verbCta ?? usable[0])?.innerText ?? null;
    }

    function pickCreativeMediaFromCard(
      cardRoot: HTMLElement | null | undefined,
    ) {
      if (!cardRoot) {
        return { imageUrl: null as string | null, hasVideo: false };
      }
      const videos = Array.from(cardRoot.querySelectorAll("video"));
      const hasVideo = videos.length > 0;
      for (const video of videos) {
        const poster = video.getAttribute("poster") || "";
        if (!poster) {
          continue;
        }
        try {
          const url = new URL(poster, location.origin);
          if (isCreativeCdnHost(url.hostname)) {
            return { imageUrl: url.toString(), hasVideo: true };
          }
        } catch {
          // skip invalid poster URLs
        }
      }

      const images = Array.from(cardRoot.querySelectorAll("img"));
      let bestUrl: string | null = null;
      let bestArea = -1;
      let firstCdnUrl: string | null = null;
      let measuredAny = false;

      for (const img of images) {
        const raw = img.currentSrc || img.src || img.getAttribute("src") || "";
        if (!raw || raw.startsWith("data:")) {
          continue;
        }
        let absolute: string | null = null;
        try {
          const url = new URL(raw, location.origin);
          if (!isCreativeCdnHost(url.hostname)) {
            continue;
          }
          absolute = url.toString();
        } catch {
          continue;
        }
        if (!firstCdnUrl) {
          firstCdnUrl = absolute;
        }
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (width > 0 || height > 0) {
          measuredAny = true;
        }
        // Page avatars render as ≤64px squares; never surface them as creatives.
        if (width > 0 && height > 0 && width <= 64 && height <= 64) {
          continue;
        }
        const area = (width || 1) * (height || 1);
        if (area > bestArea) {
          bestArea = area;
          bestUrl = absolute;
        }
      }

      // The 2026 Ad Library DOM renders many image creatives as CSS
      // background-images rather than <img> tags — scan for the first
      // large CDN-backed background inside the card.
      if (!bestUrl) {
        const styled = Array.from(cardRoot.querySelectorAll<HTMLElement>("div, span, a"));
        for (const el of styled) {
          if ((el.offsetWidth || 0) < 100) {
            continue;
          }
          const backgroundImage = window.getComputedStyle(el).backgroundImage || "";
          const match = backgroundImage.match(/url\("(.+?)"\)/);
          if (!match) {
            continue;
          }
          try {
            const url = new URL(match[1], location.origin);
            if (!isCreativeCdnHost(url.hostname)) {
              continue;
            }
            bestUrl = url.toString();
            break;
          } catch {
            // skip invalid background URLs
          }
        }
      }

      return {
        // Fall back to the first CDN image only when nothing was measurable at
        // all (images not yet loaded); a measured-but-small-only set means the
        // card had just an avatar, which must stay out of the creative slot.
        imageUrl: bestUrl || (measuredAny ? null : firstCdnUrl),
        hasVideo,
      };
    }

    function resolveExternalLink(cardRoot: HTMLElement) {
      const links = Array.from(cardRoot.querySelectorAll<HTMLAnchorElement>("a[href]"));
      for (const link of links) {
        const href = link.href || link.getAttribute("href") || "";
        if (!/^https?:/i.test(href)) {
          continue;
        }
        let parsed: URL;
        try {
          parsed = new URL(href);
        } catch {
          continue;
        }
        const host = parsed.hostname.toLowerCase();
        if (host === "l.facebook.com" || host === "lm.facebook.com") {
          // Outbound ad destinations are wrapped as l.facebook.com/l.php?u=<target>.
          const target = parsed.searchParams.get("u");
          if (!target) {
            continue;
          }
          try {
            const decoded = new URL(target);
            if (!/(^|\.)facebook\.com$|(^|\.)instagram\.com$|(^|\.)fb\.com$/i.test(decoded.hostname)) {
              return decoded.toString();
            }
          } catch {
            // skip undecodable redirect targets
          }
          continue;
        }
        if (!/facebook\.com/i.test(host)) {
          return parsed.toString();
        }
      }
      return null;
    }

    // Relay payload map: each Ad Library result node carries the advertiser's
    // numeric page_id and page_name keyed by ad_archive_id (= library id).
    // page_name is the authoritative advertiser identity when the card DOM
    // has no strong/h3 name (logged-out grid). Window reaches the next node
    // (capped) so page_name nested inside snapshot is still found.
    const pageIdByLibraryId = new Map<string, string>();
    const pageNameByLibraryId = new Map<string, string>();
    try {
      const relayHtml = document.documentElement.innerHTML;
      const idRegex = /[\\]?"ad_archive_id[\\]?"\s*:\s*[\\]?"(\d+)[\\]?"/g;
      const relayMatches: RegExpExecArray[] = [];
      let relayMatch: RegExpExecArray | null;
      while ((relayMatch = idRegex.exec(relayHtml))) {
        relayMatches.push(relayMatch);
      }
      for (let index = 0; index < relayMatches.length; index += 1) {
        const current = relayMatches[index];
        const libId = current[1];
        if (!libId || pageIdByLibraryId.has(libId)) {
          continue;
        }
        const windowStart = current.index + current[0].length;
        const nextIndex = relayMatches[index + 1]?.index ?? relayHtml.length;
        const window = relayHtml.slice(
          windowStart,
          Math.min(nextIndex, windowStart + 50_000),
        );
        const pid = window.match(/[\\]?"page_id[\\]?"\s*:\s*[\\]?"(\d{5,})[\\]?"/);
        if (!pid) {
          continue;
        }
        pageIdByLibraryId.set(libId, pid[1]);
        const pname = window.match(
          /[\\]?"page_name[\\]?"\s*:\s*[\\]?"((?:[^"\\]|\\.){0,120}?)[\\]?"/,
        );
        if (pname?.[1]) {
          const decoded = pname[1]
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
              String.fromCharCode(Number.parseInt(code, 16)),
            )
            .replace(/\\"/g, '"')
            .replace(/\\\//g, "/")
            .replace(/\\\\/g, "\\")
            .trim();
          if (decoded) {
            pageNameByLibraryId.set(libId, decoded);
          }
        }
      }
    } catch {
      // Relay shape can change; page-scoping is an optimization, never required.
    }

    function numericPageIdFromCard(cardRoot: HTMLElement): string | null {
      const links = Array.from(
        cardRoot.querySelectorAll<HTMLAnchorElement>("a[href]"),
      );
      for (const link of links) {
        const href = link.href || link.getAttribute("href") || "";
        try {
          const url = new URL(href, location.origin);
          if (!/(^|\.)facebook\.com$/i.test(url.hostname)) {
            continue;
          }
          const match = url.pathname.match(/^\/(\d{5,})\/?$/);
          if (match) {
            return match[1];
          }
        } catch {
          // skip malformed hrefs
        }
      }
      return null;
    }

    // Card discovery, two paths merged by library id:
    // Path A — legacy DOM variants exposed id-bearing anchors per card.
    // Path B — the current (2026) Ad Library DOM has NO id anchors and no
    // [role=article]; the only stable card marker is the "Library ID: N" text
    // label. Climb from each label leaf to the widest ancestor that still
    // contains exactly that one library id: that ancestor is the card root.
    const roots = new Map<string, HTMLElement>();
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/ads/library/?id="], a[href*="facebook.com/ads/library/?id="]',
      ),
    );
    for (const anchor of anchors) {
      const href = anchor.href || anchor.getAttribute("href") || "";
      const idMatch = href.match(/[?&]id=(\d+)/);
      if (!idMatch) {
        continue;
      }
      const root =
        anchor.closest<HTMLElement>('[role="article"]') ||
        anchor.closest<HTMLElement>("article") ||
        anchor.closest<HTMLElement>("[data-ad-preview]") ||
        anchor.parentElement;
      if (root && !roots.has(idMatch[1])) {
        roots.set(idMatch[1], root);
      }
    }
    const countLibraryIds = (el: HTMLElement) =>
      ((el.innerText || "").match(/Library ID: \d+/g) || []).length;
    const labels = Array.from(document.querySelectorAll<HTMLElement>("div, span")).filter(
      (el) => el.children.length === 0 && /^Library ID: \d+$/.test((el.innerText || "").trim()),
    );
    for (const label of labels) {
      const idMatch = (label.innerText || "").match(/(\d+)/);
      if (!idMatch || roots.has(idMatch[1])) {
        continue;
      }
      let node: HTMLElement = label;
      while (
        node.parentElement &&
        countLibraryIds(node.parentElement) === 1 &&
        (node.parentElement.innerText || "").length < 8000
      ) {
        node = node.parentElement;
      }
      // On flat/virtualized Ad Library DOMs (and the logged-out Browser
      // Rendering variant) the climb can stop at the bare "Library ID: N" leaf,
      // whose only text is the label itself. Registering such a root emits a
      // ghost card that has no advertiser/body/creative yet still short-circuits
      // the hardened rendered-text fallback. Only register a climbed root that
      // grew into a real card and carries the "Sponsored" marker.
      const climbedText = node.innerText || "";
      const looksLikeAdCard =
        node !== label &&
        climbedText
          .split("\n")
          .some((line) => /^\s*Sponsored\s*$/i.test(line));
      if (looksLikeAdCard) {
        roots.set(idMatch[1], node);
      }
    }

    const cards = Array.from(roots.entries())
      .map(([libraryId, card]) => {
        const externalLink = resolveExternalLink(card);
        const text = normalizeText(card.innerText);
        // Advertiser honesty (#353): accept only a single unambiguous candidate
        // that appears before the "Sponsored" marker and is not UI chrome. When
        // the logged-out grid has no strong/h3 wrapper, recover the plain-text
        // line above Sponsored; if that is also empty, use Relay page_name.
        const advertiser = (() => {
          const isUiLine = (value: string) =>
            /^(?:Active|Inactive|Library ID:\s*\d+|Started running on\b.*|Platforms|This ad has multiple versions|\d+\s+ads?\s+use this creative and text|Menu|See (?:ad|summary) details|View ad details|Meta Ad Library result|Instagram|Facebook|Messenger|WhatsApp|Audience Network|Threads|Shop now|Learn more|Sign up|Apply now|Book now|Contact us)$/i.test(
              value,
            ) || /^\d+:\d+\s*\/\s*\d+/.test(value);
          const lines = text.split("\n");
          const sponsoredIndex = lines.findIndex((line) =>
            /^Sponsored$/i.test(line),
          );
          if (sponsoredIndex < 0) {
            return pageNameByLibraryId.get(libraryId) ?? null;
          }
          const beforeSponsored = new Set(
            lines
              .slice(0, sponsoredIndex)
              .map((line) => line.replace(/\s+/g, " ").trim()),
          );
          const candidates = [
            ...new Set(
              Array.from(
                card.querySelectorAll<HTMLElement>(
                  "strong, h3, h4, [data-advertiser-name]",
                ),
              )
                .map((element) =>
                  normalizeText(element.innerText).replace(/\s+/g, " ").trim(),
                )
                .filter(
                  (value) =>
                    value && beforeSponsored.has(value) && !isUiLine(value),
                ),
            ),
          ];
          if (candidates.length === 1) {
            return candidates[0];
          }
          if (candidates.length === 0) {
            const priorLines = lines
              .slice(0, sponsoredIndex)
              .map((line) => line.replace(/\s+/g, " ").trim())
              .filter(
                (value) =>
                  value &&
                  value.length > 1 &&
                  value.length <= 60 &&
                  value.split(" ").length <= 6 &&
                  !isUiLine(value),
              );
            const nearest = priorLines[priorLines.length - 1];
            if (nearest) {
              return nearest;
            }
          }
          return pageNameByLibraryId.get(libraryId) ?? null;
        })();
        const headline =
          card.querySelector<HTMLElement>("h1, h2, h3, [data-headline]")
            ?.innerText ?? null;
        const cta = pickCtaFromCard(card);
        const platformTokens = [
          "Instagram",
          "Facebook",
          "Messenger",
          "WhatsApp",
          "Audience Network",
          "Threads",
        ];
        const platforms = platformTokens.filter((token) =>
          text.includes(token),
        );
        const startedRunning =
          text
            .split("\n")
            .map((line) => line.trim())
            .find((line) => /^started running on\b/i.test(line)) ?? null;

        const variantMatch = text.match(/(\d+) ads use this creative and text/i);
        const media = pickCreativeMediaFromCard(card);

        return {
          libraryId,
          advertiser: normalizeText(advertiser),
          body: text,
          previewHeadline: normalizeText(headline),
          previewSubhead: null,
          cta: normalizeText(cta),
          adSnapshotUrl: `https://www.facebook.com/ads/library/?id=${libraryId}`,
          landingPageUrl: externalLink,
          platforms,
          active: (() => {
            const status = text
              .split("\n")
              .map((line) => line.trim().toLowerCase())
              .find((line) => line === "active" || line === "inactive");
            return status === "active"
              ? true
              : status === "inactive"
                ? false
                : null;
          })(),
          startedRunning,
          imageUrl: media.imageUrl,
          hasVideo: media.hasVideo,
          variantCount: variantMatch ? Number.parseInt(variantMatch[1], 10) : null,
          pageId: pageIdByLibraryId.get(libraryId) ?? numericPageIdFromCard(card),
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
  };
}

async function searchMetaLibraryByQuickActions(
  env: AppEnv,
  query: NormalizedSavedQuery,
): Promise<MetaDiscoveryLegResult> {
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
        return {
          result: emptyMetaLibraryResponse(),
          browserMsUsed: extracted.browserMsUsed ?? null,
        };
      }

      throw new CommercialDiscoveryError(
        "Meta Ad Library returned no extractable ad cards.",
        "empty_result",
      );
    }

    return {
      result: {
        ads: normalizeAndFilterExtractedCards(extracted.cards, query),
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
      },
      browserMsUsed: extracted.browserMsUsed ?? null,
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

    const extracted = parseQuickActionExtractionPayload(
      quickActionContent.content,
    );
    if (extracted.cards.length === 0) {
      if (
        !extracted.loginWall &&
        !extracted.rateLimited &&
        !extracted.noResults
      ) {
        return scrapeMetaLibraryByQuickActions(env, url);
      }
    }

    return {
      ...extracted,
      browserMsUsed: quickActionContent.browserMsUsed ?? null,
    };
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
          /log in|login|sign in|sign into/.test(bodyText) &&
          bodyText.includes("facebook");
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

function shouldUseBrowserlessFallback(
  env: AppEnv,
  error: CommercialDiscoveryError,
) {
  return (
    hasBrowserlessBql(env) &&
    [
      "browser_unavailable",
      "selector_drift",
      "empty_result",
      "timeout",
      "login_wall",
    ].includes(error.failureClass)
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

  const message =
    error instanceof Error ? error.message : "Browser discovery failed.";
  const normalizedMessage = message.toLowerCase();
  const failureClass: DiscoveryFailureClass =
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("429")
      ? "rate_limited"
      : normalizedMessage.includes("timeout") ||
          normalizedMessage.includes("timed out")
        ? "timeout"
        : "browser_launch_failed";
  return new CommercialDiscoveryError(message, failureClass);
}

async function searchMetaLibraryByBrowserless(
  env: AppEnv,
  query: NormalizedSavedQuery,
): Promise<SearchResponse> {
  let lastEmptyResult: CommercialDiscoveryError | null = null;

  for (
    let attempt = 1;
    attempt <= BROWSERLESS_EMPTY_RESULT_MAX_ATTEMPTS;
    attempt += 1
  ) {
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

  throw (
    lastEmptyResult ??
    new CommercialDiscoveryError(
      "Browserless returned no extractable Meta Ad Library cards.",
      "empty_result",
    )
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
  )) as {
    data?: {
      html?: {
        html?: string;
      };
    };
    errors?: Array<{
      message?: string;
    }>;
    message?: string;
  } | null;

  if (!response.ok) {
    throw normalizeBrowserlessError(response.status, payload?.message ?? null);
  }

  if (!payload) {
    throw normalizeBrowserlessError(
      408,
      "Browserless timed out before returning a readable response.",
    );
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const message = payload.errors
      .map((error) => error.message)
      .filter(Boolean)
      .join(" | ");
    throw normalizeBrowserlessError(
      response.status,
      message || "Browserless returned a GraphQL error.",
    );
  }

  const html = payload?.data?.html?.html ?? "";
  const extracted = extractQuickActionPayloadFromRenderedHtml(html);
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
      "Browserless returned no extractable Meta Ad Library cards.",
      "empty_result",
    );
  }

  return {
    ads: normalizeAndFilterExtractedCards(extracted.cards, query),
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
  if (
    !url.pathname.endsWith("/stealth/bql") &&
    !url.pathname.endsWith("/chromium/bql")
  ) {
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
  if (
    status === 429 ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  ) {
    return new CommercialDiscoveryError(
      message || "Browserless rate limited this request.",
      "rate_limited",
    );
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return new CommercialDiscoveryError(
      message || "Browserless timed out.",
      "timeout",
    );
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

  const pageIdByLibraryId = new Map();
  const pageNameByLibraryId = new Map();
  try {
    const relayHtml = document.documentElement.innerHTML;
    // Window reaches the next ad_archive_id (capped) so page_name nested in
    // snapshot is found. [\\]? tolerates Meta's escaped Relay quotes.
    const idRegex = /[\\\\]?"ad_archive_id[\\\\]?"\\s*:\\s*[\\\\]?"(\\d+)[\\\\]?"/g;
    const relayMatches = [];
    let relayMatch;
    while ((relayMatch = idRegex.exec(relayHtml))) {
      relayMatches.push(relayMatch);
    }
    for (let index = 0; index < relayMatches.length; index += 1) {
      const current = relayMatches[index];
      const libId = current[1];
      if (!libId || pageIdByLibraryId.has(libId)) {
        continue;
      }
      const windowStart = current.index + current[0].length;
      const nextIndex = relayMatches[index + 1] ? relayMatches[index + 1].index : relayHtml.length;
      const relayWindow = relayHtml.slice(windowStart, Math.min(nextIndex, windowStart + 50000));
      const pid = relayWindow.match(/[\\\\]?"page_id[\\\\]?"\\s*:\\s*[\\\\]?"(\\d{5,})[\\\\]?"/);
      if (!pid) {
        continue;
      }
      pageIdByLibraryId.set(libId, pid[1]);
      const pname = relayWindow.match(/[\\\\]?"page_name[\\\\]?"\\s*:\\s*[\\\\]?"((?:[^"\\\\]|\\\\.){0,120}?)[\\\\]?"/);
      if (pname && pname[1]) {
        const decoded = pname[1]
          .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
          .replace(/\\\\"/g, '"')
          .replace(/\\\\\\//g, "/")
          .replace(/\\\\\\\\/g, "\\\\")
          .trim();
        if (decoded) {
          pageNameByLibraryId.set(libId, decoded);
        }
      }
    }
  } catch (relayError) {
    // Relay shape can change; page-scoping is an optimization, never required.
  }

  function numericPageIdFromCard(cardRoot) {
    if (!cardRoot) {
      return null;
    }
    const links = Array.from(cardRoot.querySelectorAll("a[href]"));
    for (const link of links) {
      const href = (link instanceof HTMLAnchorElement ? link.href : link.getAttribute("href")) || "";
      try {
        const url = new URL(href, location.origin);
        if (!/(^|\\.)facebook\\.com$/i.test(url.hostname)) {
          continue;
        }
        const match = url.pathname.match(/^\\/(\\d{5,})\\/?$/);
        if (match) {
          return match[1];
        }
      } catch (hrefError) {
        // skip malformed hrefs
      }
    }
    return null;
  }

  const roots = new Map();
  const anchors = Array.from(document.querySelectorAll(${JSON.stringify(AD_LIBRARY_RESULT_SELECTOR)}));
  for (const anchor of anchors) {
    if (!(anchor instanceof HTMLAnchorElement)) {
      continue;
    }
    const href = anchor.href || anchor.getAttribute("href") || "";
    const idMatch = href.match(/[?&]id=(\\d+)/);
    if (!idMatch) {
      continue;
    }
    const root =
      anchor.closest('[role="article"]') ||
      anchor.closest("article") ||
      anchor.closest("[data-ad-preview]") ||
      anchor.parentElement;
    if (root && !roots.has(idMatch[1])) {
      roots.set(idMatch[1], root);
    }
  }
  const countLibraryIds = (el) => ((renderedText(el) || "").match(/Library ID: \\d+/g) || []).length;
  const labels = Array.from(document.querySelectorAll("div, span")).filter(
    (el) => el.children.length === 0 && /^Library ID: \\d+$/.test((renderedText(el) || "").trim()),
  );
  for (const label of labels) {
    const idMatch = (renderedText(label) || "").match(/(\\d+)/);
    if (!idMatch || roots.has(idMatch[1])) {
      continue;
    }
    let node = label;
    while (
      node.parentElement &&
      countLibraryIds(node.parentElement) === 1 &&
      (renderedText(node.parentElement) || "").length < 8000
    ) {
      node = node.parentElement;
    }
    // Skip bare "Library ID: N" leaves that never climbed into a real card:
    // registering them emits ghost cards that suppress the rendered-text
    // fallback (mirrors the session extractor's guard).
    const climbedText = renderedText(node) || "";
    const looksLikeAdCard =
      node !== label &&
      climbedText.split("\\n").some((line) => /^\\s*Sponsored\\s*$/i.test(line));
    if (looksLikeAdCard) {
      roots.set(idMatch[1], node);
    }
  }

  const cards = Array.from(roots.entries())
    .map(([libraryId, card]) => {
      const externalLink = resolveExternalLink(card);
      const text = normalizeText(renderedText(card));
      const advertiser = (() => {
        const isUiLine = (value) =>
          /^(?:Active|Inactive|Library ID:\\s*\\d+|Started running on\\b.*|Platforms|This ad has multiple versions|\\d+\\s+ads?\\s+use this creative and text|Menu|See (?:ad|summary) details|View ad details|Meta Ad Library result|Instagram|Facebook|Messenger|WhatsApp|Audience Network|Threads|Shop now|Learn more|Sign up|Apply now|Book now|Contact us)$/i.test(
            value,
          ) || /^\\d+:\\d+\\s*\\/\\s*\\d+/.test(value);
        const lines = text.split("\\n");
        const sponsoredIndex = lines.findIndex((line) => /^Sponsored$/i.test(line));
        if (sponsoredIndex < 0) {
          return pageNameByLibraryId.get(libraryId) || null;
        }
        const beforeSponsored = new Set(
          lines.slice(0, sponsoredIndex).map((line) => line.replace(/\\s+/g, " ").trim()),
        );
        const candidates = [
          ...new Set(
            Array.from(card?.querySelectorAll("strong, h3, h4, [data-advertiser-name]") ?? [])
              .map((element) => normalizeText(renderedText(element)).replace(/\\s+/g, " ").trim())
              .filter((value) => value && beforeSponsored.has(value) && !isUiLine(value)),
          ),
        ];
        if (candidates.length === 1) return candidates[0];
        // Logged-out grid cards frequently render the advertiser as a plain
        // text line directly above "Sponsored" with no <strong>/<h3> wrapper,
        // so the element scan finds nothing. Recover the closest name-like,
        // non-UI line before "Sponsored" (bounded so headlines/body never leak
        // in as a false advertiser name). Then fall back to Relay page_name.
        if (candidates.length === 0) {
          const priorLines = lines
            .slice(0, sponsoredIndex)
            .map((line) => line.replace(/\\s+/g, " ").trim())
            .filter(
              (value) =>
                value &&
                value.length > 1 &&
                value.length <= 60 &&
                value.split(" ").length <= 6 &&
                !isUiLine(value),
            );
          const nearest = priorLines[priorLines.length - 1];
          if (nearest) return nearest;
        }
        return pageNameByLibraryId.get(libraryId) || null;
      })();
      const headline = card?.querySelector("h1, h2, h3, [data-headline]")?.textContent ?? null;
      const cta = pickCtaFromCard(card);
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

      const variantMatch = text.match(/(\\d+) ads use this creative and text/i);
      const media = pickCreativeMediaFromCard(card);

      return {
        libraryId,
        advertiser: normalizeText(advertiser),
        body: text,
        previewHeadline: normalizeText(headline),
        previewSubhead: null,
        cta: normalizeText(cta),
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=" + libraryId,
        landingPageUrl: externalLink,
        platforms,
        active: (() => {
          const status = text
            .split("\\n")
            .map((line) => line.trim().toLowerCase())
            .find((line) => line === "active" || line === "inactive");
          return status === "active" ? true : status === "inactive" ? false : null;
        })(),
        startedRunning,
        imageUrl: media.imageUrl,
        hasVideo: media.hasVideo,
        variantCount: variantMatch ? Number.parseInt(variantMatch[1], 10) : null,
        pageId: pageIdByLibraryId.get(libraryId) || numericPageIdFromCard(card),
      };
    })
    .filter(Boolean);

  function isCreativeCdnHost(host) {
    const lower = String(host || "").toLowerCase();
    return lower.includes("fbcdn") || lower.includes("scontent");
  }

  // FIX-14: the first button/[role="button"] in a card is Ad Library chrome
  // (the overflow "Menu"/"Open Drop-down" button, "See ad details"), so a
  // plain first-match picks chrome as the ad's CTA. Filter chrome by exact
  // label, prefer a real CTA verb, then fall back to the first remaining
  // candidate. Mirrors pickCtaFromCard in the session extractor.
  function pickCtaFromCard(cardRoot) {
    if (!cardRoot) {
      return null;
    }
    const candidates = Array.from(
      cardRoot.querySelectorAll(
        'button, [role="button"], [data-cta], a[aria-label*="Shop"], a[aria-label*="Learn"]',
      ),
    );
    const labelOf = (element) =>
      (element.getAttribute("aria-label") || renderedText(element) || "")
        .replace(/\\u00a0/g, " ")
        .split("\\n")
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
    const isChromeLabel = (value) =>
      /^(?:menu|open drop-down|see ad details|see summary details|view ad details|meta ad library result|more|report ad)$/i.test(
        value,
      );
    const isCtaVerb = (value) =>
      /^(?:shop now|learn more|sign up|apply now|book now|contact us)$/i.test(
        value,
      );
    const usable = candidates.filter(
      (element) => !isChromeLabel(labelOf(element)),
    );
    if (usable.length === 0) {
      return null;
    }
    const verbCta = usable.find((element) => isCtaVerb(labelOf(element)));
    return (verbCta || usable[0]).textContent || null;
  }

  function resolveExternalLink(cardRoot) {
    if (!cardRoot) {
      return null;
    }
    const links = Array.from(cardRoot.querySelectorAll("a[href]"));
    for (const link of links) {
      const href = (link instanceof HTMLAnchorElement ? link.href : link.getAttribute("href")) || "";
      if (!/^https?:/i.test(href)) {
        continue;
      }
      let parsed;
      try {
        parsed = new URL(href);
      } catch {
        continue;
      }
      const host = parsed.hostname.toLowerCase();
      if (host === "l.facebook.com" || host === "lm.facebook.com") {
        const target = parsed.searchParams.get("u");
        if (!target) {
          continue;
        }
        try {
          const decoded = new URL(target);
          if (!/(^|\\.)facebook\\.com$|(^|\\.)instagram\\.com$|(^|\\.)fb\\.com$/i.test(decoded.hostname)) {
            return decoded.toString();
          }
        } catch {
          // skip undecodable redirect targets
        }
        continue;
      }
      if (!/facebook\\.com/i.test(host)) {
        return parsed.toString();
      }
    }
    return null;
  }

  function pickCreativeMediaFromCard(cardRoot) {
    if (!cardRoot) {
      return { imageUrl: null, hasVideo: false };
    }
    const videos = Array.from(cardRoot.querySelectorAll("video"));
    const hasVideo = videos.length > 0;
    for (const video of videos) {
      const poster = video.getAttribute("poster") || "";
      if (!poster) {
        continue;
      }
      try {
        const url = new URL(poster, location.origin);
        if (isCreativeCdnHost(url.hostname)) {
          return { imageUrl: url.toString(), hasVideo: true };
        }
      } catch {
        // skip invalid poster URLs
      }
    }
    const images = Array.from(cardRoot.querySelectorAll("img"));
    let bestUrl = null;
    let bestArea = -1;
    let firstCdnUrl = null;
    let measuredAny = false;
    for (const img of images) {
      const raw = img.currentSrc || img.src || img.getAttribute("src") || "";
      if (!raw || String(raw).startsWith("data:")) {
        continue;
      }
      let absolute = null;
      try {
        const url = new URL(raw, location.origin);
        if (!isCreativeCdnHost(url.hostname)) {
          continue;
        }
        absolute = url.toString();
      } catch {
        continue;
      }
      if (!firstCdnUrl) {
        firstCdnUrl = absolute;
      }
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      if (width > 0 || height > 0) {
        measuredAny = true;
      }
      if (width > 0 && height > 0 && width <= 64 && height <= 64) {
        continue;
      }
      const area = (width || 1) * (height || 1);
      if (area > bestArea) {
        bestArea = area;
        bestUrl = absolute;
      }
    }
    if (!bestUrl) {
      const styled = Array.from(cardRoot.querySelectorAll("div, span, a"));
      for (const el of styled) {
        if ((el.offsetWidth || 0) < 100) {
          continue;
        }
        const backgroundImage = window.getComputedStyle(el).backgroundImage || "";
        const match = backgroundImage.match(/url\\("(.+?)"\\)/);
        if (!match) {
          continue;
        }
        try {
          const url = new URL(match[1], location.origin);
          if (!isCreativeCdnHost(url.hostname)) {
            continue;
          }
          bestUrl = url.toString();
          break;
        } catch {
          // skip invalid background URLs
        }
      }
    }
    return { imageUrl: bestUrl || (measuredAny ? null : firstCdnUrl), hasVideo };
  }
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

function parseQuickActionExtractionPayload(
  content: string,
): QuickActionExtractionPayload {
  const markerIndex = [
    `id="${QUICK_ACTION_EXTRACTION_SCRIPT_ID}"`,
    `id='${QUICK_ACTION_EXTRACTION_SCRIPT_ID}'`,
  ]
    .map((marker) => content.indexOf(marker))
    .find((index) => index >= 0);
  const scriptStart =
    markerIndex !== undefined ? content.indexOf(">", markerIndex) : -1;
  const scriptEnd =
    scriptStart >= 0 ? content.indexOf("</script>", scriptStart) : -1;
  const payloadText =
    scriptStart >= 0 && scriptEnd > scriptStart
      ? content.slice(scriptStart + 1, scriptEnd).trim()
      : null;

  const renderedHtmlPayload =
    extractQuickActionPayloadFromRenderedHtml(content);
  const withRelayIdentities = (
    payload: QuickActionExtractionPayload,
  ): QuickActionExtractionPayload => ({
    ...payload,
    // Server-side Relay re-parse is the choke point that turns empty
    // DOM advertisers into confirmed page_name identities for every
    // quick-action / browserless path that still has the page HTML.
    cards: applyRelayPageIdentitiesToCards(
      payload.cards,
      extractAdArchivePageIdentities(content),
    ),
  });
  if (!payloadText) {
    if (
      renderedHtmlPayload.cards.length > 0 ||
      renderedHtmlPayload.loginWall ||
      renderedHtmlPayload.noResults ||
      renderedHtmlPayload.rateLimited
    ) {
      return withRelayIdentities(renderedHtmlPayload);
    }

    throw new CommercialDiscoveryError(
      "Browser Run Quick Actions returned no extraction payload.",
      "selector_drift",
    );
  }

  try {
    const parsed = JSON.parse(
      payloadText.replace(/<\\\//g, "</"),
    ) as QuickActionExtractionPayload;
    if (
      (!Array.isArray(parsed.cards) || parsed.cards.length === 0) &&
      renderedHtmlPayload.cards.length > 0
    ) {
      return withRelayIdentities(renderedHtmlPayload);
    }

    return withRelayIdentities(parsed);
  } catch {
    if (
      renderedHtmlPayload.cards.length > 0 ||
      renderedHtmlPayload.loginWall ||
      renderedHtmlPayload.noResults ||
      renderedHtmlPayload.rateLimited
    ) {
      return withRelayIdentities(renderedHtmlPayload);
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

  return {
    ...extractQuickActionPayloadFromScrape(scraped.elements),
    browserMsUsed: scraped.browserMsUsed ?? null,
  };
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
    const text =
      stripHtml(html) || element.text?.trim() || "Meta Ad Library result";
    const lineText = stripHtmlPreservingLines(html);
    const media = extractCreativeMediaFromHtml(html);

    cards.push({
      libraryId,
      advertiser: null,
      body: text,
      previewHeadline: element.text?.trim() || truncateTextSafe(text, 120),
      previewSubhead: null,
      cta: inferCta(text),
      adSnapshotUrl: absolutizeMetaAdUrl(href),
      landingPageUrl: extractExternalLink(html),
      platforms: inferPlatforms(text),
      active: readStandaloneActiveStatus(lineText),
      startedRunning: findStartedRunningLine(lineText),
      imageUrl: media.imageUrl,
      hasVideo: media.hasVideo,
    });
  }

  return {
    cards,
    loginWall: false,
    noResults: false,
    rateLimited: false,
  };
}

function extractHrefFromScrapeElement(
  element: BrowserRunQuickActionScrapeElement,
) {
  const attrHref = element.attributes?.find(
    (attribute) => attribute.name?.toLowerCase() === "href",
  )?.value;
  if (attrHref) {
    return decodeHtmlEntity(attrHref);
  }

  const htmlHref = element.html?.match(/\bhref=(["'])(.*?)\1/i)?.[2];
  return htmlHref ? decodeHtmlEntity(htmlHref) : null;
}

function extractQuickActionPayloadFromRenderedHtml(
  content: string,
): QuickActionExtractionPayload {
  return parseRenderedMetaLibraryHtml(content);
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

function buildRateLimitMessage(timeUntilNextAllowedBrowserAcquisition: number) {
  const retryAfterSeconds = normalizeRetryAfterSeconds(
    timeUntilNextAllowedBrowserAcquisition,
  );
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

/** Exported for unit tests that assert image/media field mapping. */
export function normalizeExtractedCard(
  card: ExtractedAdCard,
  query: NormalizedSavedQuery,
): AdRecord {
  // Never back-fill the advertiser with the customer's search term or the CTA
  // with a guessed default: presenting extraction gaps as scraped facts can
  // attribute ads to brands that never ran them. Empty means "unconfirmed"
  // and the display layer labels it that way.
  const advertiser = card.advertiser || "";
  const extractedBody = extractAdCopyFromCardText(card.body ?? "");
  const body =
    normalizeComparableText(extractedBody) ===
    normalizeComparableText(advertiser)
      ? ""
      : extractedBody;
  const rawPreviewHeadline = card.previewHeadline || "";
  const headlineIsUsable = isUsableAnalysisHeadline(
    rawPreviewHeadline,
    advertiser,
  );
  const previewHeadline = headlineIsUsable
    ? rawPreviewHeadline
    : deriveDisplayHeadline(body) || advertiser;
  // truncateTextSafe keeps the subhead well-formed: a plain slice at an emoji
  // boundary leaves a lone surrogate that persists as U+FFFD ("�") on /search.
  const previewSubhead = card.previewSubhead || truncateTextSafe(body, 120);
  const analysisHeadline = headlineIsUsable ? rawPreviewHeadline : "";
  const { hook, offer } = resolveHookAndOffer({
    body,
    previewHeadline: analysisHeadline,
  });
  const creativeImageUrl = card.imageUrl?.trim() || null;
  const hasVideo = Boolean(card.hasVideo);
  const creativeFormatHint = hasVideo
    ? ("video" as const)
    : creativeImageUrl
      ? ("image" as const)
      : undefined;
  const firstSeenAt = parseStartedRunningDate(card.startedRunning ?? null);
  const format = hasVideo
    ? ("video" as const)
    : creativeImageUrl
      ? ("image" as const)
      : ("unknown" as const);
  const destinationType = inferDestinationType(card.landingPageUrl);
  const landingPageUrl = card.landingPageUrl;
  const platforms = card.platforms;
  const active = card.active ?? query.filters.status !== "inactive";
  // FIX-14: Meta Ad Library card chrome (the "Menu" overflow button, "See ad
  // details", …) can be captured as the ad CTA by DOM extraction. Drop pure
  // chrome CTA values here so no extraction path renders them on public
  // search; real advertiser CTAs always pass (exact match only).
  const cta = isAdLibraryChromeCta(card.cta) ? "" : (card.cta || "");

  return withStructuredAnalysis({
    metaAdId: card.libraryId,
    advertiser,
    advertiserPageId: card.pageId ?? null,
    body,
    previewHeadline,
    previewSubhead,
    hook,
    offer,
    cta,
    format,
    languageLabel: inferLanguageLabel(`${previewHeadline} ${body}`),
    destinationType,
    landingPageUrl,
    adSnapshotUrl:
      card.adSnapshotUrl ||
      `https://www.facebook.com/ads/library/?id=${card.libraryId}`,
    countries: [query.filters.country || "all"],
    platforms,
    // Meta publishes the ad's start date on every Ad Library card ("Started
    // running on <date>"). Treat it as firstSeenAt exactly like the Meta API
    // path treats ad_delivery_start_time; unparseable stays an honest null.
    firstSeenAt,
    lastSeenAt: null,
    active,
    activeStatusObserved: card.active !== null,
    researchSummary:
      "Captured from the public Meta Ad Library via Browser Run and normalized into Five to Nine’s analysis schema.",
    source: "meta_library_browser",
    creativeImageUrl,
    creativeFormatHint,
    variantCount: card.variantCount ?? null,
  });
}

/**
 * A normalized ad carries usable content when it has any of the fields a
 * customer actually sees: advertiser, ad copy, a usable headline, or a
 * creative. Content-free "ghost" cards (e.g. a DOM discovery pass that only
 * captured a bare "Library ID: N" label) fail this check so they can be dropped
 * before they suppress the rendered-text fallback or reach the customer.
 */
export function adHasUsableContent(ad: AdRecord): boolean {
  return Boolean(
    ad.advertiser?.trim() ||
      ad.body?.trim() ||
      ad.previewHeadline?.trim() ||
      ad.creativeImageUrl?.trim(),
  );
}

/**
 * Prefer cards whose scraped advertiser name matches the queried brand before
 * unrelated advertisers. A keyword search for "nike" surfaces resellers,
 * marketplaces, and lookalikes alongside Nike's own ads; this stable reorder
 * floats the real brand to the top without dropping anything or inventing an
 * advertiser identity (it only reads the advertiser name discovery already
 * captured). No-op when the query is empty or already page-scoped.
 */
export function rankExtractedCardsByAdvertiserMatch(
  cards: ExtractedAdCard[],
  query: NormalizedSavedQuery,
): ExtractedAdCard[] {
  if (normalizeNumericPageId(query.filters.pageId)) {
    return cards;
  }
  const term = normalizeBrandMatchToken(query.filters.query);
  if (!term || term.length < 2) {
    return cards;
  }
  return cards
    .map((card, index) => ({ card, index }))
    .sort((left, right) => {
      const leftRank = advertiserMatchesBrandTerm(left.card.advertiser, term)
        ? 0
        : 1;
      const rightRank = advertiserMatchesBrandTerm(right.card.advertiser, term)
        ? 0
        : 1;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.card);
}

function normalizeBrandMatchToken(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function advertiserMatchesBrandTerm(
  advertiser: string | null | undefined,
  term: string,
) {
  const normalizedAdvertiser = normalizeBrandMatchToken(advertiser);
  if (!normalizedAdvertiser) {
    return false;
  }
  // Bidirectional containment on the alphanumeric-only forms: "Nike" matches
  // "nike", and "Nike, Inc." (→ "nikeinc") still matches "nike". Guard the
  // reverse direction so a 2-char query can't match every advertiser.
  return (
    normalizedAdvertiser.includes(term) ||
    (term.length >= 4 && term.includes(normalizedAdvertiser))
  );
}

/** Exported for unit tests that assert Ad Library URL filter params. */
export function normalizeAndFilterExtractedCards(
  cards: ExtractedAdCard[],
  query: NormalizedSavedQuery,
) {
  return rankExtractedCardsByAdvertiserMatch(cards, query)
    .filter((card) => {
      if (query.filters.status === "active") {
        return card.active !== false;
      }
      if (query.filters.status === "inactive") {
        return card.active !== true;
      }
      return true;
    })
    .map((card) => normalizeExtractedCard(card, query))
    .filter((ad) => {
      if (query.filters.status === "active") {
        return ad.active;
      }
      if (query.filters.status === "inactive") {
        return !ad.active;
      }
      return true;
    });
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function deriveDisplayHeadline(body: string) {
  return (
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function isUsableAnalysisHeadline(headline: string, advertiser: string) {
  const normalized = headline.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedAdvertiser = advertiser
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return Boolean(
    normalized &&
    normalized !== normalizedAdvertiser &&
    !/^(?:view|see) (?:ad|summary) details$/.test(normalized) &&
    normalized !== "meta ad library result",
  );
}

export function buildSearchUrl(query: NormalizedSavedQuery) {
  const params = new URLSearchParams();
  params.set("active_status", mapActiveStatusParam(query.filters.status));
  params.set("ad_type", "all");
  params.set("country", countryCode(query.filters.country));
  params.set("is_targeted_country", "false");
  params.set("media_type", mapMediaTypeParam(query.filters.creativeType));

  // Verified page-scoped scan: when discovery has resolved the advertiser's
  // exact Meta Page id, scope the scrape to that page (`view_all_page_id`)
  // instead of a keyword guess. This is what makes mega-brand results (Nike,
  // Amazon, …) return the brand's own ads instead of resellers and keyword
  // junk. Only ever set from a verified match — never a search term.
  const pageId = normalizeNumericPageId(query.filters.pageId);
  if (pageId) {
    params.set("search_type", "page");
    params.set("view_all_page_id", pageId);
    return `https://www.facebook.com/ads/library/?${params.toString()}`;
  }

  params.set(
    "search_type",
    query.mode === "advertiser" ? "keyword_exact_phrase" : "keyword_unordered",
  );
  params.set("q", query.filters.query || "");

  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

function mapActiveStatusParam(
  status: NormalizedSavedQuery["filters"]["status"] | undefined,
) {
  if (status === "active") {
    return "active";
  }
  if (status === "inactive") {
    return "inactive";
  }
  return "all";
}

function mapMediaTypeParam(
  creativeType: NormalizedSavedQuery["filters"]["creativeType"] | undefined,
) {
  if (creativeType === "image") {
    return "image";
  }
  if (creativeType === "video") {
    return "video";
  }
  if (creativeType === "carousel") {
    return "all";
  }
  return "all";
}

function countryCode(country: string | undefined) {
  if (!country) {
    return "ALL";
  }

  return isoFromCountryName(country) ?? country.toUpperCase();
}
