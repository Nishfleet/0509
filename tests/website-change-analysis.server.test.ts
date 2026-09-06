import { describe, expect, it, vi } from "vitest";

import {
	evaluateWebsitePageChanges,
	normalizeCompetitorPageContent,
	type CompetitorPageInventory,
	type CompetitorSiteChangeField,
	type NormalizedCompetitorPageContent,
	type WebsitePageChange,
} from "~/lib/competitor-site-content";
import {
	buildDeterministicChangeSummary,
	buildWebsiteChangeEventDraft,
	buildWebsiteChangeEventDrafts,
	deltaLooksLikeChurn,
	hasObservableContentChange,
	readWebsiteChangeEventMetadata,
	scoreWebsitePageChange,
	scoreWebsitePageChanges,
	summarizeWebsiteChange,
	WEBSITE_CHANGE_MATERIAL_THRESHOLD,
	WEBSITE_CHANGE_MEDIUM_THRESHOLD,
	type ScoredWebsitePageChange,
} from "~/lib/website-change-analysis.server";

// ==== Fixtures ====

const CAPTURE_AT = "2026-08-14T10:00:00.000Z";
const PRIOR_CAPTURE_AT = "2026-08-13T10:00:00.000Z";

function fieldDiff(
	field: CompetitorSiteChangeField,
	before: string | null,
	after: string | null,
	canonicalUrl = "https://example.com/page",
): WebsitePageChange {
	return {
		kind: "field-changed",
		field,
		canonicalUrl,
		before,
		after,
		material: true,
		materialReason: "fixture",
		dedupeKey: `field-changed|${field}|${canonicalUrl}`,
		priorCaptureAt: PRIOR_CAPTURE_AT,
		currentCaptureAt: CAPTURE_AT,
		inventoryCompleteness: null,
	};
}

function addedDiff(canonicalUrl: string): WebsitePageChange {
	return {
		kind: "page-added",
		field: "page",
		canonicalUrl,
		before: null,
		after: canonicalUrl,
		material: true,
		materialReason: "page added",
		dedupeKey: `page-added|page|${canonicalUrl}`,
		priorCaptureAt: null,
		currentCaptureAt: CAPTURE_AT,
		inventoryCompleteness: {
			priorInventoryComplete: true,
			currentInventoryComplete: true,
		},
	};
}

function removedDiff(canonicalUrl: string): WebsitePageChange {
	return {
		kind: "page-removed",
		field: "page",
		canonicalUrl,
		before: canonicalUrl,
		after: null,
		material: true,
		materialReason: "page removed",
		dedupeKey: `page-removed|page|${canonicalUrl}`,
		priorCaptureAt: PRIOR_CAPTURE_AT,
		currentCaptureAt: null,
		inventoryCompleteness: {
			priorInventoryComplete: true,
			currentInventoryComplete: true,
		},
	};
}

async function normalizePage(
	canonicalUrl: string,
	rawHtml: string,
): Promise<NormalizedCompetitorPageContent> {
	return normalizeCompetitorPageContent({ canonicalUrl, rawHtml });
}

function inventory(entries: Array<[string, NormalizedCompetitorPageContent]>): CompetitorPageInventory {
	return new Map(entries);
}

function changeContext() {
	return {
		currentInventoryComplete: true,
		priorInventoryComplete: true,
		currentCaptureAt: CAPTURE_AT,
		priorCaptureAt: PRIOR_CAPTURE_AT,
	};
}

const PRICING_BEFORE_HTML = `<html><head><title>Acme Pricing</title></head><body>
<h1>Simple pricing</h1>
<p>Starts at $19/mo per user with a 14-day trial.</p>
<a href="/signup">Start your free trial</a>
</body></html>`;

const PRICING_AFTER_HTML = PRICING_BEFORE_HTML.replace("$19/mo", "$29/mo");

const BLOG_BEFORE_HTML = `<html><head><title>Acme Blog</title></head><body>
<h1>Pricing strategy notes</h1>
<p>Our team writes about pricing strategy and how modern software companies grow revenue.</p>
</body></html>`;

const BLOG_TYPO_HTML = BLOG_BEFORE_HTML.replace("grow revenue", "grows revenue");

