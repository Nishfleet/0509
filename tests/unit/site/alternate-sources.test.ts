import { describe, expect, it } from "vitest";

import { alternateCandidates, brandToken, isOffBrandHost } from "../../../app/lib/site/alternate-sources";
import { namesBrand, readPageHeadline } from "../../../app/lib/site/page-headline";
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

  it("knows a retailer's page from the brand's own", () => {
    expect(isOffBrandHost("https://www.zalando.co.uk/adidas/", "adidas.com")).toBe(true);
    expect(isOffBrandHost("https://news.adidas.com/", "www.adidas.com")).toBe(false);
  });

  it("accepts a page whose title or first heading names the brand, whole words only", async () => {
    const shop = await readPageHeadline(
      "<html><head><title>Adidas Online Shop | ZALANDO</title></head><body><h1>Shoes</h1><h1>More</h1></body></html>",
    );
    expect(shop).toEqual({ title: "Adidas Online Shop | ZALANDO", heading: "Shoes" });
    expect(namesBrand(shop, "adidas")).toBe(true);
    expect(namesBrand({ title: "Not Found", heading: "Adidas originals" }, "adidas")).toBe(true);
    expect(namesBrand({ title: "Not Found", heading: "Oops" }, "adidas")).toBe(false);
    expect(namesBrand({ title: "Online shop", heading: "Cotton trainers" }, "on")).toBe(false);
    expect(namesBrand({ title: "On Running | Shoes", heading: "" }, "on-running")).toBe(true);
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
