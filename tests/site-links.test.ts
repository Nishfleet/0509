import { describe, expect, it } from "vitest";

import { BROWSER_MS_PER_ENTITY_PER_DAY } from "../app/lib/site/browser.server";
import {
  canonicalPageText,
  sameOriginLinks,
  type ExtractedPage,
} from "../app/lib/site/extract.server";

function page(partial: Partial<ExtractedPage>): ExtractedPage {
  return {
    title: "",
    description: "",
    headings: [],
    prices: [],
    ctas: [],
    links: [],
    text: "",
    ...partial,
  };
}

describe("sameOriginLinks", () => {
  const base = "https://gymshark.com";

  it("keeps same-origin shallow links, drops assets, deep paths and other hosts", () => {
    const p = page({
      links: [
        { href: "/pricing", text: "Pricing" },
        { href: "https://gymshark.com/products#top?x=1", text: "Products" },
        { href: "https://twitter.com/gymshark", text: "X" },
        { href: "/a/b/c/deep", text: "deep" },
        { href: "/files/spec.pdf", text: "pdf" },
        { href: "/", text: "home" },
        { href: "mailto:hi@gymshark.com", text: "mail" },
      ],
    });
    const urls = sameOriginLinks(p, base);
    expect(urls).toContain("https://gymshark.com/pricing");
    expect(urls).toContain("https://gymshark.com/products");
    expect(urls).not.toContain("https://twitter.com/gymshark");
    expect(urls.some((u) => u.includes("/a/b/c"))).toBe(false);
    expect(urls.some((u) => u.endsWith(".pdf"))).toBe(false);
    expect(urls).not.toContain("https://gymshark.com/");
  });

  it("caps candidates at eight", () => {
    const p = page({
      links: Array.from({ length: 20 }, (_, i) => ({
        href: `/p${i}`,
        text: `p${i}`,
      })),
    });
    expect(sameOriginLinks(p, base).length).toBe(8);
  });
});

describe("browser budget", () => {
  it("caps a brand at 20 browser-seconds a day (docs/REBUILD-COST.md)", () => {
    expect(BROWSER_MS_PER_ENTITY_PER_DAY).toBe(20_000);
  });
});

describe("canonicalPageText", () => {
  it("folds structured fields into the diffable text", () => {
    const t = canonicalPageText(
      page({
        title: "Acme",
        description: "Shoes",
        headings: ["New drop"],
        prices: ["$30"],
        ctas: [{ text: "Buy now", href: "/cart" }],
        text: "body copy",
      }),
    );
    expect(t).toContain("Acme");
    expect(t).toContain("New drop");
    expect(t).toContain("$30");
    expect(t).toContain("Buy now");
    expect(t).toContain("body copy");
  });
});
