/**
 * Per-route Open Graph social cards (issue #1572).
 *
 * The site-wide generic `og-image.png` is shared across every page, so a
 * programmatic buyer surface (`/ads/:domain`, `/timeline/:domain`,
 * `/compare/*`, `/switch/*`, `/sneaker-resale`,
 * `/competitor-monitoring`) gets an unbranded link card
 * indistinguishable from any other 0509 page. This module generates a
 * page-specific SVG card for each of those surfaces and serves it under
 * `/social-card/...` from `workers/app.ts`, so each surface can point its
 * `og:image` at a distinct branded card instead of the generic PNG.
 *
 * This extends the existing SVG og-image machinery (`SOCIAL_CARD_SVG` in
 * `app/lib/seo.ts`) rather than introducing a new image-generation service:
 * every card is a 1200×630 SVG built from the same gradient + text recipe,
 * parameterised by the surface's own data. The ads card carries the brand
 * display name and Ad Aggression Score as query params (`n`, `s`) set by the
 * `/ads/:domain` route's loader, so the renderer stays stateless — no D1
 * read, no per-request lookup. The compare/switch/cluster cards derive their
 * text from the URL slug alone.
 *
 * SVG og:images are not rendered by every social scraper (WhatsApp, Slack, X
 * refuse SVG — see the comment on `SOCIAL_IMAGE_PATH` in seo.ts). The legacy
 * `/social-card.svg` stays served for cached links; these per-route cards are
 * the forward path the issue ships now, and the verify contract is that each
 * programmatic surface stamps a `og:image` URL distinct from the generic
 * `og-image.png`.
 */

import { brandCategoryFromSlug } from "~/lib/brand-categories";

const SITE_NAME = "Five to Nine";

/** Gradient reused from the site-wide `SOCIAL_CARD_SVG` in seo.ts. */
const CARD_GRADIENT_DEFS = `<defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#52c9df"/>
      <stop offset="0.42" stop-color="#7f5cff"/>
      <stop offset="0.72" stop-color="#ff5f74"/>
      <stop offset="1" stop-color="#f9c37b"/>
    </linearGradient>
  </defs>`;

/** XML-escape text for safe embedding in SVG `<text>` content. */
function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Truncate a headline so it never overflows the card's text box. */
function clampLine(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}\u2026`;
}

/**
 * Shared 1200×630 card frame: gradient background, the "Five to Nine" wordmark
 * top-left, and a headline + subline pair. Callers supply the two text lines so
 * each surface shapes its own card without re-inlining the SVG skeleton.
 */
function renderCard(input: { headline: string; subline: string }): string {
  const headline = clampLine(escapeSvgText(input.headline), 46);
  const subline = clampLine(escapeSvgText(input.subline), 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">${headline}</title>
  <desc id="desc">${subline}</desc>
  ${CARD_GRADIENT_DEFS}
  <rect width="1200" height="630" fill="url(#sky)"/>
  <path d="M0 420 L1200 300 L1200 630 L0 630 Z" fill="#fff"/>
  <g font-family="Inter, Arial, sans-serif">
    <text x="86" y="92" fill="#fff" font-size="42" font-weight="800">${SITE_NAME}</text>
    <text x="86" y="250" fill="#07111a" font-size="68" font-weight="800">${headline}</text>
    <text x="88" y="330" fill="#344052" font-size="32" font-weight="600">${subline}</text>
  </g>
</svg>
`;
}

/** Competitor product display name for each `/compare/:tool` slug. */
const COMPARE_PRODUCT_NAMES: Readonly<Record<string, string>> = {
  panoramata: "Panoramata",
  "foreplay-spyder": "Foreplay Spyder",
  "visualping-ad-libraries": "Visualping",
  "meta-ad-library": "Meta Ad Library",
  spyland: "Spyland",
  pulzifi: "Pulzifi",
  adspyder: "AdSpyder",
  adspy: "AdSpy",
  foreplay: "Foreplay",
  visualping: "Visualping",
  "visualping-ad-library": "Visualping Ad Library",
};

/** Competitor product display name for each `/switch/:tool` slug. */
const SWITCH_PRODUCT_NAMES: Readonly<Record<string, string>> = {
  panoramata: "Panoramata",
  visualping: "Visualping",
};

/** Cluster card headlines for the standalone buyer surfaces. */
const CLUSTER_HEADLINES: Readonly<Record<string, { headline: string; subline: string }>> = {
  "sneaker-resale": {
    headline: "Sneaker resale ads",
    subline: "See the drop they posted before you price yours.",
  },
  "competitor-monitoring": {
    headline: "Competitor monitoring",
    subline: "Meta ads and landing pages, with source-linked proof.",
  },
};

export type SocialCardKind =
  | "ads"
  | "timeline"
  | "compare"
  | "switch"
  | "cluster"
  | "brand";

export interface ParsedSocialCardPath {
  kind: SocialCardKind;
  /** `domain` for ads/timeline, tool slug for compare/switch, cluster slug for cluster, category slug for brand. */
  slug: string;
}

/**
 * Recognise a `/social-card/...` pathname. Returns the parsed kind + slug, or
 * `null` when the pathname is not a social card path. The ads/timeline card
 * slugs are the raw `:domain` segment (may contain dots, e.g. `nike.com`);
 * compare/switch slugs are single segments; cluster slugs are the two
 * standalone surfaces; brand slugs are the `/brands/:category` landing
 * pages (resolved via `brandCategoryFromSlug` in renderSocialCard).
 */
/**
 * Safe `decodeURIComponent`: returns `null` instead of throwing `URIError` on
 * malformed percent-encoding (e.g. `%zz`). Malformed slugs then fall through to
 * the React Router 404 instead of becoming unauthenticated 500s on a public,
 * pre-rate-limit route (issue #2465).
 */
