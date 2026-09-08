import { describe, expect, it, vi } from "vitest";

import {
	buildCounterBrief,
	buildCounterBriefFacts,
	COUNTER_BRIEF_MODEL,
	validateCounterBrief,
} from "~/lib/counter-brief.server";
import type {
	CompetitorDossierReady,
	DossierAdHistoryEntry,
} from "~/lib/competitor-dossier.server";

function buildEntry(
	metaAdId: string,
	overrides: Partial<DossierAdHistoryEntry> = {},
): DossierAdHistoryEntry {
	return {
		metaAdId,
		hook: `Hook for ${metaAdId}`,
		metaFirstSeenAt: null,
		firstObservedAt: "2026-06-01T00:00:00.000Z",
		lastObservedAt: "2026-07-18T00:00:00.000Z",
		observedRunCount: 4,
		active: true,
		format: "image",
		variantCount: null,
		longevityDays: 12,
		longevityBasis: "tracked",
		longevityLabel: "Tracked 12 days",
		...overrides,
	};
}

function buildReadyDossier(
	overrides: Partial<CompetitorDossierReady> = {},
): CompetitorDossierReady {
	const adHistory =
		overrides.adHistory ??
		Array.from({ length: 8 }, (_, index) => buildEntry(`ad-${index}`));
	return {
		status: "ready",
		observedSince: "2026-05-01T00:00:00.000Z",
		scanCount: 12,
		adHistory,
		longevityLeaders: [
			buildEntry("ad-leader", {
				hook: "Flash sale ends today on every serum",
				longevityDays: 41,
				longevityBasis: "running",
			}),
		],
		activeCount: adHistory.length,
		inactiveCount: 0,
		formatMix: [
			{ format: "image", count: 6 },
			{ format: "video", count: 2 },
		],
		hookPatterns: [
			{
				pattern: "get glowing skin in 7 days",
				sample: "Get glowing skin in 7 days",
				count: 3,
			},
		],
		adVelocity: { buckets: [], maxCount: 0, earlierCount: 0 },
		landingPageChanges: { count: 0, latest: null },
		angleMix: {
			shares: [
				{ angle: "discount_urgency", count: 5 },
				{ angle: "social_proof", count: 3 },
			],
			tentativeCount: 0,
			unclassifiedCount: 0,
		},
		offerCount: 6,
		...overrides,
	};
}

const GOOD_BRIEF = {
	gap: "They saturate Discount & urgency and Social proof; nobody is running Problem → solution.",
	hooksToTest: [
		{
			direction: "Lead with the skin problem their discount ads never name",
			rationale: "Their glowing skin opener repeats across 3 ads without naming a pain.",
		},
		{
			direction: "Counter the flash sale with an evergreen value promise",
			rationale: "Flash sale copy has run 41 days, so price pressure is their default.",
		},
		{
			direction: "Try a first-person story against their polished image ads",
			rationale: "6 of 8 ads are image format with an explicit offer attached.",
		},
	],
	watchNote: "Watch whether the glowing skin opener spreads beyond 3 ads next scan.",
};

function fakeAiEnv(responseText: string) {
	const run = vi.fn().mockResolvedValue({ response: responseText });
	return { env: { AI: { run } } as never, run };
}

describe("buildCounterBrief guards", () => {
	it("returns null when no AI binding is configured", async () => {
		const brief = await buildCounterBrief({} as never, buildReadyDossier());

		expect(brief).toBeNull();
	});

	it("returns null for a not_enough_history dossier without calling the model", async () => {
		const { env, run } = fakeAiEnv(JSON.stringify(GOOD_BRIEF));

		const brief = await buildCounterBrief(env, {
			status: "not_enough_history",
			scanCount: 1,
			adCount: 0,
		});

		expect(brief).toBeNull();
		expect(run).not.toHaveBeenCalled();
	});

	it("returns null when the model call rejects", async () => {
		const run = vi.fn().mockRejectedValue(new Error("AI down"));

		const brief = await buildCounterBrief({ AI: { run } } as never, buildReadyDossier());

		expect(brief).toBeNull();
	});

	it("honors a caller-supplied timeout and returns null when the model hangs", async () => {
		const run = vi.fn().mockImplementation(() => new Promise(() => {}));

		const brief = await buildCounterBrief({ AI: { run } } as never, buildReadyDossier(), {
			timeoutMs: 10,
		});

		expect(brief).toBeNull();
	});

	it("returns null on a non-JSON model response", async () => {
		const { env } = fakeAiEnv("I cannot produce a brief right now, sorry!");

		expect(await buildCounterBrief(env, buildReadyDossier())).toBeNull();
	});
});

