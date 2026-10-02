import { describe, expect, it } from "vitest";

import { alternateCandidates, brandToken, offBrandSite } from "../../../app/lib/site/alternate-sources";
import { namesBrand, readPageTitle } from "../../../app/lib/site/page-headline";
import { provenanceNote } from "../../../app/lib/site-change";

describe("alternate sources for a blocked rival", () => {
  it("tries the brand's own hosts first, then the retailers' brand pages as pricing", () => {
    expect(alternateCandidates("www.adidas.com")).toEqual([
      { url: "https://news.adidas.com/", role: "blog", brand: null },
      { url: "https://newsroom.adidas.com/", role: "blog", brand: null },
      { url: "https://press.adidas.com/", role: "blog", brand: null },
      { url: "https://www.zalando.co.uk/adidas/", role: "pricing", brand: "adidas" },
      { url: "https://www.footlocker.co.uk/en/category/brands/adidas.html", role: "pricing", brand: "adidas" },
      { url: "https://www.jdsports.co.uk/brand/adidas/", role: "pricing", brand: "adidas" },
    ]);
  });

  it("takes the brand from the registrable domain and gives up on a bare suffix", () => {
    expect(brandToken("shop.on-running.com")).toBe("on-running");
    expect(brandToken("co.uk")).toBeNull();
    expect(alternateCandidates("localhost")).toEqual([]);
  });

  it("names the retailer's site, never the brand's own", () => {
    expect(offBrandSite("https://www.zalando.co.uk/adidas/", "adidas.com")).toBe("zalando.co.uk");
    expect(offBrandSite("https://news.adidas.com/", "www.adidas.com")).toBeNull();
  });

  it("reads the title of a page", async () => {
    expect(await readPageTitle("<html><head><title> Adidas Online Shop | ZALANDO </title></head></html>")).toBe(
      "Adidas Online Shop | ZALANDO",
    );
    expect(await readPageTitle("<html><body>no title</body></html>")).toBe("");
  });

  it("accepts a title that names the brand as whole words", () => {
    expect(namesBrand("Adidas Online Shop | ZALANDO.CO.UK", "adidas")).toBe(true);
    expect(namesBrand("All adidas | Foot Locker UK", "adidas")).toBe(true);
    expect(namesBrand("On Running | Shoes", "on-running")).toBe(true);
  });

  it("refuses home pages, search pages, soft 404s and look-alike words", () => {
    expect(namesBrand("Online Shoes | ZALANDO.CO.UK", "adidas")).toBe(false);
    expect(namesBrand("Search results for adidas | JD Sports", "adidas")).toBe(false);
    expect(namesBrand("Not Found | adidas", "adidas")).toBe(false);
    expect(namesBrand("404 - adidas page", "adidas")).toBe(false);
    expect(namesBrand("Cotton trainers | Online shop", "on")).toBe(false);
    expect(namesBrand("", "adidas")).toBe(false);
  });

  it("words the provenance note", () => {
    expect(provenanceNote({ viaArchive: false, seenOn: null })).toBeNull();
    expect(provenanceNote({ viaArchive: false, seenOn: "zalando.co.uk" })).toBe("Seen on zalando.co.uk");
    expect(provenanceNote({ viaArchive: true, seenOn: null })).toBe("From a public archive copy");
    expect(provenanceNote({ viaArchive: true, seenOn: "zalando.co.uk" })).toBe(
      "Seen on zalando.co.uk · From a public archive copy",
    );
  });
});
