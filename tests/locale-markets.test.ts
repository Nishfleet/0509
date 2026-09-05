import { describe, expect, it } from "vitest";

import {
  BUYER_SURFACE_LOCALE_IDS,
  BUYER_SURFACE_PATHS,
  canonicalPathnameForLocalePath,
  htmlLangForPathname,
  isBuyerSurfaceLocaleId,
  isSneakerResaleLocaleId,
  isSneakerResaleSignupSource,
  matchBuyerSurfaceSplat,
  SNEAKER_RESALE_MARKETS,
  SNEAKER_RESALE_PATHS,
  sneakerResaleMarket,
  sneakerResaleMarketForPathname,
  sneakerResaleSignupPath,
} from "~/lib/locale-markets";
import { SITEMAP_PATHS, sneakerResaleHreflangLinks } from "~/lib/seo";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";

describe("sneaker-resale locale catalog", () => {
  it("ships English plus the three evidence-backed non-English markets", () => {
    // Sneaker-resale copy is scoped to the three translator-passed markets;
    // fr/es are pre-evidence locales that ship the buyer-surface cluster
    // (issue #1501) but no localized sneaker-resale copy yet.
    expect(SNEAKER_RESALE_MARKETS.map((market) => market.id)).toEqual([
      "en",
      "de",
      "ja",
      "pt-br",
    ]);
  });

  it("keeps every cluster path in the public sitemap", () => {
    for (const path of SNEAKER_RESALE_PATHS) {
      expect(SITEMAP_PATHS as readonly string[]).toContain(path);
    }
  });

  it("maps pathnames to html lang and rejects unknown prefixes", () => {
    expect(htmlLangForPathname("/sneaker-resale")).toBe("en");
    expect(htmlLangForPathname("/de/sneaker-resale")).toBe("de");
    expect(htmlLangForPathname("/ja/sneaker-resale")).toBe("ja");
    expect(htmlLangForPathname("/pt-br/sneaker-resale")).toBe("pt-BR");
    expect(htmlLangForPathname("/pt-br/sneaker-resale/")).toBe("pt-BR");
    expect(htmlLangForPathname("/")).toBe("en");
    expect(htmlLangForPathname("/fr/sneaker-resale")).toBe("en");
    expect(sneakerResaleMarketForPathname("/fr/sneaker-resale")).toBeNull();
  });

  it("keeps signup markers allowlisted and out of the page copy", () => {
    for (const market of SNEAKER_RESALE_MARKETS) {
      expect(isSneakerResaleSignupSource(market.signupSource)).toBe(true);
      expect(sneakerResaleSignupPath(market.id)).toBe(
        `/auth/signup?source=${market.signupSource}`,
      );
      expect(sneakerResaleCopy(market.id).h1).not.toContain(market.signupSource);
    }
    expect(isSneakerResaleSignupSource("magicbrief-migration")).toBe(false);
    expect(isSneakerResaleSignupSource("locale-fr-sneaker-resale")).toBe(false);
    expect(isSneakerResaleLocaleId("fr")).toBe(false);
  });

  it("emits a reciprocal hreflang set including self and x-default", () => {
    const links = sneakerResaleHreflangLinks();
    expect(links).toEqual([
      { rel: "alternate", hreflang: "en", href: "https://0509.io/sneaker-resale" },
      { rel: "alternate", hreflang: "de", href: "https://0509.io/de/sneaker-resale" },
      { rel: "alternate", hreflang: "ja", href: "https://0509.io/ja/sneaker-resale" },
      { rel: "alternate", hreflang: "pt-BR", href: "https://0509.io/pt-br/sneaker-resale" },
      { rel: "alternate", hreflang: "x-default", href: "https://0509.io/sneaker-resale" },
    ]);
    expect(links).toHaveLength(SNEAKER_RESALE_MARKETS.length + 1);
  });

  it("keeps titles under 60 characters and states the English-UI limit", () => {
    for (const market of SNEAKER_RESALE_MARKETS) {
      const copy = sneakerResaleCopy(market.id);
      expect(copy.title.length).toBeLessThanOrEqual(60);
      expect(copy.honest.some((item) => /English|englisch|英語|inglês/i.test(item.detail))).toBe(
        true,
      );
    }
    expect(sneakerResaleMarket("de").hreflang).toBe("de");
  });
});