describe("buildCounterBrief prompt allowlist", () => {
	it("sends only dossier-derived facts inside the untrusted-data envelope", async () => {
		const { env, run } = fakeAiEnv(JSON.stringify(GOOD_BRIEF));

		await buildCounterBrief(env, buildReadyDossier());

		expect(run).toHaveBeenCalledWith(COUNTER_BRIEF_MODEL, expect.anything());
		const options = run.mock.calls[0][1] as {
			messages: Array<{ role: string; content: string }>;
		};
		const system = options.messages[0];
		const user = options.messages[1];

		// The taxonomy is named in the instructions, all six angles.
		expect(system.content).toContain("Discount & urgency");
		expect(system.content).toContain("Problem → solution");
		expect(system.content).toContain("Brand & lifestyle");
		expect(system.content).toContain("<<<DATA>>>");

		// Facts ride inside the untrusted-data envelope.
		expect(user.content.startsWith("<<<DATA>>>\n")).toBe(true);
		expect(user.content.endsWith("<<<END DATA>>>")).toBe(true);
		expect(user.content).toContain("Observed angle mix: Discount & urgency 5 ads, Social proof 3 ads.");
		expect(user.content).toContain('"Get glowing skin in 7 days" used by 3 ads');
		expect(user.content).toContain('"Flash sale ends today on every serum" — 41 days (running)');
		expect(user.content).toContain("Offer presence: 6 of 8 ads carry an explicit offer.");
		expect(user.content).toContain("Format mix: 6 image, 2 video.");
		expect(user.content).toContain("Evidence window: 12 scans since 2026-05-01.");

		// Nothing beyond hooks: no URLs, no ad ids, no body text.
		expect(user.content).not.toContain("http");
		expect(user.content).not.toContain("ad-0");
		expect(user.content).not.toContain("ad-leader");
	});

	it("accepts a valid grounded brief end to end", async () => {
		const { env } = fakeAiEnv(JSON.stringify(GOOD_BRIEF));

		const brief = await buildCounterBrief(env, buildReadyDossier());

		expect(brief).toEqual(GOOD_BRIEF);
	});
});

