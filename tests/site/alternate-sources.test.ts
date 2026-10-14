import { describe, expect, it } from "vitest";

import { offBrandSite, ownHostUrls } from "../../app/lib/site/alternate-sources";

describe("ownHostUrls", () => {
  it("proposes the brand's own news, newsroom and press hosts for a registrable domain", () => {
    expect(ownHostUrls("www.adidas.com")).toEqual([
      "https://news.adidas.com/",
      "https://newsroom.adidas.com/",
      "https://press.adidas.com/",
    ]);
  });

  it("proposes no host when the input has no registrable domain", () => {
    expect(ownHostUrls("localhost")).toEqual([]);
    expect(ownHostUrls("127.0.0.1")).toEqual([]);
  });
});

describe("offBrandSite", () => {
  it("names the registrable domain of a page on another site", () => {
    expect(offBrandSite("https://news.adidas-group.com/", "adidas.com")).toBe("adidas-group.com");
  });

  it("names nothing when the page is on the brand's own site", () => {
    expect(offBrandSite("https://news.adidas.com/", "www.adidas.com")).toBeNull();
  });

  it("names nothing when the page URL has no registrable domain", () => {
    expect(offBrandSite("http://localhost:8787/pricing", "adidas.com")).toBeNull();
  });
});
