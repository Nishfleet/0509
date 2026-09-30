import { describe, expect, it } from "vitest";

import { adLibraryLinks } from "../../../app/lib/competitor/ad-library-links";

const NAMES = ["Zephyrwear", "Bramble & Co", 'Bramble "The Best"', "Café Zürich 東京", "Two  spaces", "100% a=b?c#d"];

describe("adLibraryLinks", () => {
  it("points Meta at the Ad Library and Google at Ads Transparency", () => {
    const { meta, google } = adLibraryLinks({ name: "Kindred", domain: "kindred.example" });
    const metaUrl = new URL(meta);
    const googleUrl = new URL(google);
    expect(metaUrl.origin + metaUrl.pathname).toBe("https://www.facebook.com/ads/library/");
    expect(metaUrl.searchParams.get("active_status")).toBe("active");
    expect(metaUrl.searchParams.get("ad_type")).toBe("all");
    expect(metaUrl.searchParams.get("country")).toBe("ALL");
    expect(metaUrl.searchParams.get("media_type")).toBe("all");
    expect(metaUrl.searchParams.get("search_type")).toBe("keyword_exact_phrase");
    expect(googleUrl.origin).toBe("https://adstransparency.google.com");
    expect(googleUrl.searchParams.get("region")).toBe("anywhere");
  });

  it.each(NAMES)("round-trips the name %s inside double quotes", (name) => {
    const { meta } = adLibraryLinks({ name, domain: "example.com" });
    expect(new URL(meta).searchParams.get("q")).toBe(`"${name}"`);
  });

  it.each(["example.com", "shop.example.com", "a&b.example"])("round-trips the domain %s as given", (domain) => {
    const { google } = adLibraryLinks({ name: "Kindred", domain });
    expect(new URL(google).searchParams.get("domain")).toBe(domain);
  });

  it("keeps the query to exactly the expected keys however hostile the input", () => {
    const { meta, google } = adLibraryLinks({ name: "a&q=evil", domain: "x.example&region=evil" });
    expect([...new URL(meta).searchParams.keys()].sort()).toEqual([
      "active_status",
      "ad_type",
      "country",
      "media_type",
      "q",
      "search_type",
    ]);
    expect([...new URL(google).searchParams.keys()].sort()).toEqual(["domain", "region"]);
  });
});