const AD_CHURN_BEFORE_HTML = `<html><head><title>Acme</title></head><body>
<div class="ad-slot">Sponsored · Buy now · $19.99 today</div>
<p>Acme helps teams ship faster with less effort every single day.</p>
</body></html>`;

const AD_CHURN_AFTER_HTML = `<html><head><title>Acme</title></head><body>
<div class="ad-slot">Advertisement · Claim deal · $9.99 today</div>
<p>Acme helps teams ship faster with less effort every single day.</p>
</body></html>`;

const SCRIPT_CHURN_BEFORE_HTML = `<html><head><title>Acme</title><script>var v="aaa";</script></head><body>
<p>Acme helps teams ship faster with less effort every single day.</p>
</body></html>`;

const SCRIPT_CHURN_AFTER_HTML = `<html><head><title>Acme</title><script>var v="bbb";</script></head><body>
<p>Acme helps teams ship faster with less effort every single day.</p>
</body></html>`;

async function diffsBetween(
	pageKindUrl: string,
	beforeHtml: string,
	afterHtml: string,
): Promise<WebsitePageChange[]> {
	const prior = await normalizePage(pageKindUrl, beforeHtml);
	const current = await normalizePage(pageKindUrl, afterHtml);
	return evaluateWebsitePageChanges(inventory([[pageKindUrl, prior]]), inventory([[pageKindUrl, current]]), changeContext());
}

function mockEnv(run: ReturnType<typeof vi.fn>) {
	return { AI: { run } } as never;
}

// ==== 1. Scoring matrix ====

describe("scoreWebsitePageChange matrix", () => {
	it("pricing: price/offer and CTA are material (>=85); headline, subcopy, meta, form are medium", () => {
		const price = scoreWebsitePageChange("pricing", fieldDiff("offerPrice", "$19/mo", "$29/mo"));
		const cta = scoreWebsitePageChange("pricing", fieldDiff("cta", "Start your free trial", "Get started"));
		expect(price.score).toBeGreaterThanOrEqual(WEBSITE_CHANGE_MATERIAL_THRESHOLD);
		expect(price.material).toBe(true);
		expect(price.verdict).toBe("material");
		expect(cta.score).toBeGreaterThanOrEqual(WEBSITE_CHANGE_MATERIAL_THRESHOLD);
		expect(cta.material).toBe(true);

		for (const field of ["title", "visibleText", "meta", "form"] as const) {
			const scored = scoreWebsitePageChange("pricing", fieldDiff(field, "a", "b"));
			expect(scored.score).toBeGreaterThanOrEqual(WEBSITE_CHANGE_MEDIUM_THRESHOLD);
			expect(scored.score).toBeLessThan(WEBSITE_CHANGE_MATERIAL_THRESHOLD);
			expect(scored.verdict).toBe("medium");
			expect(scored.material).toBe(false);
		}
	});

	it("home/landing: offer, CTA, headline, form are material; subcopy is medium", () => {
		for (const kind of ["home", "landing"] as const) {
			for (const field of ["offerPrice", "cta", "form", "title"] as const) {
				const scored = scoreWebsitePageChange(kind, fieldDiff(field, "a", "b"));
				expect(scored.material).toBe(true);
				expect(scored.score).toBeGreaterThanOrEqual(WEBSITE_CHANGE_MATERIAL_THRESHOLD);
			}
			for (const field of ["visibleText", "meta"] as const) {
				const scored = scoreWebsitePageChange(kind, fieldDiff(field, "a longer before text", "a longer after text"));
				expect(scored.verdict).toBe("medium");
				expect(scored.material).toBe(false);
			}
		}
	});

	it("changelog: ANY content change is material", () => {
		for (const field of ["offerPrice", "cta", "form", "title", "visibleText", "meta"] as const) {
			const scored = scoreWebsitePageChange("changelog", fieldDiff(field, "a", "b"));
			expect(scored.material).toBe(true);
			expect(scored.score).toBeGreaterThanOrEqual(WEBSITE_CHANGE_MATERIAL_THRESHOLD);
		}
	});

	it("blog/docs: headline change is material; body copy medium; typos suppressed; page events medium", () => {
		for (const kind of ["blog", "docs"] as const) {
			const headline = scoreWebsitePageChange(kind, fieldDiff("title", "Old title", "New title"));
			expect(headline.material).toBe(true);

			const body = scoreWebsitePageChange(
				kind,
				fieldDiff("visibleText", "A long body paragraph about the product roadmap.", "A long body paragraph about the product vision."),
			);
			expect(body.verdict).toBe("medium");

			const typo = scoreWebsitePageChange(kind, fieldDiff("visibleText", "grow revenue", "grows revenue"));
			expect(typo.score).toBeLessThan(WEBSITE_CHANGE_MEDIUM_THRESHOLD);
			expect(typo.verdict).toBe("immaterial");
			expect(typo.suppressionReason).toContain("minor_copy_edit");

			const pageAdded = scoreWebsitePageChange(kind, addedDiff("https://example.com/blog/post-1"));
			expect(pageAdded.verdict).toBe("medium");
		}
	});

	it("legal/other (about/contact/other): ANY content change is material; formatting-sized edits suppressed", () => {
		for (const kind of ["about", "contact", "other"] as const) {
			for (const field of ["title", "visibleText", "meta", "cta", "form"] as const) {
				const scored = scoreWebsitePageChange(
					kind,
					fieldDiff(
						field,
						"The company was founded to make compliance tracking simple.",
						"We updated the arbitration clause and the governing law provisions.",
					),
				);
				expect(scored.material).toBe(true);
			}
			const formatting = scoreWebsitePageChange(kind, fieldDiff("visibleText", "liability", "liablity"));
			expect(formatting.verdict).toBe("immaterial");
			expect(formatting.suppressionReason).toContain("minor_formatting_edit");
		}
	});

	it("product follows the marketing row (headline material, subcopy medium)", () => {
		expect(scoreWebsitePageChange("product", fieldDiff("title", "A", "B")).material).toBe(true);
		expect(
			scoreWebsitePageChange("product", fieldDiff("visibleText", "long before copy block", "long after copy block")).verdict,
		).toBe("medium");
	});

	it("page additions/removals inherit the kind's ceiling", () => {
		expect(scoreWebsitePageChange("pricing", addedDiff("https://example.com/pricing")).material).toBe(true);
		expect(scoreWebsitePageChange("other", removedDiff("https://example.com/terms")).material).toBe(true);
		expect(scoreWebsitePageChange("blog", addedDiff("https://example.com/blog/x")).verdict).toBe("medium");
	});
});

