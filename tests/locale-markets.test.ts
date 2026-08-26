import { describe, expect, it } from "vitest";

import {
  htmlLangForPathname,
  isSneakerResaleLocaleId,
  isSneakerResaleSignupSource,
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
      { rel: "alternate", hrefLang: "en", href: "https://0509.io/sneaker-resale" },
      { rel: "alternate", hrefLang: "de", href: "https://0509.io/de/sneaker-resale" },
      { rel: "alternate", hrefLang: "ja", href: "https://0509.io/ja/sneaker-resale" },
      { rel: "alternate", hrefLang: "pt-BR", href: "https://0509.io/pt-br/sneaker-resale" },
      { rel: "alternate", hrefLang: "x-default", href: "https://0509.io/sneaker-resale" },
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
