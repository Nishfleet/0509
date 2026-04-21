import puppeteer from "@cloudflare/puppeteer";

import { inferDestinationType, inferLanguageLabel, withStructuredAnalysis } from "~/lib/analysis.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  AdRecord,
  DiscoveryFailureClass,
  NormalizedSavedQuery,
  SearchResponse,
} from "~/lib/types";

const MOBILE_VIEWPORT = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

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

export class CommercialDiscoveryError extends Error {
  constructor(
    message: string,
    public readonly failureClass: DiscoveryFailureClass,
  ) {
    super(message);
    this.name = "CommercialDiscoveryError";
  }
}

export async function searchMetaLibraryByBrowser(
  env: AppEnv,
  query: NormalizedSavedQuery,
): Promise<SearchResponse> {
  if (!env.BROWSER) {
    throw new CommercialDiscoveryError(
      "Browser Run is not configured for commercial discovery.",
      "browser_unavailable",
    );
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent(MOBILE_USER_AGENT);
    await page.setViewport(MOBILE_VIEWPORT);
    await page.goto(buildSearchUrl(query), {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });

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
  } catch (error) {
    if (error instanceof CommercialDiscoveryError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Browser discovery failed.";
    const normalizedMessage = message.toLowerCase();
    const failureClass: DiscoveryFailureClass = normalizedMessage.includes("rate limit") ||
      normalizedMessage.includes("429")
      ? "rate_limited"
      : normalizedMessage.includes("timeout")
        ? "timeout"
        : "browser_launch_failed";
    throw new CommercialDiscoveryError(message, failureClass);
  } finally {
    await browser?.close().catch(() => undefined);
  }
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
