/**
 * Local-language SEO cluster for the sneaker-resale segment (issue 1154).
 * English `/sneaker-resale` is x-default. Product UI stays English; these
 * pages are indexable marketing surfaces only.
 *
 * Market pick is evidence, not vibe — see docs/locale-seo-markets.md.
 *
 * Do not import `~/lib/seo` from here: seo.ts reads SNEAKER_RESALE_PATHS
 * to publish the cluster, and a cycle would break both.
 *
 * The untranslated buyer-surface locale cluster (the old
 * `BUYER_SURFACE_PATHS` / compare-child / guides `$locale.*` routes) was
 * deleted for issue #2962 (orchestrator Branch B): those pages served
 * byte-identical English copy, so they 301 to the EN pathname via the
 * `:locale/*` splat route instead. This module keeps `BUYER_SURFACE_LOCALE_IDS`
 * as the allowlist that 301 gate and the worker's `/<locale>/sitemap.xml`
 * serving read; the surface lists members of that retired cluster are gone.
 */
export const SNEAKER_RESALE_LOCALE_IDS = ["en", "de", "ja", "pt-br"] as const;
export type SneakerResaleLocaleId = (typeof SNEAKER_RESALE_LOCALE_IDS)[number];

/**
 * Buyer-surface locale prefixes (#1501). No longer a served route cluster —
 * issue #2962 deleted every untranslated buyer-surface locale route — but
 * still the allowlist that decides which `/<locale>/...` paths 301 to the EN
 * pathname (app/routes/$locale.tsx) and which `/<locale>/sitemap.xml` the
 * worker serves (workers/app.ts). English (`en`) is x-default and does NOT
 * get a prefix.
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
 * `<html lang>` for a public pathname. Only the genuinely translated
 * sneaker-resale cluster declares a non-EN lang (issue #1457/#1460); every
 * other public path is English and reports `lang="en"` (issue #1570 /
 * #2962: a page must never claim a language its content does not speak —
 * every formerly-fake-locale buyer path is now an EN 301, so nothing
 * stumbled on the old buyer-surface branch remains).
 */
export function htmlLangForPathname(pathname: string): string {
  return sneakerResaleMarketForPathname(pathname)?.htmlLang ?? "en";
}

/**
 * Whether `value` is a buyer-surface locale id (the locale prefixes the
 * `:locale/*` 301 accepts and the worker may serve a sitemap for, distinct
 * from `isSneakerResaleLocaleId` which is scoped to the sneaker-resale
 * segment).
 */
export function isBuyerSurfaceLocaleId(value: string | undefined): value is BuyerSurfaceLocaleId {
  return (
    value !== undefined &&
    (BUYER_SURFACE_LOCALE_IDS as readonly string[]).includes(value)
  );
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
