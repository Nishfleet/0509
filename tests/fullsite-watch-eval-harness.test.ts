import { describe, expect, it } from "vitest";

import { readChangeMark } from "~/lib/change-mark";
import {
	COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT,
	evaluateWebsitePageChanges,
	normalizeCompetitorPageContent,
} from "~/lib/competitor-site-content";
import type {
	CompetitorPageInventory,
	NormalizedCompetitorPageContent,
	WebsiteChangeContext,
	WebsitePageChange,
} from "~/lib/competitor-site-content";
import type { WatchEventRecord } from "~/lib/types";
import {
	basePages,
	cosmeticPairs,
	materialScenarios,
} from "./fullsite-watch-eval-corpus";

/**
 * EPIC #1367 Q1 — full-site watch eval harness (evals before specs).
 *
 * Measures the DETERMINISTIC change core (`evaluateWebsitePageChanges` +
 * `normalizeCompetitorPageContent`) over realistic captured competitor-page
 * HTML pairs — one canonical URL, a prior-run and a current-run capture, fed
 * through the REAL normalizer exactly as the site-scan would hand them to the
 * (future) change wiring. No new diff logic: both functions are reused as-is.
 *
 * This is the spec-gate for Q2 (#1383): the change-detection spec must not be
 * locked until EVAL-1..4 pass the bars below.
 *
 *   EVAL-1 cosmetic-suppression precision  zero field-changed on >=95% of
 *                                          cosmetic-only pairs
 *   EVAL-2 materiality precision            >=90% material changes -> correct
 *                                          alertable fact; <=5% false-positive
 *                                          alertable facts
 *   EVAL-3 removal honesty                  zero page-removed on incomplete
 *                                          current inventory
 *   EVAL-4 before/after readability         every alertable fact <=500 chars +
 *                                          human-readable; ChangeMark 48-char
 *                                          token on >=80% of alertable facts
 */

const ALERTABLE_FIELDS = new Set<string>([
	"visibleText",
	"offerPrice",
	"cta",
	"page",
]);

function isAlertable(fact: WebsitePageChange): boolean {
	return fact.material && ALERTABLE_FIELDS.has(fact.field);
}

function completeContext(): WebsiteChangeContext {
	return {
		priorInventoryComplete: true,
		currentInventoryComplete: true,
		priorCaptureAt: "2026-08-24T00:00:00.000Z",
		currentCaptureAt: "2026-08-25T00:00:00.000Z",
	};
}

async function normalizeInventory(
	pages: Record<string, string>,
): Promise<CompetitorPageInventory> {
	const entries = await Promise.all(
		Object.entries(pages).map(async ([canonicalUrl, rawHtml]) => {
			const content: NormalizedCompetitorPageContent =
				await normalizeCompetitorPageContent({ canonicalUrl, rawHtml });
			return [canonicalUrl, content] as const;
		}),
	);
	return new Map(entries);
}

async function evaluateScenario(
	scenario: { prior: Record<string, string>; current: Record<string, string> },
	context: WebsiteChangeContext,
): Promise<WebsitePageChange[]> {
	const [prior, current] = await Promise.all([
		normalizeInventory(scenario.prior),
		normalizeInventory(scenario.current),
	]);
	return evaluateWebsitePageChanges(prior, current, context);
}

/** Render a change fact's before/after as a WatchEventRecord for readChangeMark. */
function factAsWatchEvent(fact: WebsitePageChange): WatchEventRecord {
	return {
		id: "eval",
		watchlistId: "eval",
		runId: "eval",
		eventType: "website_page_changed",
		status: "confirmed",
		importanceScore: 0,
		adId: null,
		baselineFromRunId: null,
		candidateId: null,
		proofCaptureId: null,
		title: "changed",
		summary: "changed",
		metadata: { from: fact.before ?? "", to: fact.after ?? "" },
		confirmedAt: null,
		suppressedAt: null,
		invalidatedAt: null,
		lastEvaluatedAt: null,
		createdAt: "2026-08-25T00:00:00.000Z",
	};
}

// ---------------------------------------------------------------------------
// EVAL-1 — cosmetic-suppression precision
// ---------------------------------------------------------------------------

describe("EVAL-1 cosmetic-suppression precision", () => {
	it("zeroes out every inert perturbation class (whitespace, attribute, analytics, timestamp, combos)", async () => {
		const pairs = cosmeticPairs();
		const inert = pairs.filter((p) => !p.name.includes("nav link reorder"));
		for (const pair of inert) {
			const facts = await evaluatePair(pair);
			expect(
				facts.filter((f) => f.kind === "field-changed"),
				`${pair.name} leaked`,
			).toHaveLength(0);
		}
	});

	it("meets the >=95% overall bar across all cosmetic-only pairs (nav reorder measured, not hidden)", async () => {
		const { cleanCount, total, rate } = await evaluateCosmeticAll();
		expect(cleanCount).toBeGreaterThan(0);
		expect(total).toBeGreaterThan(0);
		expect(rate).toBeGreaterThanOrEqual(0.95);
	});
});

