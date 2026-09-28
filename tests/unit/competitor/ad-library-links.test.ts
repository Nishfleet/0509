import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { CompetitorHeader } from "../../../app/components/competitor-header";
import { adLibraryLinks } from "../../../app/lib/competitor/ad-library-links";

function renderHeader(name: string, domain: string): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CompetitorHeader, { name, domain, state: "on", stateChangedAt: null }),
    ),
  );
}

function metaQ(name: string): string | null {
  return new URL(adLibraryLinks({ name, domain: "example.com" }).meta).searchParams.get("q");
}

// What renderToStaticMarkup writes for a URL: searchParams percent-encodes
// quotes, angle brackets and apostrophes already, so the ampersands between
// the pairs are the only characters React escapes in the attribute.
function hrefAsMarkup(url: string): string {
  return `href="${url.replaceAll("&", "&amp;")}"`;
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

  it("encodes a name and a domain that carry URL syntax, without splitting the query", () => {
    const { meta, google } = adLibraryLinks({ name: "A&B", domain: "a&b.example" });
    const metaUrl = new URL(meta);
    const googleUrl = new URL(google);
    expect(metaUrl.searchParams.get("q")).toBe('"A&B"');
    expect(googleUrl.searchParams.get("domain")).toBe("a&b.example");
    expect([...metaUrl.searchParams.keys()].sort()).toEqual([
      "active_status",
      "ad_type",
      "country",
      "media_type",
      "q",
      "search_type",
    ]);
    expect([...googleUrl.searchParams.keys()].sort()).toEqual(["domain", "region"]);
  });

  it("renders both quiet links in the header, each opening in a new tab", () => {
    const name = "Bramble & Co";
    const domain = "shop.example.com";
    const links = adLibraryLinks({ name, domain });
    const html = renderHeader(name, domain);
    expect(html).toContain(hrefAsMarkup(links.meta));
    expect(html).toContain(hrefAsMarkup(links.google));
    expect(html).toContain(">Their ads on Meta</a>");
    expect(html).toContain(">Their ads on Google</a>");
    expect(html).toContain('aria-label="Bramble &amp; Co&#x27;s ads on Meta (opens in a new tab)"');
    expect(html).toContain('aria-label="Bramble &amp; Co&#x27;s ads on Google (opens in a new tab)"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