// ==== 2. Determinism ====

describe("determinism", () => {
	it("same diff always produces the same score object", () => {
		const diff = fieldDiff("offerPrice", "$19/mo", "$29/mo");
		const a = scoreWebsitePageChange("pricing", diff);
		const b = scoreWebsitePageChange("pricing", diff);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		expect(a).toEqual(b);
	});

	it("scoring a full fact set is deterministic, including churn suppression", () => {
		const diffs = [
			fieldDiff("offerPrice", "$19.99", "$9.99"),
			fieldDiff("visibleText", "Sponsored · Buy now · $19.99", "Advertisement · Claim deal · $9.99"),
		];
		const a = scoreWebsitePageChanges("home", diffs);
		const b = scoreWebsitePageChanges("home", diffs);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});
});

// ==== 3. Acceptance fixtures through the real pipeline ====

describe("acceptance fixtures (real diff pipeline)", () => {
	it("price change on /pricing scores >=85 and is material", async () => {
		const diffs = await diffsBetween("https://example.com/pricing", PRICING_BEFORE_HTML, PRICING_AFTER_HTML);
		const priceFact = diffs.find((diff) => diff.field === "offerPrice");
		expect(priceFact).toBeDefined();
		const scored = scoreWebsitePageChanges("pricing", diffs).find(
			(_, index) => diffs[index].field === "offerPrice",
		)!;
		expect(scored.score).toBeGreaterThanOrEqual(85);
		expect(scored.material).toBe(true);
		expect(scored.verdict).toBe("material");
	});

	it("typo on /blog scores <50 and is suppressed", async () => {
		const diffs = await diffsBetween("https://example.com/blog/growth", BLOG_BEFORE_HTML, BLOG_TYPO_HTML);
		const visibleIndex = diffs.findIndex((diff) => diff.field === "visibleText");
		expect(visibleIndex).toBeGreaterThanOrEqual(0);
		const scored = scoreWebsitePageChanges("blog", diffs)[visibleIndex]!;
		expect(scored.score).toBeLessThan(50);
		expect(scored.verdict).toBe("immaterial");
		expect(scored.material).toBe(false);
		expect(scored.suppressionReason).toBeTruthy();
	});

	it("changelog ANY change is material through the real pipeline", async () => {
		const before = `<html><head><title>Changelog</title></head><body><p>Released version 1.2 with export improvements.</p></body></html>`;
		const after = before.replace("export improvements", "import improvements");
		const diffs = await diffsBetween("https://example.com/changelog", before, after);
		expect(diffs.length).toBeGreaterThan(0);
		for (const scored of scoreWebsitePageChanges("changelog", diffs)) {
			expect(scored.material).toBe(true);
		}
	});

	it("legal (terms URL classifies other) ANY change is material through the real pipeline", async () => {
		const before = `<html><head><title>Terms of Service</title></head><body><p>Users must keep accounts secure and report misuse promptly.</p></body></html>`;
		const after = before.replace("report misuse promptly", "report misuse immediately");
		const diffs = await diffsBetween("https://example.com/terms", before, after);
		expect(diffs.length).toBeGreaterThan(0);
		for (const scored of scoreWebsitePageChanges("other", diffs)) {
			expect(scored.material).toBe(true);
		}
	});
});

