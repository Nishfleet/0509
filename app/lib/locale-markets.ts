/**
 * Zero-spend local-language SEO cluster for the sneaker-resale segment
 * (issue 1154). English `/sneaker-resale` is x-default. Product UI stays
 * English; these pages are indexable marketing surfaces only.
 *
 * Market pick is evidence, not vibe — see docs/locale-seo-markets.md.
 *
 * Do not import `~/lib/seo` from here: seo.ts reads SNEAKER_RESALE_PATHS
 * to publish the cluster, and a cycle would break both.
 */
export const SNEAKER_RESALE_LOCALE_IDS = ["en", "de", "ja", "pt-br"] as const;
export type SneakerResaleLocaleId = (typeof SNEAKER_RESALE_LOCALE_IDS)[number];

/**
 * Locales that ship the full buyer-surface cluster (/, /pricing, /help, ...).
 * English (`en`) is x-default and does NOT get a prefix. Issue #1501 expanded
 * the locale list from the evidence-backed trio (de, ja, pt-br) to the five
 * markets the BET 5 distribution bet covers — EU/UK + JP + BR + FR + ES, where
 * Meta's Ad Library is the strategic coverage region. The buyer-surface
 * cluster is intentionally broader than the sneaker-resale cluster: fr/es
 * receive the marketing surface cluster with canonical→EN (no localized
 * sneaker-resale copy yet), while the sneaker-resale segment stays scoped
 * to the three translator-passed markets.
 */
export const BUYER_SURFACE_LOCALE_IDS = ["de", "ja", "pt-br", "fr", "es"] as const;
export type BuyerSurfaceLocaleId = (typeof BUYER_SURFACE_LOCALE_IDS)[number];

/**
 * Buyer-surface paths that must serve 200 under every buyer-surface locale
 * prefix. The English (x-default) versions live at the same paths without a
 * locale prefix. Sourced from issue #1501's `verify:` block.
 *
 * The set is a single source of truth for the route file's splat dispatch,
 * the sitemap entries, and the prod canary probe — so a new buyer surface
 * added to the EN side cannot silently fall off the locale side.
 */
export const BUYER_SURFACE_PATHS = [
  "/",
  "/pricing",
  "/sitemap.xml",
  "/help",
  "/docs",
  "/api/docs",
  "/status",
  "/changelog",
  "/trust",
  "/compare",
  // First-value search funnel + supporting trust surfaces (issue 1578).
  // Search is THE first purchase-intent moment (BET 2), so a non-EN buyer
  // completing the localised funnel must reach the same functional search
  // outcome instead of a 404 or a language jump back to EN `/search`
  // (accept #1/#3). Competitor-monitoring, capture-rules and ad-aggression
  // are the surrounding trust/proof surfaces the localised buyer needs too.
  "/search",
  "/competitor-monitoring",
  "/capture-rules",
  "/ad-aggression",
] as const;
export type BuyerSurfacePath = (typeof BUYER_SURFACE_PATHS)[number];

/**
 * Compare child product pages that must also serve 200 under every
 * buyer-surface locale prefix (issue #1563). The EN hubs (`/compare`,
 * each `/compare/<vendor>`) exist already; the BET 5 compare pages and
 * the BET 8 switch pages were never localised, so `/de/compare/magicbrief`
 * etc. 404'd while `/de/compare` (the hub) served 200. Each path here maps
 * to a `$locale.*.tsx` route that re-exports the EN sibling's meta and
 * component with canonical→EN plus the buyer-surface hreflang cluster.
 *
 * Kept as a single source of truth so the route file, the sitemap, and the
 * `<html lang>` helper in this module can never drift apart.
 */
export const BUYER_SURFACE_SEGMENT_CHILD_SLUGS: Record<string, readonly string[]> = {
  compare: [
    "magicbrief",
    "meta-ad-library",
    "visualping",
    "visualping-ad-library",
    "spyland",
    "pulzifi",
    "foreplay",
    "foreplay-spyder",
    "panoramata",
    "adspyder",
  ],
  switch: ["magicbrief", "panoramata", "visualping"],
} as const;

/**
 * The 13 locale-prefixable child routes as EN paths (`/compare/magicbrief`
 * ... `/switch/visualping`). Derived from `BUYER_SURFACE_SEGMENT_CHILD_SLUGS`
 * so adding a vendor in one place lights it up in every locale prefix.
 */
export const BUYER_SURFACE_CHILD_PATHS: readonly string[] = Object.entries(
  BUYER_SURFACE_SEGMENT_CHILD_SLUGS,
).flatMap(([segment, slugs]) => slugs.map((slug) => `/${segment}/${slug}`));

/** True when `splat` (e.g. `compare/magicbrief`) is a locale-prefixable child. */
export function isBuyerSurfaceChildSplat(splat: string): boolean {
  return (BUYER_SURFACE_CHILD_PATHS as readonly string[]).includes(`/${splat}`);
}

