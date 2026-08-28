import { describe, expect, it } from "vitest";

import {
	canonicalizeCompetitorSiteUrl,
	classifyCompetitorSitePage,
	COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT,
	COMPETITOR_PAGE_NORMALIZER_VERSION,
	COMPETITOR_PAGE_VISIBLE_TEXT_EXCERPT_LIMIT,
	evaluateWebsitePageChanges,
	normalizeCompetitorPageContent,
	selectCompetitorSiteRunBatch,
	WEBSITE_PAGE_KIND_LABELS,
	websitePageKindLabel,
} from "~/lib/competitor-site-content";
import type {
	CompetitorPageInventory,
	CompetitorSiteCandidate,
	CompetitorSitePageKind,
	NormalizedCompetitorPageContent,
	WebsiteChangeContext,
} from "~/lib/competitor-site-content";

function candidate(
	order: number,
	kind: CompetitorSitePageKind,
	url?: string,
): CompetitorSiteCandidate {
	return {
		canonicalUrl: url ?? `https://example.com/${order}`,
		discoverySource: "sitemap",
		kind,
		discoveryOrder: order,
	};
}

function content(
	canonicalUrl: string,
	overrides: Partial<NormalizedCompetitorPageContent> = {},
): NormalizedCompetitorPageContent {
	return {
		normalizerVersion: COMPETITOR_PAGE_NORMALIZER_VERSION,
		canonicalUrl,
		title: null,
		metaDescription: null,
		visibleTextExcerpt: null,
		visibleTextHash: null,
		offerOrPriceText: null,
		ctaText: null,
		formPresent: false,
		contentHash: `hash:${canonicalUrl}`,
		...overrides,
	};
}

function inventory(
	entries: Array<[string, NormalizedCompetitorPageContent]>,
): CompetitorPageInventory {
	return new Map(entries);
}

function changeContext(overrides: Partial<WebsiteChangeContext> = {}): WebsiteChangeContext {
	return {
		currentInventoryComplete: true,
		priorInventoryComplete: true,
		currentCaptureAt: "2026-08-10T12:00:00.000Z",
		priorCaptureAt: "2026-08-09T12:00:00.000Z",
		...overrides,
	};
}

describe("canonicalizeCompetitorSiteUrl", () => {
	it("rejects empty, invalid, and non-HTTP(S) inputs", () => {
		expect(canonicalizeCompetitorSiteUrl("")).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("   ")).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("not a url")).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("example.com/pricing")).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("ftp://example.com/a")).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("javascript:alert(1)")).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("data:text/html,hi")).toBeNull();
	});

	it("rejects URLs with credentials", () => {
		expect(canonicalizeCompetitorSiteUrl("https://user:pass@example.com/")).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("https://user@example.com/")).toBeNull();
	});

	it("rejects cross-origin URLs when a root origin is supplied", () => {
		const root = "https://example.com";
		expect(canonicalizeCompetitorSiteUrl("https://other.com/pricing", root)).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("http://example.com/pricing", root)).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("https://example.com:8443/pricing", root)).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("https://example.com/pricing", root)).toBe(
			"https://example.com/pricing",
		);
	});

	it("returns null when the root origin itself is unusable", () => {
		expect(canonicalizeCompetitorSiteUrl("https://example.com/a", "not a url")).toBeNull();
		expect(canonicalizeCompetitorSiteUrl("https://example.com/a", "ftp://example.com")).toBeNull();
	});

	it("strips fragments and known tracking parameters, keeps others", () => {
		expect(
			canonicalizeCompetitorSiteUrl(
				"https://example.com/pricing?utm_source=newsletter&gclid=abc&fbclid=def&gbraid=g&msclkid=m&b=2&a=1#fragment",
			),
		).toBe("https://example.com/pricing?a=1&b=2");
		expect(canonicalizeCompetitorSiteUrl("https://example.com/a?utm_campaign=x#top")).toBe(
			"https://example.com/a",
		);
	});

	it("sorts remaining query parameters deterministically", () => {
		expect(canonicalizeCompetitorSiteUrl("https://example.com/a?z=1&a=2&m=3")).toBe(
			"https://example.com/a?a=2&m=3&z=1",
		);
	});

	it("normalizes default ports and keeps non-default ports", () => {
		expect(canonicalizeCompetitorSiteUrl("https://example.com:443/a")).toBe(
			"https://example.com/a",
		);
		expect(canonicalizeCompetitorSiteUrl("http://example.com:80/a")).toBe(
			"http://example.com/a",
		);
		expect(canonicalizeCompetitorSiteUrl("https://example.com:8443/a")).toBe(
			"https://example.com:8443/a",
		);
	});

	it("normalizes a trailing slash without collapsing distinct paths", () => {
		expect(canonicalizeCompetitorSiteUrl("https://example.com/pricing/")).toBe(
			"https://example.com/pricing",
		);
		expect(canonicalizeCompetitorSiteUrl("https://example.com/")).toBe("https://example.com/");
		expect(canonicalizeCompetitorSiteUrl("https://example.com")).toBe("https://example.com/");
		expect(canonicalizeCompetitorSiteUrl("https://example.com/a//b")).toBe(
			"https://example.com/a//b",
		);
		expect(canonicalizeCompetitorSiteUrl("https://example.com/index.html")).toBe(
			"https://example.com/index.html",
		);
	});

	it("dedupes URLs that differ only by fragment, tracking params, port, or slash", () => {
		const forms = [
			"https://example.com/a?b=2&a=1#frag",
			"https://example.com:443/a?a=1&b=2",
			"https://example.com/a?a=1&b=2&utm_source=x",
			"https://example.com/a/?a=1&b=2",
		];
		const canonical = "https://example.com/a?a=1&b=2";
		for (const form of forms) {
			expect(canonicalizeCompetitorSiteUrl(form)).toBe(canonical);
		}
	});
});

