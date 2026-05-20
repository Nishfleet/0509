const SITE_ORIGIN = "https://0509.in";
const SITE_NAME = "Five to Nine";
const SOCIAL_IMAGE_PATH = "/social-card.svg";
const SOCIAL_IMAGE_URL = `${SITE_ORIGIN}${SOCIAL_IMAGE_PATH}`;
const SOCIAL_IMAGE_ALT = "Five to Nine source-backed market intelligence preview";

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
    { property: "og:image:type", content: "image/svg+xml" },
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

const SITEMAP_PATHS = ["/", "/search", "/privacy", "/terms"] as const;

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
  <desc id="desc">Source-backed competitor monitoring preview for Five to Nine.</desc>
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#07111a"/>
      <stop offset="0.55" stop-color="#12302f"/>
      <stop offset="1" stop-color="#f59e0b"/>
    </linearGradient>
    <filter id="shadow" color-interpolation-filters="sRGB" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#020617" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1020" cy="80" r="210" fill="#f8f7f4" opacity="0.12"/>
  <circle cx="120" cy="590" r="220" fill="#0f9d86" opacity="0.22"/>
  <g filter="url(#shadow)">
    <rect x="86" y="82" width="1028" height="466" rx="34" fill="#fffaf0" opacity="0.94"/>
    <rect x="126" y="128" width="104" height="104" rx="28" fill="#07111a"/>
    <text x="178" y="194" text-anchor="middle" fill="#fffaf0" font-family="Georgia, serif" font-size="52" font-weight="700">09</text>
    <text x="268" y="160" fill="#0f9d86" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="6">FIVE TO NINE</text>
    <text x="126" y="318" fill="#07111a" font-family="Georgia, serif" font-size="82" font-weight="700">See what changed,</text>
    <text x="126" y="414" fill="#07111a" font-family="Georgia, serif" font-size="82" font-weight="700">with proof.</text>
    <text x="128" y="482" fill="#42505a" font-family="Arial, sans-serif" font-size="34">Competitor ads - offers - landing pages</text>
    <rect x="784" y="142" width="254" height="56" rx="28" fill="#e9fbf6" stroke="#97d8c9"/>
    <text x="911" y="179" text-anchor="middle" fill="#0b6f61" font-family="Arial, sans-serif" font-size="24" font-weight="700">Source status visible</text>
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

  if (pathname === SOCIAL_IMAGE_PATH) {
    return {
      body: SOCIAL_CARD_SVG,
      contentType: "image/svg+xml; charset=utf-8",
      cacheControl: "public, max-age=86400",
    };
  }

  return null;
}
