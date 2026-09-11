import { describe, expect, it } from "vitest";

import { renderSitemapXml } from "~/lib/seo";
import { canonicalPathFor, canonicalPathRedirect } from "../workers/canonical-path";

describe("canonical path redirects (issue #2955)", () => {
  it("301s uppercase public paths to their lowercase canonical", () => {
    const response = canonicalPathRedirect(new Request("https://0509.io/Pricing"));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://0509.io/pricing");
    expect(response?.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("301s trailing-slash public paths to the slash-free canonical", () => {
    expect(
      canonicalPathRedirect(new Request("https://0509.io/pricing/"))?.headers.get("location"),
    ).toBe("https://0509.io/pricing");
    expect(
      canonicalPathRedirect(new Request("https://0509.io/compare/visualping/"))?.headers.get("location"),
    ).toBe("https://0509.io/compare/visualping");
  });

  it("applies both rules in a single hop", () => {
    expect(
      canonicalPathRedirect(new Request("https://0509.io/PRICING/"))?.headers.get("location"),
    ).toBe("https://0509.io/pricing");
  });

  it("preserves the query string verbatim — values can be case-sensitive", () => {
    const response = canonicalPathRedirect(
      new Request("https://0509.io/Search?Query=NiKE&plan=Agency"),
    );
    expect(response?.headers.get("location")).toBe(
      "https://0509.io/search?Query=NiKE&plan=Agency",
    );
  });

  it("canonicalizes locale-prefixed and worker-served public files", () => {
    expect(
      canonicalPathRedirect(new Request("https://0509.io/de/PRICING"))?.headers.get("location"),
    ).toBe("https://0509.io/de/pricing");
    expect(
      canonicalPathRedirect(new Request("https://0509.io/Sitemap.xml"))?.headers.get("location"),
    ).toBe("https://0509.io/sitemap.xml");
    expect(
      canonicalPathRedirect(new Request("https://0509.io/Favicon.ico"))?.headers.get("location"),
    ).toBe("https://0509.io/favicon.ico");
  });

  it("passes canonical paths through untouched", () => {
    for (const path of ["/", "/pricing", "/compare/visualping-ad-libraries", "/sitemap.xml"]) {
      expect(canonicalPathRedirect(new Request(`https://0509.io${path}`))).toBeNull();
    }
  });

  it("keeps the root path canonical", () => {
    expect(canonicalPathFor("/")).toBe("/");
    expect(canonicalPathRedirect(new Request("https://0509.io/"))).toBeNull();
  });

  it("never redirects non-GET/HEAD methods — a 301 would drop the body", () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      expect(
        canonicalPathRedirect(new Request("https://0509.io/Pricing", { method })),
      ).toBeNull();
    }
    expect(
      canonicalPathRedirect(new Request("https://0509.io/Pricing", { method: "HEAD" }))
        ?.headers.get("location"),
    ).toBe("https://0509.io/pricing");
  });

  it("leaves case-sensitive asset and key surfaces untouched", () => {
    const exemptPaths = [
      // Hashed build filenames — the casing IS the asset key.
      "/assets/entry.client-B22Hdjaz.js",
      "/ASSETS/entry.client-B22Hdjaz.js",
      // Case-sensitive R2/D1 object keys and share tokens in the path.
      "/artifacts/proof/AbCdEf123",
      "/artifacts/page-text/AbCdEf123",
      "/artifacts/creatives/AbCdEf123",
      "/creative/AbCdEf123",
      "/share/AbCdEfToken",
      "/Share/AbCdEfToken",
      "/export/report/AbCdEf123",
    ];
    for (const path of exemptPaths) {
      expect(canonicalPathRedirect(new Request(`https://0509.io${path}`))).toBeNull();
    }
  });

  it("leaves private and machine surfaces untouched (already noindex/disallowed)", () => {
    const privatePaths = [
      "/API/health",
      "/API/webhooks/dodo",
      "/APP/watchlists",
      "/Auth/Login",
      "/TEAM/accept",
      "/Unsubscribe?token=AbCdEf",
      "/.WELL-KNOWN/security.txt",
    ];
    for (const path of privatePaths) {
      expect(canonicalPathRedirect(new Request(`https://0509.io${path}`))).toBeNull();
    }
  });

  it("does not over-exempt: segment-boundary prefixes only", () => {
    // /apple-touch-icon.png starts with /app textually but is a public file.
    expect(
      canonicalPathRedirect(new Request("https://0509.io/Apple-Touch-Icon.png"))
        ?.headers.get("location"),
    ).toBe("https://0509.io/apple-touch-icon.png");
  });
});

describe("sitemap emits only canonical URLs", () => {
  it("lowercases and de-slashes every <loc> even if an entry drifts", () => {
    const xml = renderSitemapXml([
      { path: "/Pricing" },
      { path: "/help/" },
      { path: "/ADS/NiKe.com" },
    ]);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      "https://0509.io/pricing",
      "https://0509.io/help",
      "https://0509.io/ads/nike.com",
    ]);
  });
});