describe("classifyCompetitorSitePage", () => {
	it("classifies home exactly", () => {
		expect(classifyCompetitorSitePage("https://example.com")).toBe("home");
		expect(classifyCompetitorSitePage("https://example.com/")).toBe("home");
		expect(classifyCompetitorSitePage("https://example.com/index.html")).toBe("home");
		expect(classifyCompetitorSitePage("https://example.com/home")).toBe("home");
	});

	it("classifies pricing exactly", () => {
		expect(classifyCompetitorSitePage("https://example.com/pricing")).toBe("pricing");
		expect(classifyCompetitorSitePage("https://example.com/pricing/")).toBe("pricing");
		expect(classifyCompetitorSitePage("https://example.com/pricing/enterprise")).toBe("pricing");
		expect(classifyCompetitorSitePage("https://example.com/plans")).toBe("pricing");
	});

	it("classifies changelog exactly", () => {
		expect(classifyCompetitorSitePage("https://example.com/changelog")).toBe("changelog");
		expect(classifyCompetitorSitePage("https://example.com/changelog/2026-08")).toBe("changelog");
		expect(classifyCompetitorSitePage("https://example.com/release-notes")).toBe("changelog");
	});

	it("classifies the remaining kinds by path segment", () => {
		expect(classifyCompetitorSitePage("https://example.com/landing-pages")).toBe("other");
		expect(classifyCompetitorSitePage("https://example.com/product")).toBe("product");
		expect(classifyCompetitorSitePage("https://example.com/features")).toBe("product");
		expect(classifyCompetitorSitePage("https://example.com/blog")).toBe("blog");
		expect(classifyCompetitorSitePage("https://example.com/blog/hello-world")).toBe("blog");
		expect(classifyCompetitorSitePage("https://example.com/docs")).toBe("docs");
		expect(classifyCompetitorSitePage("https://example.com/docs/api")).toBe("docs");
		expect(classifyCompetitorSitePage("https://example.com/about")).toBe("about");
		expect(classifyCompetitorSitePage("https://example.com/contact")).toBe("contact");
		expect(classifyCompetitorSitePage("https://example.com/weird-page")).toBe("other");
	});

	it("classifies careers and legal as first-class kinds by path segment", () => {
		// Q4 (#1385): careers and legal/policy are distinct surfaces, not
		// folded into about/other.
		expect(classifyCompetitorSitePage("https://example.com/careers")).toBe("careers");
		expect(classifyCompetitorSitePage("https://example.com/careers/engineer")).toBe("careers");
		expect(classifyCompetitorSitePage("https://example.com/jobs")).toBe("careers");
		expect(classifyCompetitorSitePage("https://example.com/hiring")).toBe("careers");
		expect(classifyCompetitorSitePage("https://example.com/legal")).toBe("legal");
		expect(classifyCompetitorSitePage("https://example.com/privacy")).toBe("legal");
		expect(classifyCompetitorSitePage("https://example.com/privacy-policy")).toBe("legal");
		expect(classifyCompetitorSitePage("https://example.com/terms")).toBe("legal");
		expect(classifyCompetitorSitePage("https://example.com/terms-of-service")).toBe("legal");
		expect(classifyCompetitorSitePage("https://example.com/cookies")).toBe("legal");
		expect(classifyCompetitorSitePage("https://example.com/gdpr")).toBe("legal");
		expect(classifyCompetitorSitePage("https://example.com/imprint")).toBe("legal");
	});

	it("uses first-segment-wins deterministically", () => {
		expect(classifyCompetitorSitePage("https://example.com/pricing/changelog")).toBe("pricing");
		expect(classifyCompetitorSitePage("https://example.com/changelog/pricing")).toBe("changelog");
		expect(classifyCompetitorSitePage("https://example.com/home/pricing")).toBe("pricing");
	});

	it("uses title hints when the path is unknown", () => {
		expect(classifyCompetitorSitePage("https://example.com/x", { title: "Pricing & Plans" })).toBe(
			"pricing",
		);
		expect(classifyCompetitorSitePage("https://example.com/x", { title: "What's new" })).toBe(
			"changelog",
		);
		expect(classifyCompetitorSitePage("https://example.com/x", { title: "Privacy Policy" })).toBe(
			"legal",
		);
		expect(classifyCompetitorSitePage("https://example.com/x", { title: "Terms of Service" })).toBe(
			"legal",
		);
		expect(classifyCompetitorSitePage("https://example.com/x", { title: "We're hiring" })).toBe(
			"careers",
		);
		expect(classifyCompetitorSitePage("https://example.com/x", { title: "Open roles" })).toBe(
			"careers",
		);
		expect(
			classifyCompetitorSitePage("https://example.com/x", { title: "Some random page" }),
		).toBe("other");
	});

	it("honors an explicit kind hint and falls back to hint paths", () => {
		expect(classifyCompetitorSitePage("https://example.com/x", { kind: "landing" })).toBe(
			"landing",
		);
		expect(classifyCompetitorSitePage("not a url", { path: "/pricing" })).toBe("pricing");
		expect(classifyCompetitorSitePage("not a url")).toBe("other");
	});
});

