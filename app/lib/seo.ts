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

const SITEMAP_PATHS = [
  "/",
  "/compare/magicbrief",
  "/help",
  "/docs",
  "/api/docs",
  "/status",
  "/changelog",
  "/trust",
  "/privacy",
  "/terms",
] as const;

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_PATHS.map((path) => `  <url><loc>${canonicalUrl(path)}</loc></url>`).join("\n")}
</urlset>
`;

const ROBOTS_TXT = `User-agent: *
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
    <text x="88" y="418" fill="#344052" font-size="34" font-weight="600">Watch ads and landing pages with proof.</text>
    <rect x="780" y="118" width="340" height="330" rx="34" fill="#ffffff" opacity="0.9"/>
    <text x="818" y="180" fill="#07111a" font-size="28">Signal desk</text>
    <path d="M820 260 L884 230 L944 246 L1014 186 L1080 206" fill="none" stroke="#635bff" stroke-width="7" stroke-linecap="round"/>
    <text x="818" y="340" fill="#425466" font-size="26" font-weight="700">Offer changed</text>
    <text x="818" y="386" fill="#425466" font-size="26" font-weight="700">Landing page saved</text>
    <text x="818" y="432" fill="#425466" font-size="26" font-weight="700">Proof ready</text>
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
    return {
      body: SITEMAP_XML,
      contentType: "application/xml; charset=utf-8",
      cacheControl: "public, max-age=3600",
    };
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