// ==== 4. Noise: ad-slot/script churn ====

describe("noise suppression", () => {
	it("ad-slot creative churn is detected on the delta region", () => {
		expect(deltaLooksLikeChurn("Sponsored · Buy now · $19.99", "Advertisement · Claim deal · $9.99")).toBe(true);
	});

	it("rotating asset churn (hash/image tokens in the delta) is detected", () => {
		expect(deltaLooksLikeChurn("banner_a1b2c3d4e5f60718293a.png", "banner_99887766554433221100.png")).toBe(true);
	});

	it("a real copy edit near persistent ad text is NOT classified as churn", () => {
		const before = "Sponsored by Acme Cloud · Our teams ship faster with less effort every day.";
		const after = "Sponsored by Acme Cloud · Our teams deliver faster with less effort every day.";
		expect(deltaLooksLikeChurn(before, after)).toBe(false);
	});

	it("ad-slot churn fixture produces NO customer-visible event", async () => {
		const diffs = await diffsBetween("https://example.com/promo", AD_CHURN_BEFORE_HTML, AD_CHURN_AFTER_HTML);
		expect(diffs.length).toBeGreaterThan(0);
		const drafts = buildWebsiteChangeEventDrafts("landing", diffs);
		expect(drafts.length).toBe(diffs.length);
		for (const draft of drafts) {
			expect(draft.status).toBe("suppressed");
			expect(draft.customerVisible).toBe(false);
			expect(String(draft.metadata.suppressionReason)).toContain("churn");
			expect(draft.metadata.aiSummary).toBeUndefined();
		}
	});

	it("script-only churn never reaches the diff layer at all (no event)", async () => {
		const diffs = await diffsBetween("https://example.com/home", SCRIPT_CHURN_BEFORE_HTML, SCRIPT_CHURN_AFTER_HTML);
		expect(diffs).toEqual([]);
		const drafts = buildWebsiteChangeEventDrafts("home", diffs);
		expect(drafts).toEqual([]);
	});
});

// ==== 5. Idempotency ====