describe("WEBSITE_PAGE_KIND_LABELS / websitePageKindLabel", () => {
	it("provides a display label for every kind in the vocabulary", () => {
		const kinds: CompetitorSitePageKind[] = [
			"home",
			"pricing",
			"changelog",
			"landing",
			"product",
			"blog",
			"docs",
			"about",
			"careers",
			"legal",
			"contact",
			"other",
		];
		for (const kind of kinds) {
			expect(WEBSITE_PAGE_KIND_LABELS[kind]).toEqual(expect.any(String));
			expect(WEBSITE_PAGE_KIND_LABELS[kind].length).toBeGreaterThan(0);
			expect(websitePageKindLabel(kind)).toBe(WEBSITE_PAGE_KIND_LABELS[kind]);
		}
	});

	it("labels the new first-class kinds distinctly", () => {
		expect(WEBSITE_PAGE_KIND_LABELS.careers).toBe("Careers");
		expect(WEBSITE_PAGE_KIND_LABELS.legal).toBe("Legal & Policy");
		// Distinct from the kinds they used to fold into.
		expect(WEBSITE_PAGE_KIND_LABELS.careers).not.toBe(WEBSITE_PAGE_KIND_LABELS.about);
		expect(WEBSITE_PAGE_KIND_LABELS.legal).not.toBe(WEBSITE_PAGE_KIND_LABELS.other);
	});
});

