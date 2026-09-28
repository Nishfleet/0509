import { describe, expect, it } from "vitest";

import { adLibraryLinks } from "../../../app/lib/competitor/ad-library-links";

function metaQ(name: string): string | null {
  return new URL(adLibraryLinks({ name, domain: "example.com" }).meta).searchParams.get("q");
}

describe("the live ad-library links on a competitor header", () => {
  it("points Meta at the Ad Library and Google at Ads Transparency", () => {
    const { meta, google } = adLibraryLinks({ name: "Kindred", domain: "kindred.example" });
    const metaUrl = new URL(meta);
    const googleUrl = new URL(google);

    expect(metaUrl.hostname).toBe("www.facebook.com");
    expect(metaUrl.pathname).toBe("/ads/library/");
    expect(metaUrl.searchParams.get("active_status")).toBe("active");
    expect(metaUrl.searchParams.get("ad_type")).toBe("all");
    expect(metaUrl.searchParams.get("country")).toBe("ALL");
    expect(metaUrl.searchParams.get("media_type")).toBe("all");
    expect(metaUrl.searchParams.get("search_type")).toBe("keyword_exact_phrase");
    expect(metaUrl.searchParams.get("q")).toBe('"Kindred"');

    expect(googleUrl.hostname).toBe("adstransparency.google.com");
    expect(googleUrl.searchParams.get("region")).toBe("anywhere");
    expect(googleUrl.searchParams.get("domain")).toBe("kindred.example");
  });

  it("wraps the name in double quotes for the Meta exact-phrase search", () => {
    expect(metaQ("Bramble")).toBe('"Bramble"');
    expect(metaQ("Bramble & Co")).toBe('"Bramble & Co"');
    expect(metaQ('Bramble "The Best"')).toBe('"Bramble "The Best""');
    expect(metaQ("Café Zürich")).toBe('"Café Zürich"');
    expect(metaQ("Two  spaces")).toBe('"Two  spaces"');
  });

  it("keeps a subdomain a subdomain on Google", () => {
    const { google } = adLibraryLinks({ name: "Kindred", domain: "shop.example.com" });
    expect(new URL(google).searchParams.get("domain")).toBe("shop.example.com");
  });

  it("builds both URLs with URL, never by string concatenation", () => {
    const { meta, google } = adLibraryLinks({ name: "A&B", domain: "a&b.example" });
    expect(meta).toContain("q=%22A%26B%22");
    expect(google).toContain("domain=a%26b.example");
    expect(new URL(meta).searchParams.get("q")).toBe('"A&B"');
    expect(new URL(google).searchParams.get("domain")).toBe("a&b.example");
  });
});