export interface SneakerResaleMarket {
  id: SneakerResaleLocaleId;
  hreflang: string;
  htmlLang: string;
  ogLocale: string;
  pathname: string;
  nativeName: string;
  signupSource: string;
}

export const SNEAKER_RESALE_MARKETS: readonly SneakerResaleMarket[] = [
  {
    id: "en",
    hreflang: "en",
    htmlLang: "en",
    ogLocale: "en_US",
    pathname: "/sneaker-resale",
    nativeName: "English",
    signupSource: "locale-en-sneaker-resale",
  },
  {
    id: "de",
    hreflang: "de",
    htmlLang: "de",
    ogLocale: "de_DE",
    pathname: "/de/sneaker-resale",
    nativeName: "Deutsch",
    signupSource: "locale-de-sneaker-resale",
  },
  {
    id: "ja",
    hreflang: "ja",
    htmlLang: "ja",
    ogLocale: "ja_JP",
    pathname: "/ja/sneaker-resale",
    nativeName: "日本語",
    signupSource: "locale-ja-sneaker-resale",
  },
  {
    id: "pt-br",
    hreflang: "pt-BR",
    htmlLang: "pt-BR",
    ogLocale: "pt_BR",
    pathname: "/pt-br/sneaker-resale",
    nativeName: "Português (Brasil)",
    signupSource: "locale-pt-br-sneaker-resale",
  },
] as const;

const MARKET_BY_ID = new Map(SNEAKER_RESALE_MARKETS.map((market) => [market.id, market]));
const MARKET_BY_PATH = new Map(SNEAKER_RESALE_MARKETS.map((market) => [market.pathname, market]));
const SIGNUP_SOURCE_SET = new Set(SNEAKER_RESALE_MARKETS.map((market) => market.signupSource));

export const SNEAKER_RESALE_PATHS = SNEAKER_RESALE_MARKETS.map((market) => market.pathname);

export function isSneakerResaleLocaleId(value: string | undefined): value is SneakerResaleLocaleId {
  return value !== undefined && MARKET_BY_ID.has(value as SneakerResaleLocaleId);
}

export function sneakerResaleMarket(id: SneakerResaleLocaleId): SneakerResaleMarket {
  const market = MARKET_BY_ID.get(id);
  if (!market) {
    throw new Error(`unknown sneaker-resale locale: ${id}`);
  }
  return market;
}