describe("normalizeCompetitorPageContent", () => {
	const baseHtml = `<html><head><title>  Acme   Pricing </title>
		<meta name="description" content="  Plans   for teams ">
		<script>document.write("noise");</script></head>
		<body><h1>Acme Pricing</h1><p>Start for $29/mo</p><div class="cta"><a href="/signup">Get started</a></div></body></html>`;

	it("suppresses script/style/noscript/svg/template content and markup", async () => {
		const html = `<html><body>
			<script>window.tracking = true;</script>
			<style>.hidden{display:none}</style>
			<noscript>No JS fallback text</noscript>
			<svg><text>vector text</text></svg>
			<template><p>template text</p></template>
			<p>Real <b>bold</b> content</p>
		</body></html>`;
		const result = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: html,
		});
		expect(result.visibleTextExcerpt).toBe("Real bold content");
		expect(result.title).toBeNull();
		expect(result.metaDescription).toBeNull();
	});

	it("strips malformed script closers from competitor page HTML", async () => {
		const html = `<html><body>
			<script>alert(1)</script foo>
			<style>body{background:url("//evil.example/?leak")}</style >
			<p>Safe copy</p>
		</body></html>`;
		const result = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/malformed",
			rawHtml: html,
		});
		expect(result.visibleTextExcerpt).toBe("Safe copy");
		expect(result.visibleTextExcerpt).not.toMatch(/script/i);
	});

	it("decodes common HTML entities and collapses whitespace", async () => {
		const result = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml:
				"<p>Tom &amp; Jerry &lt;3 &quot;quoted&quot; &#36;5 &nbsp; &mdash; end</p><p>  line1\n\n   line2\t\tline3  </p>",
		});
		expect(result.visibleTextExcerpt).toBe("Tom & Jerry <3 \"quoted\" $5 — end line1 line2 line3");
	});

	it("removes standalone dynamic timestamps and dates", async () => {
		const result = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml:
				"<p>Last updated Aug 10, 2026</p><p>Published 2026-08-10 at 09:15:00 AM</p><p>Fetched 08/10/2026</p><p>Version 2.4.1 stays</p>",
		});
		expect(result.visibleTextExcerpt).toBe(
			"Last updated Published at Fetched Version 2.4.1 stays",
		);
	});

	it("extracts and bounds title and meta description from HTML", async () => {
		const result = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: baseHtml,
		});
		expect(result.title).toBe("Acme Pricing");
		expect(result.metaDescription).toBe("Plans for teams");
	});

	it("honors explicit title/meta overrides and empty overrides become null", async () => {
		const result = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: baseHtml,
			title: "  Override   Title ",
			metaDescription: "",
		});
		expect(result.title).toBe("Override Title");
		expect(result.metaDescription).toBeNull();
	});

	it("bounds the visible text excerpt to 2,000 characters", async () => {
		const longText = `${"word ".repeat(600)}END`;
		const result = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: `<p>${longText}</p>`,
		});
		expect(result.visibleTextExcerpt?.length).toBe(COMPETITOR_PAGE_VISIBLE_TEXT_EXCERPT_LIMIT);
		expect(result.visibleTextExcerpt).toBe(
			longText.replace(/\s+/g, " ").trim().slice(0, COMPETITOR_PAGE_VISIBLE_TEXT_EXCERPT_LIMIT),
		);
	});

	it("keeps explicit nulls for empty content", async () => {
		const result = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: "<html><head></head><body><script>x()</script></body></html>",
		});
		expect(result.title).toBeNull();
		expect(result.metaDescription).toBeNull();
		expect(result.visibleTextExcerpt).toBeNull();
		expect(result.visibleTextHash).toBeNull();
		expect(result.offerOrPriceText).toBeNull();
		expect(result.ctaText).toBeNull();
	});

	it("computes stable hashes and versioned content hashes", async () => {
		const input = { canonicalUrl: "https://example.com/a", rawHtml: baseHtml };
		const first = await normalizeCompetitorPageContent(input);
		const second = await normalizeCompetitorPageContent(input);
		expect(first).toEqual(second);
		expect(first.visibleTextHash).toBeTruthy();
		expect(first.contentHash).toBeTruthy();
		expect(first.normalizerVersion).toBe(COMPETITOR_PAGE_NORMALIZER_VERSION);

		const different = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: baseHtml.replace("$29/mo", "$39/mo"),
		});
		expect(different.contentHash).not.toBe(first.contentHash);
		expect(different.visibleTextHash).not.toBe(first.visibleTextHash);
	});

	it("extracts offer/price text deterministically", async () => {
		const priced = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: "<p>Start for $29/mo, no card required</p>",
		});
		expect(priced.offerOrPriceText).toBe("$29/mo");

		const free = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: "<p>Try our Free trial today</p>",
		});
		expect(free.offerOrPriceText?.toLowerCase()).toBe("free trial");
	});

	it("extracts CTA text deterministically", async () => {
		const cta = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: "<p>Ready? <a href='/signup'>Get started</a> now.</p>",
		});
		expect(cta.ctaText).toBe("Get started");

		const none = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: "<p>Just plain words here.</p>",
		});
		expect(none.ctaText).toBeNull();
		expect(none.offerOrPriceText).toBeNull();
	});

	it("detects forms from form and input elements", async () => {
		const withForm = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: "<form action='/signup'><input type='email' name='email'></form>",
		});
		expect(withForm.formPresent).toBe(true);

		const withInputOnly = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: "<input type='email' name='email'>",
		});
		expect(withInputOnly.formPresent).toBe(true);

		const without = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: "<p>No form here</p>",
		});
		expect(without.formPresent).toBe(false);
	});
});

