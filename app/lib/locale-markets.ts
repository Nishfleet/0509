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
export const SNEAKER_RESALE_LOCALE_IDS = ["en", "de", "ja", "pt-br", "fr", "es"] as const;
export type SneakerResaleLocaleId = (typeof SNEAKER_RESALE_LOCALE_IDS)[number];

/**
 * Locales that receive the full buyer surface cluster (/, /pricing, /help, etc.).
 * These are the locales documented in the sitemap as shipping marketing content.
 * English is x-default and does not get a locale prefix.
 */
export const BUYER_SURFACE_LOCALE_IDS = ["de", "ja", "pt-br", "fr", "es"] as const;
export type BuyerSurfaceLocaleId = (typeof BUYER_SURFACE_LOCALE_IDS)[number];

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
  {
    id: "fr",
    hreflang: "fr",
    htmlLang: "fr",
    ogLocale: "fr_FR",
    pathname: "/fr/sneaker-resale",
    nativeName: "Français",
    signupSource: "locale-fr-sneaker-resale",
  },
  {
    id: "es",
    hreflang: "es",
    htmlLang: "es",
    ogLocale: "es_ES",
    pathname: "/es/sneaker-resale",
    nativeName: "Español",
    signupSource: "locale-es-sneaker-resale",
  },
] as const;

const MARKET_BY_ID = new Map(SNEAKER_RESALE_MARKETS.map((market) => [market.id, market]));
const MARKET_BY_PATH = new Map(SNEAKER_RESALE_MARKETS.map((market) => [market.pathname, market]));
const SIGNUP_SOURCE_SET = new Set(SNEAKER_RESALE_MARKETS.map((market) => market.signupSource));

export const SNEAKER_RESALE_PATHS = SNEAKER_RESALE_MARKETS.map((market) => market.pathname);

/**
 * Buyer surface paths that must exist under each buyer surface locale prefix.
 * English (x-default) serves these at the root (/, /pricing, etc.).
 * Each locale in BUYER_SURFACE_LOCALE_IDS gets these paths prefixed (e.g. /de/, /de/pricing).
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

export function isSneakerResaleLocaleId(value: string | undefined): value is SneakerResaleLocaleId {
  return value !== undefined && MARKET_BY_ID.has(value as SneakerResaleLocaleId);
}

export function isBuyerSurfaceLocaleId(value: string | undefined): value is BuyerSurfaceLocaleId {
  return value !== undefined && (BUYER_SURFACE_LOCALE_IDS as readonly string[]).includes(value);
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

export function htmlLangForPathname(pathname: string): string {
  return sneakerResaleMarketForPathname(pathname)?.htmlLang ?? "en";
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

/**
 * Returns the canonical (English) pathname for a buyer surface locale path.
 * e.g. "/de/pricing" -> "/pricing", "/ja/help" -> "/help"
 */
export function canonicalPathnameForLocalePath(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/)[0] ?? pathname;
  const withoutTrailingSlash =
    pathOnly === "/" ? pathOnly : pathOnly.replace(/\/+$/, "");
  
  for (const locale of BUYER_SURFACE_LOCALE_IDS) {
    const prefix = `/${locale}`;
    if (withoutTrailingSlash === prefix) {
      return "/";
    }
    if (withoutTrailingSlash.startsWith(`${prefix}/`)) {
      return withoutTrailingSlash.slice(prefix.length);
    }
  }
  return withoutTrailingSlash;
}