describe("buyer-surface locale cluster (issue #1501)", () => {
  it("ships the five buyer-surface locales the issue asks for", () => {
    expect(BUYER_SURFACE_LOCALE_IDS).toEqual(["de", "ja", "pt-br", "fr", "es"]);
    expect(isBuyerSurfaceLocaleId("de")).toBe(true);
    expect(isBuyerSurfaceLocaleId("ja")).toBe(true);
    expect(isBuyerSurfaceLocaleId("pt-br")).toBe(true);
    expect(isBuyerSurfaceLocaleId("fr")).toBe(true);
    expect(isBuyerSurfaceLocaleId("es")).toBe(true);
  });

  it("rejects the English x-default locale and any unknown locale", () => {
    expect(isBuyerSurfaceLocaleId("en")).toBe(false);
    expect(isBuyerSurfaceLocaleId("xx")).toBe(false);
    expect(isBuyerSurfaceLocaleId(undefined)).toBe(false);
  });

  it("keeps buyer-surface locale subpaths OUT of the public sitemap (issue #1570)", () => {
    // The buyer-surface cluster serves byte-identical English copy with
    // canonical -> EN. Listing 43 locale `<loc>` entries told Google they
    // were 43 indexable surfaces — a duplicate-content doorway pattern.
    // They stay reachable (200, canonical->EN) but are no longer sitemapped.
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      for (const path of BUYER_SURFACE_PATHS) {
        if (path === "/" || path === "/sitemap.xml") continue;
        const sitemapPath = `/${locale}${path}`;
        expect(SITEMAP_PATHS as readonly string[]).not.toContain(sitemapPath);
      }
    }
    // The genuinely translated sneaker-resale cluster STAYS in the sitemap.
    expect(SITEMAP_PATHS as readonly string[]).toContain("/de/sneaker-resale");
    expect(SITEMAP_PATHS as readonly string[]).toContain("/ja/sneaker-resale");
    expect(SITEMAP_PATHS as readonly string[]).toContain("/pt-br/sneaker-resale");
  });

  it("derives the English canonical pathname from any locale-prefixed path", () => {
    expect(canonicalPathnameForLocalePath("/de")).toBe("/");
    expect(canonicalPathnameForLocalePath("/de/pricing")).toBe("/pricing");
    expect(canonicalPathnameForLocalePath("/ja/help")).toBe("/help");
    expect(canonicalPathnameForLocalePath("/pt-br/api/docs")).toBe("/api/docs");
    expect(canonicalPathnameForLocalePath("/fr/compare")).toBe("/compare");
    expect(canonicalPathnameForLocalePath("/es/sitemap.xml")).toBe("/sitemap.xml");
    // Already-English paths pass through unchanged.
    expect(canonicalPathnameForLocalePath("/pricing")).toBe("/pricing");
    expect(canonicalPathnameForLocalePath("/sneaker-resale")).toBe("/sneaker-resale");
    // Trailing slash is normalized.
    expect(canonicalPathnameForLocalePath("/de/pricing/")).toBe("/pricing");
  });

  it("dispatches the splat to the matching EN surface and 404s anything else", () => {
    expect(matchBuyerSurfaceSplat("")).toBe("");
    expect(matchBuyerSurfaceSplat("pricing")).toBe("pricing");
    expect(matchBuyerSurfaceSplat("help")).toBe("help");
    expect(matchBuyerSurfaceSplat("docs")).toBe("docs");
    expect(matchBuyerSurfaceSplat("api/docs")).toBe("api/docs");
    expect(matchBuyerSurfaceSplat("status")).toBe("status");
    expect(matchBuyerSurfaceSplat("changelog")).toBe("changelog");
    expect(matchBuyerSurfaceSplat("trust")).toBe("trust");
    expect(matchBuyerSurfaceSplat("compare")).toBe("compare");
    // Sub-paths that aren't a registered buyer surface (e.g. /compare/magicbrief
    // is its own named route, not part of the cluster) must 404 so the
    // cluster stays bounded.
    expect(matchBuyerSurfaceSplat("compare/magicbrief")).toBeNull();
    expect(matchBuyerSurfaceSplat("pricing/extra")).toBeNull();
    expect(matchBuyerSurfaceSplat("totally-unknown")).toBeNull();
  });

  it("maps every buyer-surface locale pathname to lang=en (issue #1570)", () => {
    // The buyer-surface cluster serves byte-identical English copy. A page
    // must not declare a language its content does not speak, so every
    // buyer-surface locale path reports `en` — not de/ja/pt-BR/fr/es.
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      expect(htmlLangForPathname(`/${locale}`)).toBe("en");
      expect(htmlLangForPathname(`/${locale}/pricing`)).toBe("en");
      expect(htmlLangForPathname(`/${locale}/help`)).toBe("en");
      expect(htmlLangForPathname(`/${locale}/docs`)).toBe("en");
      expect(htmlLangForPathname(`/${locale}/api/docs`)).toBe("en");
      expect(htmlLangForPathname(`/${locale}/status`)).toBe("en");
      expect(htmlLangForPathname(`/${locale}/changelog`)).toBe("en");
      expect(htmlLangForPathname(`/${locale}/trust`)).toBe("en");
      expect(htmlLangForPathname(`/${locale}/compare`)).toBe("en");
    }
    // EN pathnames stay EN.
    expect(htmlLangForPathname("/pricing")).toBe("en");
    expect(htmlLangForPathname("/")).toBe("en");
    // The genuinely translated sneaker-resale cluster KEEPS its locale lang.
    expect(htmlLangForPathname("/de/sneaker-resale")).toBe("de");
    expect(htmlLangForPathname("/ja/sneaker-resale")).toBe("ja");
    expect(htmlLangForPathname("/pt-br/sneaker-resale")).toBe("pt-BR");
  });
});