describe("selectCompetitorSiteRunBatch", () => {
	it("always selects home/pricing/changelog first regardless of discovery order", () => {
		const candidates = [
			candidate(300, "changelog"),
			candidate(200, "pricing"),
			candidate(100, "home"),
			candidate(1, "other"),
			candidate(2, "blog"),
		];
		const batch = selectCompetitorSiteRunBatch(candidates, { nextCursor: null });
		expect(batch.candidates.slice(0, 3).map((c) => c.kind)).toEqual([
			"home",
			"pricing",
			"changelog",
		]);
		expect(batch.candidates.slice(3).map((c) => c.canonicalUrl)).toEqual([
			"https://example.com/1",
			"https://example.com/2",
		]);
	});

	it("rotates fairly through remaining candidates and advances the cursor", () => {
		const candidates = [
			candidate(0, "home"),
			candidate(1, "pricing"),
			candidate(2, "changelog"),
			...Array.from({ length: 57 }, (_, i) => candidate(i + 3, "landing")),
		];
		const run1 = selectCompetitorSiteRunBatch(candidates, { nextCursor: null });
		expect(run1.candidates).toHaveLength(50);
		expect(run1.candidates.slice(0, 3).map((c) => c.kind)).toEqual([
			"home",
			"pricing",
			"changelog",
		]);
		expect(run1.candidates.slice(3).map((c) => c.discoveryOrder)).toEqual(
			Array.from({ length: 47 }, (_, i) => i + 3),
		);
		expect(run1.nextCursor).toBe("50");

		const run2 = selectCompetitorSiteRunBatch(candidates, { nextCursor: run1.nextCursor });
		expect(run2.candidates).toHaveLength(50);
		expect(run2.candidates.slice(0, 3).map((c) => c.kind)).toEqual([
			"home",
			"pricing",
			"changelog",
		]);
		expect(run2.candidates.slice(3).map((c) => c.discoveryOrder)).toEqual([
			...Array.from({ length: 10 }, (_, i) => i + 50),
			...Array.from({ length: 37 }, (_, i) => i + 3),
		]);
		expect(run2.nextCursor).toBe("40");

		// The rotation advances a fair window: the 10 previously-unseen
		// candidates (discoveryOrder 50..59) enter this run's rotation.
		const run1Rotation = new Set(run1.candidates.slice(3).map((c) => c.discoveryOrder));
		for (const order of Array.from({ length: 10 }, (_, i) => i + 50)) {
			expect(run1Rotation.has(order)).toBe(false);
			expect(run2.candidates.some((c) => c.discoveryOrder === order)).toBe(true);
		}
	});

	it("wraps the cursor after a full rotation cycle", () => {
		const candidates = [
			candidate(0, "home"),
			candidate(1, "pricing"),
			candidate(2, "changelog"),
			candidate(3, "other"),
			candidate(4, "blog"),
			candidate(5, "docs"),
		];
		const run1 = selectCompetitorSiteRunBatch(candidates, { nextCursor: null });
		expect(run1.candidates).toHaveLength(6);
		expect(run1.nextCursor).toBe("3");

		const run2 = selectCompetitorSiteRunBatch(candidates, { nextCursor: run1.nextCursor });
		expect(run2.candidates.map((c) => c.discoveryOrder)).toEqual(
			run1.candidates.map((c) => c.discoveryOrder),
		);
		expect(run2.nextCursor).toBe("3");
	});

	it("clamps maxPagesPerRun to [1, 50] with a default of 50", () => {
		const candidates = Array.from({ length: 60 }, (_, i) => candidate(i, "other"));
		expect(selectCompetitorSiteRunBatch(candidates, { nextCursor: null }).candidates).toHaveLength(
			50,
		);
		expect(
			selectCompetitorSiteRunBatch(candidates, { nextCursor: null }, { maxPagesPerRun: 100 })
				.candidates,
		).toHaveLength(50);
		expect(
			selectCompetitorSiteRunBatch(candidates, { nextCursor: null }, { maxPagesPerRun: 2 })
				.candidates,
		).toHaveLength(2);
		expect(
			selectCompetitorSiteRunBatch(candidates, { nextCursor: null }, { maxPagesPerRun: -5 })
				.candidates,
		).toHaveLength(1);
	});

	it("does not rotate when capacity is consumed by priority candidates", () => {
		const candidates = [
			candidate(10, "home"),
			candidate(20, "pricing"),
			candidate(30, "changelog"),
			candidate(1, "other"),
		];
		const batch = selectCompetitorSiteRunBatch(
			candidates,
			{ nextCursor: null },
			{ maxPagesPerRun: 2 },
		);
		expect(batch.candidates.map((c) => c.kind)).toEqual(["home", "pricing"]);
		expect(batch.nextCursor).toBe("1");
	});

	it("handles empty candidate lists and returns retry-identical output", () => {
		expect(selectCompetitorSiteRunBatch([], { nextCursor: null })).toEqual({
			candidates: [],
			nextCursor: null,
		});

		const candidates = [
			candidate(0, "home"),
			candidate(1, "pricing"),
			...Array.from({ length: 30 }, (_, i) => candidate(i + 2, "other")),
		];
		const args = [
			candidates,
			{ nextCursor: "5" },
			{ maxPagesPerRun: 17 },
		] as const;
		expect(selectCompetitorSiteRunBatch(...args)).toEqual(
			selectCompetitorSiteRunBatch(...args),
		);
	});

	it("restarts the cycle when the cursor no longer matches any candidate", () => {
		const candidates = [
			candidate(0, "home"),
			candidate(1, "pricing"),
			candidate(2, "other"),
			candidate(3, "other"),
		];
		const batch = selectCompetitorSiteRunBatch(candidates, { nextCursor: "999" });
		expect(batch.candidates.slice(2).map((c) => c.discoveryOrder)).toEqual([2, 3]);
	});
});

