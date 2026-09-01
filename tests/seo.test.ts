import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { publicSeoFileForPathname } from "~/lib/seo";

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
    expect(sitemap?.body).toContain("https://0509.io/proof");
    expect(sitemap?.body).toContain("https://0509.io/privacy");
    expect(sitemap?.body).toContain("https://0509.io/terms");
    // Funnel entry points (feat/funnel-seo): the public search preview and
    // all six compare pages are deliberately crawlable. /auth/signup is NOT in
    // the sitemap — auth/action surfaces carry noindex and stay out so Google
    // does not index the signup entry (see NOINDEX_ACTION_SURFACES in seo.ts).
    expect(sitemap?.body).toContain("<loc>https://0509.io/search</loc>");
    expect(sitemap?.body).not.toContain("<loc>https://0509.io/auth/signup</loc>");
    // Restored after the #944/#945 404s cleared (#963): /pricing must stay in
    // the published sitemap with the compare pages, never behind a later drop.
    expect(sitemap?.body).toContain("<loc>https://0509.io/pricing</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/compare/magicbrief</loc>");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/compare/meta-ad-library</loc>",
    );
    expect(sitemap?.body).toContain("<loc>https://0509.io/compare/visualping</loc>");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/compare/visualping-ad-library</loc>",
    );
    expect(sitemap?.body).toContain("<loc>https://0509.io/compare/spyland</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/compare/pulzifi</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/compare/foreplay</loc>");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/compare/foreplay-spyder</loc>",
    );
    expect(sitemap?.body).toContain("<loc>https://0509.io/compare/panoramata</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/compare/adspyder</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/switch/magicbrief</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/switch/panoramata</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/switch/visualping</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/sneaker-resale</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/de/sneaker-resale</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/ja/sneaker-resale</loc>");
    expect(sitemap?.body).toContain("<loc>https://0509.io/pt-br/sneaker-resale</loc>");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/ad-aggression</loc>",
    );
    // Metadata: static entries carry changefreq and priority.
    expect(sitemap?.body).toContain("<changefreq>daily</changefreq>");
    expect(sitemap?.body).toContain("<priority>1.0</priority>");
    expect(sitemap?.body).toContain("<changefreq>yearly</changefreq>");
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

	it("denies AI training crawlers in robots.txt but keeps AI answer engines allowed (docs/ai-crawler-policy.md)", () => {
		const robots = publicSeoFileForPathname("/robots.txt");

		// Training/fine-tuning crawlers are denied with their own group.
		for (const agent of [
			"Amazonbot",
			"Applebot-Extended",
			"Bytespider",
			"CCBot",
			"ClaudeBot",
			"CloudflareBrowserRenderingCrawler",
			"Google-Extended",
			"GPTBot",
			"meta-externalagent",
		]) {
			expect(robots?.body, `${agent} should be denied`).toContain(
				`User-agent: ${agent}\nDisallow: /`,
			);
		}

		// AI answer/reference engines are NOT named in any deny group; they
		// fall through to the wildcard allow group.
		for (const agent of [
			"PerplexityBot",
			"OAI-SearchBot",
			"ChatGPT-User",
			"Claude-By-Cloudflare",
			"Googlebot",
		]) {
			expect(robots?.body, `${agent} should not be denied`).not.toContain(
				`User-agent: ${agent}`,
			);
		}

		// The wildcard group still allows the public crawl for everyone else.
		expect(robots?.body).toContain("Allow: /\nSitemap:");
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