async function evaluatePair(pair: {
	canonicalUrl: string;
	priorHtml: string;
	currentHtml: string;
}): Promise<WebsitePageChange[]> {
	const prior = await normalizeCompetitorPageContent({
		canonicalUrl: pair.canonicalUrl,
		rawHtml: pair.priorHtml,
	});
	const current = await normalizeCompetitorPageContent({
		canonicalUrl: pair.canonicalUrl,
		rawHtml: pair.currentHtml,
	});
	return evaluateWebsitePageChanges(
		new Map([[pair.canonicalUrl, prior]]),
		new Map([[pair.canonicalUrl, current]]),
		completeContext(),
	);
}

async function evaluateCosmeticAll(): Promise<{
	cleanCount: number;
	total: number;
	rate: number;
}> {
	const pairs = cosmeticPairs();
	let cleanCount = 0;
	for (const pair of pairs) {
		const facts = await evaluatePair(pair);
		if (facts.filter((f) => f.kind === "field-changed").length === 0) cleanCount += 1;
	}
	return { cleanCount, total: pairs.length, rate: cleanCount / pairs.length };
}

// ---------------------------------------------------------------------------
// EVAL-2 — materiality precision
// ---------------------------------------------------------------------------

describe("EVAL-2 materiality precision", () => {
	it("emits an alertable fact with EVERY correct field on >=90% of material changes", async () => {
		const scenarios = materialScenarios();
		let correct = 0;
		for (const scenario of scenarios) {
			const facts = await evaluateScenario(scenario, completeContext());
			const fields = new Set(facts.filter(isAlertable).map((f) => f.field));
			if (scenario.expectedFields.every((f) => fields.has(f))) correct += 1;
		}
		const rate = correct / scenarios.length;
		expect(rate).toBeGreaterThanOrEqual(0.9);
	});

	it("keeps false-positive alertable facts <=5%", async () => {
		const scenarios = materialScenarios();
		let truePositives = 0;
		let falsePositives = 0;
		for (const scenario of scenarios) {
			const facts = await evaluateScenario(scenario, completeContext());
			for (const fact of facts) {
				if (!isAlertable(fact)) continue;
				if (scenario.expectedFields.includes(fact.field)) truePositives += 1;
				else falsePositives += 1;
			}
		}
		const fpRate = falsePositives / (truePositives + falsePositives);
		expect(fpRate).toBeLessThanOrEqual(0.05);
	});
});

// ---------------------------------------------------------------------------
// EVAL-3 — removal honesty
// ---------------------------------------------------------------------------

describe("EVAL-3 removal honesty", () => {
	it("emits zero page-removed facts when the current inventory is incomplete", async () => {
		// Simulates a sitemap-unreachable run: the current capture reaches only a
		// partial inventory. The two prior pages missing from it are NOT removed —
		// the crawl simply could not reach them, so a removal claim would be a
		// lie. A brand-new page that the crawl DID reach is still an honest
		// addition.
		const prior = {
			[basePages.acmePricing.canonicalUrl]: basePages.acmePricing.html,
			[basePages.acmeProduct.canonicalUrl]: basePages.acmeProduct.html,
			[basePages.acmePolicy.canonicalUrl]: basePages.acmePolicy.html,
		};
		const current = {
			[basePages.acmePricing.canonicalUrl]: basePages.acmePricing.html,
			[basePages.acmeVault.canonicalUrl]: basePages.acmeVault.html,
		};

		const facts = await evaluateScenario(
			{ prior, current },
			{ ...completeContext(), currentInventoryComplete: false },
		);

		expect(facts.filter((f) => f.kind === "page-removed")).toEqual([]);
		// A page genuinely fetched for the first time is still an honest
		// addition even on an incomplete run (additions never lie about a URL
		// that was actually reached).
		expect(facts.filter((f) => f.kind === "page-added")).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// EVAL-4 — before/after readability + ChangeMark token
// ---------------------------------------------------------------------------

describe("EVAL-4 before/after readability", () => {
	it("keeps every alertable before/after <=500 chars and human-readable", async () => {
		const facts = await collectAlertableFacts();
		expect(facts.length).toBeGreaterThan(0);
		for (const fact of facts) {
			for (const side of [fact.before, fact.after]) {
				if (side === null) continue;
				expect(
					side.length,
					`${fact.dedupeKey} side exceeds ${COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT} chars`,
				).toBeLessThanOrEqual(COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT);
				expect(side, `${fact.dedupeKey} leaks raw HTML`).not.toMatch(/<[a-zA-Z\/][^>]*>/);
				expect(side, `${fact.dedupeKey} leaks base64`).not.toMatch(/[A-Za-z0-9+\/]{40,}={0,2}/);
				expect(side.toLowerCase(), `${fact.dedupeKey} leaks a data: URI`).not.toMatch(/^data:/);
			}
		}
	});

	it("renders the ChangeMark 48-char token on >=80% of alertable facts", async () => {
		const facts = await collectAlertableFacts();
		expect(facts.length).toBeGreaterThan(0);
		const markable = facts.filter((fact) => readChangeMark(factAsWatchEvent(fact)) !== null).length;
		expect(markable / facts.length).toBeGreaterThanOrEqual(0.8);
	});
});

async function collectAlertableFacts(): Promise<WebsitePageChange[]> {
	const facts: WebsitePageChange[] = [];
	for (const scenario of materialScenarios()) {
		facts.push(...(await evaluateScenario(scenario, completeContext())).filter(isAlertable));
	}
	return facts;
}
