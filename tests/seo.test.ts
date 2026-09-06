import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { publicSeoFileForPathname, SITEMAP_PATHS, sitemapXmlForPathnames } from "~/lib/seo";

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

describe("sitemapXmlForPathnames (dynamic brand-page sitemap builder)", () => {
  it("emits every SITEMAP_PATHS entry and appends extra pathnames in order", () => {
    const xml = sitemapXmlForPathnames(["/ads/nykaa.com", "/ads/zara.com"]);

    for (const path of SITEMAP_PATHS) {
      // canonicalUrl("/") keeps the trailing slash; all other paths are bare.
      expect(xml).toContain(
        `<url><loc>https://0509.io${path === "/" ? "/" : path}</loc></url>`,
      );
    }
    expect(xml).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
    expect(xml).toContain("<url><loc>https://0509.io/ads/zara.com</loc></url>");
    // Static entries come first, extras after, one <url> per line.
    expect(xml.indexOf("/ads/nykaa.com")).toBeGreaterThan(xml.indexOf("/terms"));
    expect(xml.match(/<url>/g)).toHaveLength(SITEMAP_PATHS.length + 2);
  });

  it("deduplicates extras against the static set and against each other", () => {
    const xml = sitemapXmlForPathnames(["/search", "/ads/nykaa.com", "/ads/nykaa.com"]);

    expect(xml.match(/<url>/g)).toHaveLength(SITEMAP_PATHS.length + 1);
    expect(xml.match(/https:\/\/0509\.io\/ads\/nykaa\.com/g)).toHaveLength(1);
  });

  it("matches the static sitemap byte-for-byte with no extras", () => {
    expect(sitemapXmlForPathnames()).toBe(publicSeoFileForPathname("/sitemap.xml")?.body);
  });

  it("escapes loc text so a crafted path can never inject XML markup", () => {
    const xml = sitemapXmlForPathnames(["/ads/a&b.com", "/ads/<script>.com"]);

    expect(xml).toContain("<loc>https://0509.io/ads/a&amp;b.com</loc>");
    expect(xml).toContain("<loc>https://0509.io/ads/&lt;script&gt;.com</loc>");
    expect(xml).not.toContain("&amp;amp;");
  });
});