describe("validateCounterBrief", () => {
	const facts = () => {
		const built = buildCounterBriefFacts(buildReadyDossier());
		if (!built) throw new Error("expected facts");
		return built;
	};

	it("rejects a gap that names no taxonomy angle", () => {
		const brief = {
			...GOOD_BRIEF,
			gap: "They saturate FOMO ads; nobody is running scarcity marketing.",
		};

		expect(validateCounterBrief(JSON.stringify(brief), facts())).toBeNull();
	});

	it("rejects a gap that names only saturated angles when a real gap exists", () => {
		const brief = {
			...GOOD_BRIEF,
			gap: "They saturate Discount & urgency across the account.",
		};

		expect(validateCounterBrief(JSON.stringify(brief), facts())).toBeNull();
	});

	it("accepts punctuation-variant taxonomy names without becoming fuzzy", () => {
		const brief = {
			...GOOD_BRIEF,
			gap: "They saturate discount-urgency and social proof; nobody runs problem-solution ads.",
		};

		expect(validateCounterBrief(JSON.stringify(brief), facts())).not.toBeNull();
	});

	it("rejects fabricated digits anywhere in the brief", () => {
		const brief = {
			...GOOD_BRIEF,
			hooksToTest: [
				{
					...GOOD_BRIEF.hooksToTest[0],
					rationale: "Their 97 discount ads prove the glowing skin angle dominates.",
				},
				GOOD_BRIEF.hooksToTest[1],
				GOOD_BRIEF.hooksToTest[2],
			],
		};

		expect(validateCounterBrief(JSON.stringify(brief), facts())).toBeNull();
	});

	it("rejects a rationale with no token overlap with the input corpus", () => {
		const brief = {
			...GOOD_BRIEF,
			hooksToTest: [
				{
					direction: GOOD_BRIEF.hooksToTest[0].direction,
					rationale: "Zebras adore juicy watermelon picnics beside quiet meadows.",
				},
				GOOD_BRIEF.hooksToTest[1],
				GOOD_BRIEF.hooksToTest[2],
			],
		};

		expect(validateCounterBrief(JSON.stringify(brief), facts())).toBeNull();
	});

	it("rejects an ungrounded watch note", () => {
		const brief = {
			...GOOD_BRIEF,
			watchNote: "Keep an ambient sonar pinging quietly beneath everything.",
		};

		expect(validateCounterBrief(JSON.stringify(brief), facts())).toBeNull();
	});

	it("rejects anything but exactly three hook directions", () => {
		const two = { ...GOOD_BRIEF, hooksToTest: GOOD_BRIEF.hooksToTest.slice(0, 2) };
		const four = {
			...GOOD_BRIEF,
			hooksToTest: [...GOOD_BRIEF.hooksToTest, GOOD_BRIEF.hooksToTest[0]],
		};

		expect(validateCounterBrief(JSON.stringify(two), facts())).toBeNull();
		expect(validateCounterBrief(JSON.stringify(four), facts())).toBeNull();
	});

	it("rejects over-length directions and rationales", () => {
		const longDirection = {
			...GOOD_BRIEF,
			hooksToTest: [
				{
					direction: `Lead with the skin problem ${"x".repeat(120)}`,
					rationale: GOOD_BRIEF.hooksToTest[0].rationale,
				},
				GOOD_BRIEF.hooksToTest[1],
				GOOD_BRIEF.hooksToTest[2],
			],
		};
		const longRationale = {
			...GOOD_BRIEF,
			hooksToTest: [
				{
					direction: GOOD_BRIEF.hooksToTest[0].direction,
					rationale: `Their glowing skin opener ${"x".repeat(140)}`,
				},
				GOOD_BRIEF.hooksToTest[1],
				GOOD_BRIEF.hooksToTest[2],
			],
		};

		expect(validateCounterBrief(JSON.stringify(longDirection), facts())).toBeNull();
		expect(validateCounterBrief(JSON.stringify(longRationale), facts())).toBeNull();
	});

	it("rejects prompt echoes instead of shipping them to customers", () => {
		const brief = {
			...GOOD_BRIEF,
			watchNote: "As an AI I generated this from the glowing skin data provided.",
		};

		expect(validateCounterBrief(JSON.stringify(brief), facts())).toBeNull();
	});

	it("tolerates prose wrapping around the JSON object", () => {
		const wrapped = `Here is the brief you asked for:\n${JSON.stringify(GOOD_BRIEF)}\nHope that helps!`;

		expect(validateCounterBrief(wrapped, facts())).toEqual(GOOD_BRIEF);
	});
});

describe("buildCounterBriefFacts", () => {
	it("names every zero-count taxonomy angle as a gap candidate", () => {
		const facts = buildCounterBriefFacts(buildReadyDossier());

		expect(facts).not.toBeNull();
		if (!facts) return;
		expect(facts.gapAngleLabels).toEqual([
			"problem → solution",
			"new launch",
			"ugc style",
			"brand & lifestyle",
		]);
		expect(facts.taxonomyLabels).toHaveLength(6);
	});

	it("reports an honest no-gap state when every angle is observed", () => {
		const dossier = buildReadyDossier({
			angleMix: {
				shares: [
					{ angle: "discount_urgency", count: 2 },
					{ angle: "social_proof", count: 2 },
					{ angle: "problem_solution", count: 1 },
					{ angle: "new_launch", count: 1 },
					{ angle: "ugc_style", count: 1 },
					{ angle: "brand_lifestyle", count: 1 },
				],
				tentativeCount: 0,
				unclassifiedCount: 0,
			},
		});

		const facts = buildCounterBriefFacts(dossier);

		expect(facts).not.toBeNull();
		if (!facts) return;
		expect(facts.gapAngleLabels).toEqual([]);
		expect(facts.lines).toContain(
			"Taxonomy angles with zero observed ads: none — every angle is in play.",
		);
	});

	it("returns null for a not_enough_history dossier", () => {
		expect(
			buildCounterBriefFacts({ status: "not_enough_history", scanCount: 0, adCount: 0 }),
		).toBeNull();
	});
});