describe("idempotency", () => {
	it("identical refetch produces no facts, no drafts, no event", async () => {
		const prior = await normalizePage("https://example.com/pricing", PRICING_BEFORE_HTML);
		const current = await normalizePage("https://example.com/pricing", PRICING_BEFORE_HTML);
		expect(hasObservableContentChange(prior, current)).toBe(false);
		const diffs = evaluateWebsitePageChanges(
			inventory([["https://example.com/pricing", prior]]),
			inventory([["https://example.com/pricing", current]]),
			changeContext(),
		);
		expect(diffs).toEqual([]);
		expect(buildWebsiteChangeEventDrafts("pricing", diffs)).toEqual([]);
	});

	it("a normalizer-version-only change with identical fields is not a content change", () => {
		const base: NormalizedCompetitorPageContent = {
			normalizerVersion: "competitor-page-normalizer-v1",
			canonicalUrl: "https://example.com/a",
			title: "T",
			metaDescription: null,
			visibleTextExcerpt: "text",
			visibleTextHash: "h1",
			offerOrPriceText: null,
			ctaText: null,
			formPresent: false,
			contentHash: "hash-a",
		};
		const bumped = { ...base, normalizerVersion: "competitor-page-normalizer-v2", contentHash: "hash-b" };
		expect(hasObservableContentChange(base, bumped)).toBe(false);
	});

	it("appearing or disappearing pages count as changes", () => {
		expect(hasObservableContentChange(null, { contentHash: "x" } as NormalizedCompetitorPageContent)).toBe(true);
		expect(hasObservableContentChange({ contentHash: "x" } as NormalizedCompetitorPageContent, null)).toBe(true);
		expect(hasObservableContentChange(null, null)).toBe(false);
	});
});

// ==== 6. Guarded AI summary ====

describe("summarizeWebsiteChange guards", () => {
	const materialDiff = fieldDiff("offerPrice", "$19/mo", "$29/mo", "https://example.com/pricing");
	const materialScore: ScoredWebsitePageChange = {
		score: 95,
		verdict: "material",
		material: true,
		reason: "Price or offer changed",
		suppressionReason: null,
	};
	const immaterialScore: ScoredWebsitePageChange = {
		score: 20,
		verdict: "immaterial",
		material: false,
		reason: "Visible page copy changed",
		suppressionReason: "minor_copy_edit: the change is typo/formatting-sized",
	};

	it("no material changes → null and ZERO AI calls (no cost)", async () => {
		const run = vi.fn();
		const result = await summarizeWebsiteChange(mockEnv(run), {
			diff: fieldDiff("visibleText", "grow revenue", "grows revenue"),
			pageKind: "blog",
			score: immaterialScore,
		});
		expect(result).toBeNull();
		expect(run).not.toHaveBeenCalled();
	});

	it("material diff + no AI configured → deterministic fallback, never throws", async () => {
		const result = await summarizeWebsiteChange({} as never, {
			diff: materialDiff,
			pageKind: "pricing",
			score: materialScore,
		});
		expect(result).not.toBeNull();
		expect(result?.source).toBe("deterministic-fallback");
		expect(result?.summary).toContain("$19/mo");
		expect(result?.summary).toContain("$29/mo");
	});

	it("material diff + working AI → ai-sourced summary grounded in the diff", async () => {
		const run = vi.fn(async () => ({ response: "Acme raised its per-user price from $19/mo to $29/mo." }));
		const result = await summarizeWebsiteChange(mockEnv(run), {
			diff: materialDiff,
			pageKind: "pricing",
			score: materialScore,
		});
		expect(result?.source).toBe("ai");
		expect(result?.summary).toContain("$19/mo");
		expect(run).toHaveBeenCalledTimes(1);
		const [model, request] = run.mock.calls[0] as unknown as [string, { messages: Array<{ role: string; content: string }> }];
		expect(model).toBe("@cf/meta/llama-3.2-3b-instruct");
		const prompt = JSON.stringify(request.messages);
		expect(prompt).toContain("<<<DATA>>>");
		expect(prompt).toContain("$19/mo");
		expect(prompt.toLowerCase()).not.toContain("<html");
	});

	it("ungrounded AI digits (fabricated price) fall back to deterministic", async () => {
		const run = vi.fn(async () => ({ response: "Acme raised its price to $499/mo per seat." }));
		const result = await summarizeWebsiteChange(mockEnv(run), {
			diff: materialDiff,
			pageKind: "pricing",
			score: materialScore,
		});
		expect(result?.source).toBe("deterministic-fallback");
	});

	it("prompt-echo AI output falls back to deterministic", async () => {
		const run = vi.fn(async () => ({ response: "You summarize competitor website changes for a monitoring alert." }));
		const result = await summarizeWebsiteChange(mockEnv(run), {
			diff: materialDiff,
			pageKind: "pricing",
			score: materialScore,
		});
		expect(result?.source).toBe("deterministic-fallback");
	});

	it("throwing AI binding falls back to deterministic and never blocks the event", async () => {
		const run = vi.fn(async () => {
			throw new Error("ai down");
		});
		const result = await summarizeWebsiteChange(mockEnv(run), {
			diff: materialDiff,
			pageKind: "pricing",
			score: materialScore,
		});
		expect(result?.source).toBe("deterministic-fallback");
		expect(result?.summary.length).toBeGreaterThan(0);
	});
});

