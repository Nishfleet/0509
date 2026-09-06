import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildSitemapXml, publicSeoFileForPathname } from "~/lib/seo";

describe("public SEO files", () => {
  it("publishes the public funnel surfaces in the sitemap", () => {
    const sitemap = publicSeoFileForPathname("/sitemap.xml");

    expect(sitemap?.body).toContain("https://0509.io/");
    expect(sitemap?.body).toContain("https://0509.io/help");
    expect(sitemap?.body).toContain("https://0509.io/docs");
    expect(sitemap?.body).toContain("https://0509.io/api/docs");
    expect(sitemap?.body).toContain("https://0509.io/status");
    expect(sitemap?.body).toContain("https://0509.io/changelog");
    expect(sitemap?.body).toContain("https://0509.io/trust");
    expect(sitemap?.body).toContain("https://0509.io/privacy");
    expect(sitemap?.body).toContain("https://0509.io/terms");
    // Funnel entry points (feat/funnel-seo): the public search preview,
    // signup, and both compare pages are deliberately crawlable.
    expect(sitemap?.body).toContain("<url><loc>https://0509.io/search</loc></url>");
    expect(sitemap?.body).toContain("<url><loc>https://0509.io/auth/signup</loc></url>");
    expect(sitemap?.body).toContain("<url><loc>https://0509.io/compare/magicbrief</loc></url>");
    expect(sitemap?.body).toContain(
      "<url><loc>https://0509.io/compare/meta-ad-library</loc></url>",
    );
  });

  it("keeps the static sitemap free of /ads/* entries (dynamic entries live elsewhere)", () => {
    const sitemap = publicSeoFileForPathname("/sitemap.xml");

    // Exactly the 13 static paths, all present, none duplicated, no /ads/.
    const locs = sitemap?.body.match(/<loc>([^<]+)<\/loc>/g) ?? [];
    expect(locs).toHaveLength(13);
    expect(new Set(locs).size).toBe(13);
    expect(sitemap?.body).not.toContain("/ads/");
    // Deterministic static order: the root first, then the funnel.
    expect(locs[0]).toBe("<loc>https://0509.io/</loc>");
    expect(locs[1]).toBe("<loc>https://0509.io/search</loc>");
  });

  it("builds a deterministic, deduplicated, markup-safe sitemap with dynamic paths", () => {
    const body = buildSitemapXml(["/ads/nykaa.com", "/ads/amazon.in", "/ads/nykaa.com"]);
    const first = buildSitemapXml(["/ads/amazon.in", "/ads/nykaa.com"]);

    expect(body).toBe(first);
    expect(body).toContain("<url><loc>https://0509.io/</loc></url>");
    // Every static path survives.
    expect(body).toContain("<url><loc>https://0509.io/terms</loc></url>");
    // Dynamic entries appended once each, sorted after the static block.
    expect(body).toContain("<url><loc>https://0509.io/ads/amazon.in</loc></url>");
    expect(body).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
    expect((body.match(/ads\//g) ?? []).length).toBe(2);
    const nykaaIndex = body.indexOf("/ads/nykaa.com");
    const amazonIndex = body.indexOf("/ads/amazon.in");
    const termsIndex = body.indexOf("/terms</loc>");
    expect(nykaaIndex).toBeGreaterThan(termsIndex);
    expect(amazonIndex).toBeGreaterThan(termsIndex);
    // A hostile path can never break out of the XML element.
    const hostile = buildSitemapXml(['/ads/evil.com"></loc><loc>https://evil.example']);
    expect(hostile).toContain("&quot;");
    expect(hostile).not.toContain("<loc>https://evil.example</loc>");
  });

	it("disallows auth-only surfaces in robots.txt but keeps /share crawlable", () => {
		const robots = publicSeoFileForPathname("/robots.txt");

		expect(robots?.body).toContain("Disallow: /app/");
		// Bare /app (the URL users actually link to) needs its own rule — the
		// trailing-slash prefix rule "/app/" does not match it. "$" anchors the
		// rule so hypothetical future public paths like /apply stay crawlable.
		expect(robots?.body).toContain("Disallow: /app$");
		expect(robots?.body).not.toContain("Disallow: /app\n");
		expect(robots?.body).toContain("Disallow: /export/");
		expect(robots?.body).toContain("Disallow: /api/");
		expect(robots?.body).toContain("Allow: /api/docs");
		// /share is de-indexed via the x-robots-tag header in
		// workers/security-headers.ts; blocking the crawl here would hide that
		// header from crawlers and leave bare URLs indexable.
		expect(robots?.body).not.toContain("Disallow: /share");
	});

  it("keeps security.txt canonical and contact addresses on the io domain", () => {
    const rootSecurity = readFileSync("public/security.txt", "utf8");
    const wellKnownSecurity = readFileSync("public/.well-known/security.txt", "utf8");

    expect(wellKnownSecurity).toBe(rootSecurity);
    expect(rootSecurity).toContain("Contact: mailto:support@0509.io");
    expect(rootSecurity).toContain("Canonical: https://0509.io/.well-known/security.txt");
    expect(rootSecurity).not.toContain("0509.in");
  });

  it("keeps the cached social card customer-facing", () => {
    const card = publicSeoFileForPathname("/social-card.svg");

    expect(card?.body).toContain("Watch ads and landing pages with sources.");
    expect(card?.body).toContain("Saved evidence");
    expect(card?.body).not.toContain("with proof");
    expect(card?.body).not.toContain("Saved proof");
  });

  it("keeps skill.md entry points on the io domain", () => {
    const skill = readFileSync("public/.well-known/skill.md", "utf8");

    expect(skill).toContain("https://0509.io/");
    expect(skill).toContain("https://0509.io/api/docs");
    expect(skill).toContain("support@0509.io");
    expect(skill).not.toContain("0509.in");
    expect(skill).not.toContain("Slack-ready");
    expect(skill).not.toContain("Slack delivery");
    expect(skill).not.toContain("configured Slack target");
    expect(skill).toContain("Email is the verified automated delivery channel for launch.");
  });
});
