import { describe, expect, it } from "vitest";

import {
	AGGRESSION_FORMULA_VERSION,
	aggressionBandForScore,
	computeAggressionScore,
	linearShareCurvePoints,
	MIN_AGGRESSION_WINDOW_DAYS,
	testingCurvePoints,
	velocityCurvePoints,
} from "~/lib/aggression-score";
import type {
	CompetitorDossierReady,
	DossierAdHistoryEntry,
} from "~/lib/competitor-dossier.server";

const NOW = new Date("2026-07-19T12:00:00.000Z");

function buildEntry(
	metaAdId: string,
	overrides: Partial<DossierAdHistoryEntry> = {},
): DossierAdHistoryEntry {
	return {
		metaAdId,
		hook: `Hook for ${metaAdId}`,
		metaFirstSeenAt: null,
		firstObservedAt: "2026-07-01T00:00:00.000Z",
		lastObservedAt: "2026-07-18T00:00:00.000Z",
		observedRunCount: 2,
		active: true,
		format: "image",
		variantCount: null,
		longevityDays: 5,
		longevityBasis: "tracked",
		longevityLabel: "Tracked 5 days",
		...overrides,
	};
}

function buildReadyDossier(
	overrides: Partial<CompetitorDossierReady> = {},
): CompetitorDossierReady {
	const adHistory = overrides.adHistory ?? [buildEntry("ad-a")];
	return {
		status: "ready",
		// 28 full days before NOW.
		observedSince: "2026-06-21T12:00:00.000Z",
		scanCount: 6,
		adHistory,
		longevityLeaders: [],
		activeCount: adHistory.filter((entry) => entry.active).length,
		inactiveCount: adHistory.filter((entry) => !entry.active).length,
		formatMix: [],
		hookPatterns: [],
		adVelocity: { buckets: [], maxCount: 0, earlierCount: 0 },
		landingPageChanges: { count: 0, latest: null },
		angleMix: { shares: [], tentativeCount: 0, unclassifiedCount: 0 },
		offerCount: 0,
		...overrides,
	};
}

describe("computeAggressionScore evidence floor", () => {
	it("returns null for a not_enough_history dossier", () => {
		expect(
			computeAggressionScore(
				{ status: "not_enough_history", scanCount: 1, adCount: 3 },
				NOW,
			),
		).toBeNull();
	});

	it("returns null when the observed window is shorter than 14 days", () => {
		const dossier = buildReadyDossier({
			observedSince: "2026-07-09T12:00:00.000Z", // 10 days before NOW
		});

		expect(computeAggressionScore(dossier, NOW)).toBeNull();
	});

	it("scores exactly at the 14-day window boundary", () => {
		const dossier = buildReadyDossier({
			observedSince: "2026-07-05T12:00:00.000Z", // exactly 14 days
		});

		expect(computeAggressionScore(dossier, NOW)).not.toBeNull();
		expect(MIN_AGGRESSION_WINDOW_DAYS).toBe(14);
	});

	it("returns null on an unparseable observedSince instead of guessing", () => {
		const dossier = buildReadyDossier({ observedSince: "not-a-date" });

		expect(computeAggressionScore(dossier, NOW)).toBeNull();
	});
});

describe("velocity curve (documented anchors)", () => {
	it("maps the documented anchor points: 0->0, 1->10, 3->18, 5+->25", () => {
		expect(velocityCurvePoints(0)).toBe(0);
		expect(velocityCurvePoints(1)).toBe(10);
		expect(velocityCurvePoints(3)).toBe(18);
		expect(velocityCurvePoints(5)).toBe(25);
		expect(velocityCurvePoints(9)).toBe(25);
	});

	it("interpolates linearly between anchors", () => {
		expect(velocityCurvePoints(0.5)).toBe(5);
		expect(velocityCurvePoints(2)).toBe(14);
		expect(velocityCurvePoints(4)).toBe(21.5);
	});
});

describe("testing curve", () => {
	it("is linear to the 50% saturation point and capped at 25", () => {
		expect(testingCurvePoints(0)).toBe(0);
		expect(testingCurvePoints(0.25)).toBe(12.5);
		expect(testingCurvePoints(0.5)).toBe(25);
		expect(testingCurvePoints(0.9)).toBe(25);
	});
});

describe("linear share curve (freshness and persistence)", () => {
	it("maps share 0..1 linearly onto 0..25 points, clamped", () => {
		expect(linearShareCurvePoints(0)).toBe(0);
		expect(linearShareCurvePoints(0.5)).toBe(12.5);
		expect(linearShareCurvePoints(1)).toBe(25);
		expect(linearShareCurvePoints(1.2)).toBe(25);
	});
});