function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseSocialCardPathname(pathname: string): ParsedSocialCardPath | null {
  if (!pathname.startsWith("/social-card/")) return null;
  const rest = pathname.slice("/social-card/".length);

  // Ads and timeline cards are rasterized to PNG (issue #2089): the canonical
  // URL is `.png` and the legacy `.svg` URL is kept as an alias that also
  // serves PNG bytes, so cached links and the issue's termination probe keep
  // working. Compare/switch/cluster cards stay SVG (issue #2083's scope).
  const adsMatch = rest.match(/^ads\/(.+)\.(?:svg|png)$/);
  const adsSlug = adsMatch ? safeDecodeURIComponent(adsMatch[1]) : null;
  if (adsMatch && adsSlug !== null) return { kind: "ads", slug: adsSlug };

  const timelineMatch = rest.match(/^timeline\/(.+)\.(?:svg|png)$/);
  const timelineSlug = timelineMatch ? safeDecodeURIComponent(timelineMatch[1]) : null;
  if (timelineMatch && timelineSlug !== null) return {
    kind: "timeline",
    slug: timelineSlug,
  };

  const compareMatch = rest.match(/^compare\/([^/]+)\.svg$/);
  if (compareMatch) return { kind: "compare", slug: compareMatch[1] };

  const switchMatch = rest.match(/^switch\/([^/]+)\.svg$/);
  if (switchMatch) return { kind: "switch", slug: switchMatch[1] };

  const brandMatch = rest.match(/^brand\/([^/]+)\.svg$/);
  if (brandMatch) return { kind: "brand", slug: brandMatch[1] };

  const clusterMatch = rest.match(/^([^/]+)\.svg$/);
  if (clusterMatch && CLUSTER_HEADLINES[clusterMatch[1]]) {
    return { kind: "cluster", slug: clusterMatch[1] };
  }

  return null;
}

/** Build the SVG body for a parsed card path, given the request for query params. */
function renderSocialCard(parsed: ParsedSocialCardPath, request: Request): string | null {
  if (parsed.kind === "ads") {
    const params = new URL(request.url).searchParams;
    const brandName = params.get("n") ?? parsed.slug;
    const scoreRaw = params.get("s");
    const score = scoreRaw !== null && /^\d+$/.test(scoreRaw) ? Number(scoreRaw) : null;
    const headline = clampLine(brandName, 34);
    const subline =
      score !== null
        ? `Ad Aggression Score ${score} · ${SITE_NAME}`
        : `Meta ads tracking · ${SITE_NAME}`;
    return renderCard({ headline, subline });
  }

  if (parsed.kind === "timeline") {
    // Same stateless recipe as the ads card: the brand display name rides in
    // the `n` query param stamped by the /timeline/:domain route's loader, so
    // the renderer never needs a second D1 read. Fall back to the slug (the
    // raw domain) when `n` is absent so a raw card URL still renders.
    const params = new URL(request.url).searchParams;
    const brandName = params.get("n") ?? parsed.slug;
    return renderCard({
      headline: clampLine(brandName, 34),
      subline: `offer timeline — what their landing page said, with proof · ${SITE_NAME}`,
    });
  }

  if (parsed.kind === "compare") {
    const product = COMPARE_PRODUCT_NAMES[parsed.slug];
    if (!product) return null;
    return renderCard({
      headline: `${SITE_NAME} vs ${product}`,
      subline: "Competitor monitoring comparison",
    });
  }

  if (parsed.kind === "switch") {
    const product = SWITCH_PRODUCT_NAMES[parsed.slug];
    if (!product) return null;
    return renderCard({
      headline: `Switch from ${product}`,
      subline: `Move to ${SITE_NAME}`,
    });
  }

  if (parsed.kind === "brand") {
    // Resolve the curated label from the category slug. Unknown or the
    // "More brands" placeholder resolve to null here, so the card 404s the
    // same way the /brands/:category route will (the unclassified fallback
    // bucket has no landing page).
    const category = brandCategoryFromSlug(parsed.slug);
    if (!category) return null;
    return renderCard({
      headline: `${category} Meta ads`,
      subline: `Competitor Meta ad libraries \u00b7 ${SITE_NAME}`,
    });
  }

  const cluster = CLUSTER_HEADLINES[parsed.slug];
  if (!cluster) return null;
  return renderCard(cluster);
}

/**
 * Resolve a `/social-card/...` request to a public file response body, or
 * `null` when the pathname is not a recognised social card. Mirrors the shape
 * returned by `publicSeoFileForPathname` so `workers/app.ts` can serve it
 * through the same `publicFileResponse` helper.
 */
export interface SocialCardFile {
  body: string;
  contentType: string;
  cacheControl: string;
  /**
   * Card kind, so the worker can rasterize the ads/timeline cards to PNG
   * (issue #2089) while leaving the compare/switch/cluster cards as SVG
   * (issue #2083's scope).
   */
  kind: SocialCardKind;
}

export function publicSocialCardForRequest(request: Request): SocialCardFile | null {
  const url = new URL(request.url);
  const parsed = parseSocialCardPathname(url.pathname);
  if (!parsed) return null;
  const body = renderSocialCard(parsed, request);
  if (!body) return null;
  return {
    body,
    contentType: "image/svg+xml; charset=utf-8",
    // Ads and timeline cards carry brand query params, so a shorter cache
    // keeps the card in step with the page. The static compare/switch/cluster
    // cards are stable for a day.
    cacheControl:
      parsed.kind === "ads" || parsed.kind === "timeline"
        ? "public, max-age=3600"
        : "public, max-age=86400",
    kind: parsed.kind,
  };
}
