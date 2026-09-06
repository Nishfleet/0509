const SITE_ORIGIN = "https://0509.io";
const SITE_NAME = "Five to Nine";
// PNG, not SVG: most social scrapers (WhatsApp, Slack, X, iMessage) refuse
// SVG og:images. The legacy /social-card.svg stays served for cached links.
const SOCIAL_IMAGE_PATH = "/og-image.png";
const SOCIAL_IMAGE_URL = `${SITE_ORIGIN}${SOCIAL_IMAGE_PATH}`;
const LEGACY_SOCIAL_CARD_PATH = "/social-card.svg";
const SOCIAL_IMAGE_ALT = "Five to Nine competitor offer monitoring preview";

export function canonicalUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const pathOnly = normalizedPath.split(/[?#]/)[0] ?? "/";
  const withoutTrailingSlash =
    pathOnly === "/" ? pathOnly : pathOnly.replace(/\/+$/, "");

  return `${SITE_ORIGIN}${withoutTrailingSlash || "/"}`;
}

export function canonicalLinks(pathname: string) {
  return [{ rel: "canonical", href: canonicalUrl(pathname) }];
}

export function publicSeoMeta(input: {
  title: string;
  description: string;
  pathname: string;
}) {
  const url = canonicalUrl(input.pathname);

  return [
    { title: input.title },
    { name: "description", content: input.description },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: "website" },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: url },
    { property: "og:image", content: SOCIAL_IMAGE_URL },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: SOCIAL_IMAGE_ALT },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: SOCIAL_IMAGE_URL },
    { name: "twitter:image:alt", content: SOCIAL_IMAGE_ALT },
  ];
}

export interface FaqJsonLdEntry {
  question: string;
  answer: string;
}

/**
 * schema.org Organization for the landing page. Deliberately minimal — no
 * price amounts anywhere in structured data (prices are live-loaded from
 * Dodo in the buyer's currency and must never be hardcoded).
 */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_ORIGIN,
  } as const;
}

/** schema.org WebSite with the public search preview as the site search action. */
export function webSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_ORIGIN,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_ORIGIN}/search?website={website}`,
      },
      "query-input": "required name=website",
    },
  } as const;
}

/**
 * schema.org FAQPage. Pass every FAQ block on the page in one call — Google
 * expects a single FAQPage entity per page, so the landing page combines the
 * product and billing FAQ entries into one mainEntity list.
 */
export function faqPageJsonLd(entries: ReadonlyArray<FaqJsonLdEntry>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: entry.answer,
      },
    })),
  } as const;
}

/**
 * schema.org WebPage for a public informational page. Deliberately plain: it
 * states only what the page already shows — its name, its description, and the
 * site it belongs to. The audit found no structured data on /help, /docs or
 * /status; this closes that without asserting anything the visible page does
 * not already say.
 *
 * The optional fields follow the same rule — they are emitted ONLY when the
 * visible page itself carries the claim:
 * - `dateModified`: the ISO timestamp of the last content update the page
 *   visibly stamps (e.g. the cached-check time on /ads/:domain). Omitted when
 *   the page has no such stamp — never invented.
 * - `aboutName`: the subject of the page when it is about a specific brand
 *   (e.g. the /ads/:domain brand pages). Must match a name the page shows.
 */
export function webPageJsonLd(input: {
  name: string;
  description: string;
  pathname: string;
  dateModified?: string;
  aboutName?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.name,
    description: input.description,
    url: canonicalUrl(input.pathname),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    ...(input.aboutName
      ? { about: { "@type": "Organization", name: input.aboutName } }
      : {}),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_ORIGIN },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_ORIGIN },
  } as const;
}

/**
 * Props for a JSON-LD <script> tag. Escapes `<` so page data can never break
 * out of the script element.
 */
export function jsonLdScriptProps(data: unknown) {
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(data).replace(/</g, "\\u003c"),
    },
  } as const;
}

export const SITEMAP_PATHS = [
  "/",
  "/search",
  "/auth/signup",
  "/compare/magicbrief",
  "/compare/meta-ad-library",
  "/help",
  "/docs",
  "/api/docs",
  "/status",
  "/changelog",
  "/trust",
  "/privacy",
  "/terms",
] as const;

// /ads/:domain BRAND PAGES ARE DELIBERATELY NOT IN THIS STATIC SITEMAP.
// They are indexable by default (PUBLIC_BRAND_PAGES_INDEXABLE unset or "1";
// "0" is the emergency noindex brake), but the honest-shell, demo-sourced,
// and stale (>7 days) states always self-noindex — see
// app/routes/ads.$domain.tsx. The dynamic set is added at render time:
//   1. Do NOT add a static "/ads/..." list here — the set must be dynamic.
//   2. Generate entries from discovery_cache_entry rows that would render the
//      indexable state (public_search route context, non-demo source, ads
//      present, fetched_at within the 7-day freshness window) so we never
//      sitemap a page that serves noindex or the "haven't checked recently"
//      shell — crawl budget should only go to pages with real cached ads.
//   3. Keep this a cache read at sitemap-render time; never let sitemap
//      generation trigger live discovery. The D1-backed generator lives in
//      app/lib/brand-page-sitemap.server.ts and feeds buildSitemapXml below;
//      any D1 failure degrades to the unchanged static sitemap.
const SITEMAP_XML = buildSitemapXml();

/**
 * Dynamic paths the sitemap builder accepts: only `/ads/<domain>` where the
 * domain matches the exact /ads/:domain validator charset, so URL output can
 * never inject markup, query strings, or fragments into the XML.
 */
const DYNAMIC_SITEMAP_PATH_PATTERN = /^\/ads\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,78}[a-zA-Z0-9])?$/;

/**
 * Build the full /sitemap.xml document: every SITEMAP_PATHS entry first (in
 * declaration order), then the dynamic brand-page paths. Dynamic paths are
 * deduplicated (including against the static list), filtered to the safe
 * `/ads/<domain>` shape, and emitted in deterministic sorted order.
 */
export function buildSitemapXml(dynamicPaths: readonly string[] = []): string {
  const staticUrls = SITEMAP_PATHS.map(
    (path) => `  <url><loc>${canonicalUrl(path)}</loc></url>`,
  );
  const dynamicUrls = [...new Set(dynamicPaths)]
    .filter(
      (path) =>
        DYNAMIC_SITEMAP_PATH_PATTERN.test(path) &&
        !(SITEMAP_PATHS as readonly string[]).includes(path),
    )
    .sort()
    .map((path) => `  <url><loc>${canonicalUrl(path)}</loc></url>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...dynamicUrls].join("\n")}