describe("evaluateWebsitePageChanges", () => {
	it("records page additions with completeness evidence", () => {
		const changes = evaluateWebsitePageChanges(
			inventory([]),
			inventory([["https://example.com/pricing", content("https://example.com/pricing")]]),
			changeContext(),
		);
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({
			kind: "page-added",
			field: "page",
			canonicalUrl: "https://example.com/pricing",
			before: null,
			after: "https://example.com/pricing",
			material: true,
			materialReason: "page added",
			dedupeKey: "page-added|page|https://example.com/pricing",
			priorCaptureAt: null,
			currentCaptureAt: "2026-08-10T12:00:00.000Z",
			inventoryCompleteness: {
				priorInventoryComplete: true,
				currentInventoryComplete: true,
			},
		});
	});

	it("records page removals only when the current inventory is complete", () => {
		const prior = inventory([["https://example.com/old", content("https://example.com/old")]]);
		const withComplete = evaluateWebsitePageChanges(
			prior,
			inventory([]),
			changeContext({ currentInventoryComplete: true }),
		);
		expect(withComplete).toHaveLength(1);
		expect(withComplete[0]).toMatchObject({
			kind: "page-removed",
			before: "https://example.com/old",
			after: null,
			material: true,
			materialReason: "page removed",
			dedupeKey: "page-removed|page|https://example.com/old",
			priorCaptureAt: "2026-08-09T12:00:00.000Z",
			currentCaptureAt: null,
		});

		const withIncomplete = evaluateWebsitePageChanges(
			prior,
			inventory([]),
			changeContext({ currentInventoryComplete: false }),
		);
		expect(withIncomplete).toEqual([]);
	});

	it("records additions even when the prior inventory was incomplete", () => {
		const changes = evaluateWebsitePageChanges(
			inventory([]),
			inventory([["https://example.com/new", content("https://example.com/new")]]),
			changeContext({ priorInventoryComplete: false }),
		);
		expect(changes).toHaveLength(1);
		expect(changes[0].inventoryCompleteness).toEqual({
			priorInventoryComplete: false,
			currentInventoryComplete: true,
		});
	});

	it("flags field changes with materiality and stable reasons", () => {
		const prior = inventory([
			[
				"https://example.com/a",
				content("https://example.com/a", {
					title: "Old Title",
					metaDescription: "Old meta",
					visibleTextExcerpt: "Hello world",
					visibleTextHash: "hash-prior",
					offerOrPriceText: "$19/mo",
					ctaText: "Sign up",
					formPresent: true,
				}),
			],
		]);
		const current = inventory([
			[
				"https://example.com/a",
				content("https://example.com/a", {
					title: "New Title",
					metaDescription: "New meta",
					visibleTextExcerpt: "Hello brave new world",
					visibleTextHash: "hash-current",
					offerOrPriceText: "$29/mo",
					ctaText: "Buy now",
					formPresent: false,
				}),
			],
		]);
		const changes = evaluateWebsitePageChanges(prior, current, changeContext());
		expect(changes.map((c) => c.field)).toEqual([
			"title",
			"meta",
			"visibleText",
			"offerPrice",
			"cta",
			"form",
		]);
		const byField = new Map(changes.map((c) => [c.field, c]));
		expect(byField.get("title")).toMatchObject({
			kind: "field-changed",
			before: "Old Title",
			after: "New Title",
			material: false,
			materialReason: null,
			dedupeKey: "field-changed|title|https://example.com/a",
		});
		expect(byField.get("meta")).toMatchObject({ material: false, materialReason: null });
		expect(byField.get("visibleText")).toMatchObject({
			before: "Hello world",
			after: "Hello brave new world",
			material: true,
			materialReason: "meaningful visible text changed",
		});
		expect(byField.get("offerPrice")).toMatchObject({
			before: "$19/mo",
			after: "$29/mo",
			material: true,
			materialReason: "offer or price changed",
		});
		expect(byField.get("cta")).toMatchObject({
			before: "Sign up",
			after: "Buy now",
			material: true,
			materialReason: "call to action changed",
		});
		expect(byField.get("form")).toMatchObject({
			before: "present",
			after: "absent",
			material: false,
			materialReason: null,
		});
	});

	it("produces no facts for cosmetic-only or out-of-window changes", async () => {
		const html1 = `<html><head><title>Same</title></head><body>
			<h1>Hello</h1><p>Updated Aug 10, 2026</p><p>  Spaces   and
			line breaks   here </p></body></html>`;
		const html2 = `<html><head><title>Same</title></head><body>
			<script>var now = "Aug 11, 2026";</script>
			<h1>Hello</h1><p>Updated Aug 11, 2026</p><p>Spaces and line breaks here</p></body></html>`;
		const first = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: html1,
		});
		const second = await normalizeCompetitorPageContent({
			canonicalUrl: "https://example.com/a",
			rawHtml: html2,
		});
		expect(first).toEqual(second);
		expect(
			evaluateWebsitePageChanges(
				inventory([["https://example.com/a", first]]),
				inventory([["https://example.com/a", second]]),
				changeContext(),
			),
		).toEqual([]);
	});

	it("skips a visible-text fact when only the hash changes outside the excerpt window", () => {
		const changes = evaluateWebsitePageChanges(
			inventory([
				[
					"https://example.com/a",
					content("https://example.com/a", {
						visibleTextExcerpt: "same visible window",
						visibleTextHash: "hash-prior",
					}),
				],
			]),
			inventory([
				[
					"https://example.com/a",
					content("https://example.com/a", {
						visibleTextExcerpt: "same visible window",
						visibleTextHash: "hash-current",
					}),
				],
			]),
			changeContext(),
		);
		expect(changes).toEqual([]);
	});

	it("bounds before/after values to 500 characters", () => {
		const longTitle = "t".repeat(600);
		const changes = evaluateWebsitePageChanges(
			inventory([
				[
					"https://example.com/a",
					content("https://example.com/a", { title: longTitle }),
				],
			]),
			inventory([
				["https://example.com/a", content("https://example.com/a", { title: "Short" })],
			]),
			changeContext(),
		);
		expect(changes).toHaveLength(1);
		expect(changes[0].before).toBe("t".repeat(COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT));
		expect(changes[0].before?.length).toBe(COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT);
		expect(changes[0].after).toBe("Short");
	});

	it("orders facts stably by URL then field priority", () => {
		const prior = inventory([
			[
				"https://a.example.com",
				content("https://a.example.com", {
					title: "Old A",
					metaDescription: "Meta A",
				}),
			],
			["https://b.example.com", content("https://b.example.com", { title: "Old B" })],
		]);
		const current = inventory([
			[
				"https://a.example.com",
				content("https://a.example.com", {
					title: "New A",
					metaDescription: "Meta A",
				}),
			],
			["https://b.example.com", content("https://b.example.com", { title: "New B" })],
			["https://c.example.com", content("https://c.example.com")],
		]);
		const changes = evaluateWebsitePageChanges(prior, current, changeContext());
		expect(changes.map((c) => c.dedupeKey)).toEqual([
			"field-changed|title|https://a.example.com",
			"field-changed|title|https://b.example.com",
			"page-added|page|https://c.example.com",
		]);
	});

	it("is retry-identical and keeps capture times null when not supplied", () => {
		const prior = inventory([
			["https://example.com/a", content("https://example.com/a", { title: "Old" })],
		]);
		const current = inventory([
			["https://example.com/a", content("https://example.com/a", { title: "New" })],
			["https://example.com/b", content("https://example.com/b")],
		]);
		const context = changeContext({
			currentCaptureAt: undefined,
			priorCaptureAt: undefined,
		});
		const first = evaluateWebsitePageChanges(prior, current, context);
		const second = evaluateWebsitePageChanges(prior, current, context);
		expect(first).toEqual(second);
		for (const fact of first) {
			expect(fact.priorCaptureAt).toBeNull();
			expect(fact.currentCaptureAt).toBeNull();
		}
	});

	it("produces no facts for identical inventories", () => {
		const prior = inventory([
			["https://example.com/a", content("https://example.com/a", { title: "Same" })],
		]);
		const current = inventory([
			["https://example.com/a", content("https://example.com/a", { title: "Same" })],
		]);
		expect(evaluateWebsitePageChanges(prior, current, changeContext())).toEqual([]);
	});
});