// ==== 7. Event drafts, receipts, metadata round-trip ====

describe("event drafts and receipts", () => {
	it("maps diff kinds to the website_page_* event vocabulary", () => {
		expect(buildWebsiteChangeEventDraft("pricing", addedDiff("https://example.com/pricing")).eventType).toBe("website_page_added");
		expect(buildWebsiteChangeEventDraft("pricing", removedDiff("https://example.com/pricing")).eventType).toBe("website_page_removed");
		expect(buildWebsiteChangeEventDraft("pricing", fieldDiff("offerPrice", "$19", "$29")).eventType).toBe("website_page_changed");
	});

	it("material event carries receipts: before/after hashes + capture timestamps", () => {
		const draft = buildWebsiteChangeEventDraft("pricing", fieldDiff("offerPrice", "$19/mo", "$29/mo"), {
			receipt: {
				beforeContentHash: "hash-before",
				afterContentHash: "hash-after",
				beforeCapturedAt: PRIOR_CAPTURE_AT,
				capturedAt: CAPTURE_AT,
			},
		});
		expect(draft.status).toBe("confirmed");
		expect(draft.customerVisible).toBe(true);
		expect(draft.metadata.beforeContentHash).toBe("hash-before");
		expect(draft.metadata.afterContentHash).toBe("hash-after");
		expect(draft.metadata.beforeCapturedAt).toBe(PRIOR_CAPTURE_AT);
		expect(draft.metadata.capturedAt).toBe(CAPTURE_AT);
		expect(draft.metadata.canonicalUrl).toBe("https://example.com/page");
		expect(draft.metadata.pageKind).toBe("pricing");
		expect(draft.metadata.score).toBe(95);
		expect(draft.metadata.verdict).toBe("material");
	});

	it("suppressed events keep their reason and never carry an AI summary", () => {
		const draft = buildWebsiteChangeEventDraft("blog", fieldDiff("visibleText", "grow revenue", "grows revenue"), {
			aiSummary: { summary: "should not attach", source: "ai" },
		});
		expect(draft.status).toBe("suppressed");
		expect(draft.customerVisible).toBe(false);
		expect(String(draft.metadata.suppressionReason)).toContain("minor_copy_edit");
		expect(draft.metadata.aiSummary).toBeUndefined();
		expect(draft.summary).toContain("suppressed");
	});

	it("metadata round-trips through readWebsiteChangeEventMetadata; garbage returns null", () => {
		const draft = buildWebsiteChangeEventDraft("pricing", fieldDiff("offerPrice", "$19/mo", "$29/mo"), {
			receipt: { beforeContentHash: "hb", afterContentHash: "ha", capturedAt: CAPTURE_AT },
			aiSummary: { summary: "Price went up.", source: "ai" },
		});
		const parsed = readWebsiteChangeEventMetadata(draft.metadata);
		expect(parsed).not.toBeNull();
		expect(parsed?.canonicalUrl).toBe("https://example.com/page");
		expect(parsed?.score).toBe(95);
		expect(parsed?.material).toBe(true);
		expect(parsed?.beforeContentHash).toBe("hb");
		expect(parsed?.aiSummary).toBe("Price went up.");
		expect(readWebsiteChangeEventMetadata({ foo: "bar" })).toBeNull();
		expect(readWebsiteChangeEventMetadata("nope")).toBeNull();
		expect(readWebsiteChangeEventMetadata(null)).toBeNull();
	});

	it("buildDeterministicChangeSummary stays bounded and factual", () => {
		const summary = buildDeterministicChangeSummary("pricing", [fieldDiff("offerPrice", "$19/mo", "$29/mo")], {
			score: 95,
			verdict: "material",
			material: true,
			reason: "Price or offer changed",
			suppressionReason: null,
		} satisfies ScoredWebsitePageChange);
		expect(summary).toContain("Pricing page changed");
		expect(summary).toContain("$19/mo");
		expect(summary.length).toBeLessThanOrEqual(400);
	});
});