</urlset>
`;
}

/** The unchanged static sitemap — the fallback whenever D1 is unavailable. */
export function staticSitemapFile() {
  return {
    body: SITEMAP_XML,
    contentType: "application/xml; charset=utf-8",
    cacheControl: "public, max-age=3600",
  };
}

// Keep /share/ CRAWLABLE on purpose: shared reports are de-indexed via the
// `x-robots-tag: noindex, nofollow` header set in workers/security-headers.ts,
// and crawlers can only see that header if robots.txt allows the fetch.
// Adding `Disallow: /share/` here would block the crawl and let Google index
// bare /share URLs from external links anyway ("indexed, though blocked by
// robots.txt" zombies). Do NOT "fix" this by disallowing /share/.
// "Disallow: /app/" alone does not cover the bare "/app" dashboard URL
// (trailing-slash prefix rules require the slash). "/app$" closes that for
// Google/Bing, which honor the $ end-of-URL anchor; crawlers that don't
// treat the line as a harmless literal, and "/app/" still covers subpaths.
// A bare "Disallow: /app" is NOT used because it would also block any future
// public path starting with "app" (e.g. /apply).
const ROBOTS_TXT = `User-agent: *
Allow: /api/docs
Disallow: /app$
Disallow: /app/
Disallow: /export/
Disallow: /api/
# /share/ stays crawlable so crawlers can see its noindex header.
Allow: /
Sitemap: ${canonicalUrl("/sitemap.xml")}
`;

const SOCIAL_CARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">Five to Nine</title>
  <desc id="desc">Competitor offer monitoring workspace preview for Five to Nine.</desc>
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#52c9df"/>
      <stop offset="0.42" stop-color="#7f5cff"/>
      <stop offset="0.72" stop-color="#ff5f74"/>
      <stop offset="1" stop-color="#f9c37b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <path d="M0 420 L1200 300 L1200 630 L0 630 Z" fill="#fff"/>
  <g opacity="0.23" stroke="#fff" stroke-width="1">
    <path d="M0 96H1200"/><path d="M0 192H1200"/><path d="M0 288H1200"/><path d="M0 384H1200"/>
    <path d="M120 0V630"/><path d="M240 0V630"/><path d="M360 0V630"/><path d="M480 0V630"/>
    <path d="M600 0V630"/><path d="M720 0V630"/><path d="M840 0V630"/><path d="M960 0V630"/><path d="M1080 0V630"/>
  </g>
  <g font-family="Inter, Arial, sans-serif" font-weight="800">
    <text x="86" y="92" fill="#fff" font-size="42">Five to Nine</text>
    <text x="86" y="222" fill="#07111a" font-size="78">Know when competitors</text>
    <text x="86" y="318" fill="#07111a" font-size="78">change the offer.</text>
  <text x="88" y="418" fill="#344052" font-size="34" font-weight="600">Watch ads and landing pages with sources.</text>
    <rect x="780" y="118" width="340" height="330" rx="34" fill="#ffffff" opacity="0.9"/>
    <text x="818" y="180" fill="#07111a" font-size="28">Competitor changes</text>
    <path d="M820 260 L884 230 L944 246 L1014 186 L1080 206" fill="none" stroke="#635bff" stroke-width="7" stroke-linecap="round"/>
    <text x="818" y="340" fill="#425466" font-size="26" font-weight="700">Offer changed</text>
    <text x="818" y="386" fill="#425466" font-size="26" font-weight="700">Landing page saved</text>
    <text x="818" y="432" fill="#425466" font-size="26" font-weight="700">Saved evidence</text>
  </g>
</svg>
`;

export function publicSeoFileForPathname(pathname: string) {
  if (pathname === "/robots.txt") {
    return {
      body: ROBOTS_TXT,
      contentType: "text/plain; charset=utf-8",
      cacheControl: "public, max-age=3600",
    };
  }

  if (pathname === "/sitemap.xml") {
    return staticSitemapFile();
  }

  if (pathname === LEGACY_SOCIAL_CARD_PATH) {
    return {
      body: SOCIAL_CARD_SVG,
      contentType: "image/svg+xml; charset=utf-8",
      cacheControl: "public, max-age=86400",
    };
  }

  return null;
}
