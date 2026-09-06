import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildSitemapXml, publicSeoFileForPathname, SITEMAP_PATHS } from "~/lib/seo";

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

describe("sitemap XML assembly (buildSitemapXml)", () => {
  it("keeps every static path and appends deduplicated dynamic entries in deterministic order", () => {
    const body = buildSitemapXml([
      "/ads/nykaa.com",
      "/ads/zomato.com",
      "/ads/nykaa.com",
      "/ads/amazon.in",
    ]);

    // All 13 static URLs survive, in their canonical form.
    for (const path of SITEMAP_PATHS) {
      const loc = path === "/" ? "https://0509.io/" : `https://0509.io${path}`;
      expect(body).toContain(`<url><loc>${loc}</loc></url>`);
    }

    // Dynamic entries are present, deduplicated, and sorted deterministically.
    const amazon = body.indexOf("https://0509.io/ads/amazon.in");
    const nykaa = body.indexOf("https://0509.io/ads/nykaa.com");
    const zomato = body.indexOf("https://0509.io/ads/zomato.com");
    expect(amazon).toBeGreaterThan(-1);
    expect(nykaa).toBeGreaterThan(-1);
    expect(zomato).toBeGreaterThan(-1);
    expect(amazon).toBeLessThan(nykaa);
    expect(nykaa).toBeLessThan(zomato);
    expect(body.match(/https:\/\/0509\.io\/ads\/nykaa\.com/g)).toHaveLength(1);
  });

  it("never lets dynamic paths inject markup, query strings, or fragments", () => {
    const body = buildSitemapXml([
      "/ads/x.com\"><script>alert(1)</script>",
      "/ads/a.com?utm_source=evil",
      "/ads/b.com#fragment",
      "ads/relative.com",
      "/ads/<b>tag</b>",
    ]);

    expect(body).not.toContain("<script");
    expect(body).not.toContain("?utm_source");
    expect(body).not.toContain("#fragment");
    expect(body).not.toContain("ads/relative.com");
    expect(body).not.toContain("<b>");
    // The safe static entries still render.
    expect(body).toContain("<url><loc>https://0509.io/help</loc></url>");
  });

  it("returns exactly the unchanged static sitemap when no dynamic paths are given", () => {
    expect(buildSitemapXml()).toBe(publicSeoFileForPathname("/sitemap.xml")?.body);
    expect(buildSitemapXml([])).toBe(buildSitemapXml());
  });
});
