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
] as const;
export type BuyerSurfacePath = (typeof BUYER_SURFACE_PATHS)[number];

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

// NOTE(issue #1570): the buyer-surface cluster (`/de/pricing`, `/ja/help`,
// ...) serves byte-identical English copy — it is NOT translated. A page
// must not declare a language its content does not speak (WCAG 3.2.6
// html-lang; Google duplicate-content doorway signal), so buyer-surface
// locale paths report `lang="en"` and are removed from the locale sitemap
// set. The genuinely translated sneaker-resale cluster (`/de/sneaker-resale`
// etc.) keeps its locale lang tag below. `BUYER_SURFACE_HTML_LANG` is
// intentionally gone: it existed only to feed `htmlLangForPathname`, and
// that function now returns `"en"` for every buyer-surface path.

/**
 * Buyer-surface locale prefix extracted from a pathname, if any. Used by
 * `htmlLangForPathname` so `/de/pricing` reports `de` even though
 * `sneakerResaleMarketForPathname` only knows the `/de/sneaker-resale` shape.
 *
 * The prefix match is strict: the splat must be empty (bare `/<locale>`
 * index) or exactly one of the allowlisted buyer-surface subpaths
 * (`pricing`, `help`, `docs`, `api/docs`, `status`, `changelog`, `trust`,
 * `compare`). Any other splat — e.g. `/fr/sneaker-resale`, where `fr` is a
 * buyer-surface locale but `sneaker-resale` is the localized sneaker-resale
 * cluster's own segment — returns `null` so the pathname falls through to
 * the sneaker-resale check (which 404s for fr/es) and ultimately reports
 * `en`. The strict match keeps the buyer-surface lang tag from leaking onto
 * 404s.
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
        )
      ) {
        return locale;
      }
      return null;
    }
  }
  return null;
}

export function htmlLangForPathname(pathname: string): string {
  // Issue #1570: buyer-surface locale paths (`/de/pricing`, `/ja/help`, ...)
  // serve untranslated English copy. They must declare `lang="en"` so a
  // page never claims a language its content does not speak (WCAG 3.2.6
  // html-lang) and so Google does not see 43 fake-locale doorway duplicates.
  // The genuinely translated sneaker-resale cluster keeps its locale lang.
  if (buyerSurfaceLocaleForPathname(pathname)) {
    return "en";
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