describe("computeAggressionScore components", () => {
	it("computes all four components from dossier facts and sums them exactly", () => {
		// 28-day window, 4 ads -> 1 new ad/week -> velocity 10.
		// 2 of 4 ads multi-variant -> 50% -> testing 25.
		// All 4 active and first observed within 30 days -> freshness 25.
		// No ad at 30+ days longevity -> persistence 0.
		const dossier = buildReadyDossier({
			adHistory: [
				buildEntry("ad-a", { variantCount: 3 }),
				buildEntry("ad-b", { variantCount: 2 }),
				buildEntry("ad-c", { variantCount: 1 }),
				buildEntry("ad-d"),
			],
		});

		const score = computeAggressionScore(dossier, NOW);

		expect(score).not.toBeNull();
		if (!score) return;
		expect(score.components).toEqual({
			velocity: 10,
			testing: 25,
			freshness: 25,
			persistence: 0,
		});
		expect(score.score).toBe(60);
		expect(score.band.id).toBe("aggressive");
		expect(score.formulaVersion).toBe(AGGRESSION_FORMULA_VERSION);
		expect(score.facts).toMatchObject({
			windowDays: 28,
			adCount: 4,
			activeCount: 4,
			adsPerWeek: 1,
			testedShare: 0.5,
			persistentShare: 0,
		});
	});

	it("keeps the displayed identity: components always sum to the score", () => {
		// Shares chosen so raw component values are fractional before rounding.
		const dossier = buildReadyDossier({
			adHistory: [
				buildEntry("ad-a", { variantCount: 2, longevityDays: 45 }),
				buildEntry("ad-b"),
				buildEntry("ad-c"),
			],
		});

		const score = computeAggressionScore(dossier, NOW);

		expect(score).not.toBeNull();
		if (!score) return;
		const { velocity, testing, freshness, persistence } = score.components;
		expect(velocity + testing + freshness + persistence).toBe(score.score);
		expect(Number.isInteger(score.score)).toBe(true);
	});

	it("treats a null variantCount as not tested", () => {
		const dossier = buildReadyDossier({
			adHistory: [buildEntry("ad-a", { variantCount: null }), buildEntry("ad-b")],
		});

		const score = computeAggressionScore(dossier, NOW);

		expect(score?.components.testing).toBe(0);
		expect(score?.facts.testedShare).toBe(0);
	});

	it("computes freshness over active ads only, and zero when none are active", () => {
		const allInactive = buildReadyDossier({
			adHistory: [
				buildEntry("ad-a", { active: false }),
				buildEntry("ad-b", { active: false }),
			],
		});
		expect(computeAggressionScore(allInactive, NOW)?.components.freshness).toBe(0);

		// One active stale ad + one active fresh ad -> 50% fresh -> 13 points
		// (12.5 rounded); the inactive fresh ad must not inflate the share.
		const mixed = buildReadyDossier({
			observedSince: "2026-04-01T00:00:00.000Z",
			adHistory: [
				buildEntry("ad-a", { firstObservedAt: "2026-04-02T00:00:00.000Z" }),
				buildEntry("ad-b", { firstObservedAt: "2026-07-10T00:00:00.000Z" }),
				buildEntry("ad-c", { active: false, firstObservedAt: "2026-07-10T00:00:00.000Z" }),
			],
		});
		const score = computeAggressionScore(mixed, NOW);
		expect(score?.components.freshness).toBe(13);
		expect(score?.facts.freshShare).toBe(0.5);
	});

	it("counts persistence from longevityDays regardless of basis", () => {
		const dossier = buildReadyDossier({
			adHistory: [
				buildEntry("ad-a", { longevityDays: 30, longevityBasis: "running" }),
				buildEntry("ad-b", { longevityDays: 41, longevityBasis: "tracked" }),
				buildEntry("ad-c", { longevityDays: 29 }),
				buildEntry("ad-d", { longevityDays: 2 }),
			],
		});

		const score = computeAggressionScore(dossier, NOW);

		expect(score?.facts.persistentShare).toBe(0.5);
		expect(score?.components.persistence).toBe(13); // 12.5 rounded
	});
});

describe("aggression bands", () => {
	it("maps the documented inclusive boundaries", () => {
		expect(aggressionBandForScore(0).id).toBe("quiet");
		expect(aggressionBandForScore(25).id).toBe("quiet");
		expect(aggressionBandForScore(26).id).toBe("steady");
		expect(aggressionBandForScore(50).id).toBe("steady");
		expect(aggressionBandForScore(51).id).toBe("aggressive");
		expect(aggressionBandForScore(75).id).toBe("aggressive");
		expect(aggressionBandForScore(76).id).toBe("all_out");
		expect(aggressionBandForScore(100).id).toBe("all_out");
	});

	it("phrases every interpretation neutrally, describing behavior not judgment", () => {
		for (const score of [10, 40, 60, 90]) {
			const band = aggressionBandForScore(score);
			expect(band.interpretation.length).toBeGreaterThan(10);
			expect(band.interpretation.endsWith(".")).toBe(true);
		}
	});
});