export function sneakerResaleMarketForPathname(pathname: string): SneakerResaleMarket | null {
  const pathOnly = pathname.split(/[?#]/)[0] ?? pathname;
  const withoutTrailingSlash =
    pathOnly === "/" ? pathOnly : pathOnly.replace(/\/+$/, "");
  return MARKET_BY_PATH.get(withoutTrailingSlash) ?? null;
}

/**
 * Locales that ship the full buyer-surface cluster, with the values the
 * `<html lang>` attribute expects. Single source of truth so the root layout
 * (which calls `htmlLangForPathname`) and the splat route can never drift.
 */
const BUYER_SURFACE_HTML_LANG: Record<BuyerSurfaceLocaleId, string> = {
  de: "de",
  ja: "ja",
  "pt-br": "pt-BR",
  fr: "fr",
  es: "es",
};

/**
 * Buyer-surface locale prefix extracted from a pathname, if any. Used by
 * `htmlLangForPathname` so `/de/pricing` reports `de` even though
 * `sneakerResaleMarketForPathname` only knows the `/de/sneaker-resale` shape.
 *
 * The prefix match is strict: the splat must be empty (bare `/<locale>`
 * index), exactly one of the allowlisted buyer-surface subpaths
 * (`pricing`, `help`, `docs`, `api/docs`, `status`, `changelog`, `trust`,
 * `compare`), or one of the locale-prefixable compare/switch child routes
 * (`compare/magicbrief`, `switch/visualping`, ...). Any other splat — e.g.
 * `/fr/sneaker-resale`, where `fr` is a buyer-surface locale but
 * `sneaker-resale` is the localized sneaker-resale cluster's own segment —
 * returns `null` so the pathname falls through to the sneaker-resale check
 * (which 404s for fr/es) and ultimately reports `en`. The strict match
 * keeps the buyer-surface lang tag from leaking onto 404s.
 */
function buyerSurfaceLocaleForPathname(pathname: string): BuyerSurfaceLocaleId | null {
  const pathOnly = pathname.split(/[?#]/)[0] ?? pathname;
  const withoutTrailingSlash =
    pathOnly === "/" ? pathOnly : pathOnly.replace(/\/+$/, "");
  for (const locale of BUYER_SURFACE_LOCALE_IDS) {
    const prefix = `/${locale}`;
    if (withoutTrailingSlash === prefix) {
      return locale;
    }
    if (withoutTrailingSlash.startsWith(`${prefix}/`)) {
      const splat = withoutTrailingSlash.slice(prefix.length + 1);
      // The splat must exactly match a known buyer-surface subpath. An
      // unknown splat (`/fr/sneaker-resale`, `/fr/ads/foo`) means the
      // route 404s; the lang tag stays `en` so the not-found page doesn't
      // mislabel itself as French/Spanish/etc.
      if (
        splat === "" ||
        (BUYER_SURFACE_PATHS as readonly string[]).some(
          (path) => path !== "/" && path === `/${splat}`,
        ) ||
        isBuyerSurfaceChildSplat(splat)
      ) {
        return locale;
      }
      return null;
    }
  }
  return null;
}

export function htmlLangForPathname(pathname: string): string {
  const buyerSurfaceLocale = buyerSurfaceLocaleForPathname(pathname);
  if (buyerSurfaceLocale) {
    return BUYER_SURFACE_HTML_LANG[buyerSurfaceLocale];
  }
  return sneakerResaleMarketForPathname(pathname)?.htmlLang ?? "en";
}

/**
 * Returns the English (canonical) pathname for a buyer-surface locale path.
 * `/de/pricing` -> `/pricing`; `/ja/` -> `/`; `/sneaker-resale` (already EN)
 * passes through unchanged. Used by the splat route to set the
 * `rel=canonical` URL to the x-default version so the locale cluster does
 * not fragment search ranking (issue #1501, accept #2). Unknown splats
 * (e.g. `/fr/sneaker-resale`) pass through unchanged — the route 404s but
 * a stray canonical rewrite must not change behavior.
 */
export function canonicalPathnameForLocalePath(pathname: string): string {
  const buyerSurfaceLocale = buyerSurfaceLocaleForPathname(pathname);
  const pathOnly = pathname.split(/[?#]/)[0] ?? pathname;
  const withoutTrailingSlash =
    pathOnly === "/" ? pathOnly : pathOnly.replace(/\/+$/, "");
  if (!buyerSurfaceLocale) {
    return withoutTrailingSlash;
  }
  const prefix = `/${buyerSurfaceLocale}`;
  if (withoutTrailingSlash === prefix) {
    return "/";
  }
  if (withoutTrailingSlash.startsWith(`${prefix}/`)) {
    return withoutTrailingSlash.slice(prefix.length);
  }
  return withoutTrailingSlash;
}

/**
 * Whether `value` is a buyer-surface locale id (the locales that receive
 * the full cluster, distinct from `isSneakerResaleLocaleId` which is scoped
 * to the sneaker-resale segment).
 */
/**
 * The search path a page on `pathname` should funnel its "run a search"
 * entry points toward, preserving the buyer-surface locale prefix (issue 1578,
 * accept #3). A localised surface like `/de/competitor-monitoring`
 * must hand the first-value search moment to `/de/search` — not EN
 * `/search` — so the non-EN buyer stays inside the localised funnel. EN
 * (and unknown) pathnames return `/search` unchanged.
 */
export function localeSearchPathname(pathname: string): string {
  const locale = buyerSurfaceLocaleForPathname(pathname);
  return locale ? `/${locale}/search` : "/search";
}

export function isBuyerSurfaceLocaleId(value: string | undefined): value is BuyerSurfaceLocaleId {
  return (
    value !== undefined &&
    (BUYER_SURFACE_LOCALE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Whether `pathname` matches a buyer-surface subpath under a locale prefix
 * (e.g. `/de/pricing`). Returns the EN subpath (without the locale prefix)
 * when it matches, or `null` otherwise. Drives the splat route's dispatch:
 * the EN subpath is the key into the component/loader/links switch, and a
 * `null` return means the splat was something other than a buyer-surface
 * (e.g. a deep /compare/* sub-page) which 404s to keep the surface
 * cluster bounded.
 */
export function matchBuyerSurfaceSplat(splat: string): string | null {
  if (splat === "") {
    return "";
  }
  // The empty `""` maps to `/` (the marketing index). Everything else must
  // exactly match a buyer-surface subpath; partial matches (`/pricing/...`)
  // and unknown segments are out of scope for the cluster and 404.
  if ((BUYER_SURFACE_PATHS as readonly string[]).includes(`/${splat}`)) {
    return splat;
  }
  return null;
}

export function isSneakerResaleSignupSource(source: string | null | undefined): boolean {
  return Boolean(source && SIGNUP_SOURCE_SET.has(source));
}

export function sneakerResaleMarketForSignupSource(
  source: string | null | undefined,
): SneakerResaleMarket | null {
  if (!source) {
    return null;
  }
  return SNEAKER_RESALE_MARKETS.find((market) => market.signupSource === source) ?? null;
}

export function sneakerResaleSignupPath(id: SneakerResaleLocaleId): string {
  return `/auth/signup?source=${sneakerResaleMarket(id).signupSource}`;
}
