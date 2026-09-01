import type { CompetitorDossier } from "~/lib/competitor-dossier.server";

/**
 * Ad Aggression Score — a deterministic, fully documented 0-100 read of how
 * hard a competitor is pushing their ad program in the observed window.
 *
 * The formula is PUBLIC by design (honesty as differentiation): every curve
 * is written out below, the four components each contribute 0-25 points, and
 * the displayed components always sum exactly to the displayed score — no
 * hidden weighting, no model, no magic.
 *
 * Evidence floor: a fair score needs at least MIN_AGGRESSION_WINDOW_DAYS of
 * observed history. Below that (or on a not_enough_history dossier) the
 * function returns null and the UI says why — never a score on thin evidence.
 */

const MS_PER_DAY = 86_400_000;

/** Minimum observed-history window (days) before a score is fair to state. */
export const MIN_AGGRESSION_WINDOW_DAYS = 14;

/** Ads first observed within this many days count as "fresh". */
export const AGGRESSION_FRESHNESS_DAYS = 30;

/** Ads running/tracked at least this many days count as proven runners. */
export const AGGRESSION_PERSISTENCE_DAYS = 30;

/** Testing component saturates when half the ads are multi-variant. */
export const AGGRESSION_TESTING_SATURATION_SHARE = 0.5;

export const AGGRESSION_FORMULA_VERSION = 1;

/**
 * Public methodology page for the formula documented in this module.
 *
 * Path history: previously `/methodology/ad-aggression-score` (issue #960).
 * Renamed to `/ad-aggression` for issue #1263 — short, quotable, link-magnet.
 * The old path 301-redirects to this one in `app/routes.ts` so any external
 * link or sitemap entry pointing at the old URL keeps its equity.
 */
export const AD_AGGRESSION_METHODOLOGY_PATH = "/ad-aggression" as const;

/** Old canonical path; kept here so the redirect stays the only redirect source. */
export const AD_AGGRESSION_METHODOLOGY_PATH_LEGACY =
	"/methodology/ad-aggression-score" as const;

export interface AggressionScoreComponents {
	/** 0-25: launch rate — new ads per week over the observed window. */
	velocity: number;
	/** 0-25: variant testing — share of ads with more than one creative variant. */
	testing: number;
	/** 0-25: freshness — share of active ads first observed in the last 30 days. */
	freshness: number;
	/** 0-25: persistence — share of ads running/tracked for 30+ days. */
	persistence: number;
}

export type AggressionBandId = "quiet" | "steady" | "aggressive" | "all_out";

export interface AggressionBand {
	id: AggressionBandId;
	label: string;
	/** Neutral one-line interpretation — describes behavior, never judges it. */
	interpretation: string;
}

/** Raw inputs behind each component, surfaced for the public formula display. */
export interface AggressionScoreFacts {
	windowDays: number;
	adCount: number;
	activeCount: number;
	/** New ads per week over the window, rounded to one decimal for display. */
	adsPerWeek: number;
	/** Share (0-1) of ads with variantCount > 1. */
	testedShare: number;
	/** Share (0-1) of ACTIVE ads first observed within the last 30 days. */
	freshShare: number;
	/** Share (0-1) of all ads with longevity >= 30 days. */
	persistentShare: number;
}

export interface AggressionScore {
	/** 0-100; always the exact sum of the four rounded components. */
	score: number;
	components: AggressionScoreComponents;
	formulaVersion: typeof AGGRESSION_FORMULA_VERSION;
	band: AggressionBand;
	facts: AggressionScoreFacts;
}

/**
 * Score bands with neutral interpretations. Boundaries are inclusive upper
 * edges: 0-25 quiet, 26-50 steady, 51-75 aggressive, 76-100 all-out.
 */
const AGGRESSION_BANDS: readonly (AggressionBand & { max: number })[] = [
	{
		id: "quiet",
		label: "Quiet",
		max: 25,
		interpretation: "Running a quiet ad program in the observed window.",
	},
	{
		id: "steady",
		label: "Steady",
		max: 50,
		interpretation: "Maintaining a steady, consistent ad program.",
	},
	{
		id: "aggressive",
		label: "Aggressive",
		max: 75,
		interpretation: "Running an aggressive testing program.",
	},
	{
		id: "all_out",
		label: "All-out",
		max: 100,
		interpretation: "Running an all-out launch and testing push.",
	},
];

export interface PublicAggressionBand extends AggressionBand {
	minScore: number;
	maxScore: number;
}

/**
 * Inclusive score ranges for the public methodology page. Derived from the
 * same band table `aggressionBandForScore` uses, so the published ranges
 * cannot drift from the scorer.
 */
export function publicAggressionBands(): readonly PublicAggressionBand[] {
	let minScore = 0;
	return AGGRESSION_BANDS.map((band) => {
		const published = {
			id: band.id,
			label: band.label,
			interpretation: band.interpretation,
			minScore,
			maxScore: band.max,
		};
		minScore = band.max + 1;
		return published;
	});
}

export function aggressionBandForScore(score: number): AggressionBand {
	const band =
		AGGRESSION_BANDS.find((candidate) => score <= candidate.max) ??
		AGGRESSION_BANDS[AGGRESSION_BANDS.length - 1];
	return { id: band.id, label: band.label, interpretation: band.interpretation };
}

/**
 * Velocity curve (0-25 points): piecewise-linear over new ads per week.
 *
 *   0 ads/week  ->  0 points   (nothing new launching)
 *   1 ad/week   -> 10 points   (steady trickle)
 *   3 ads/week  -> 18 points   (busy program)
 *   5+ ads/week -> 25 points   (saturated — launching faster tops out here)
 *
 * Concave by intent: the jump from 0 to 1 ad/week says more about intent
 * than the jump from 4 to 5.
 */
export function velocityCurvePoints(adsPerWeek: number): number {
	if (!Number.isFinite(adsPerWeek) || adsPerWeek <= 0) return 0;
	if (adsPerWeek >= 5) return 25;
	if (adsPerWeek <= 1) return adsPerWeek * 10;
	if (adsPerWeek <= 3) return 10 + (adsPerWeek - 1) * 4; // 10 -> 18 over 1..3
	return 18 + (adsPerWeek - 3) * 3.5; // 18 -> 25 over 3..5
}

/**
 * Testing curve (0-25 points): linear in the share of ads that carry more
 * than one creative variant, saturating at 50%.
 *
 *   0% multi-variant   ->  0 points
 *   25% multi-variant  -> 12.5 points
 *   50%+ multi-variant -> 25 points (half the program under test is already
 *                          a heavy testing posture — more caps out)
 */
export function testingCurvePoints(testedShare: number): number {
	if (!Number.isFinite(testedShare) || testedShare <= 0) return 0;
	return Math.min(25, (testedShare / AGGRESSION_TESTING_SATURATION_SHARE) * 25);
}

/**
 * Linear share curve (0-25 points) used by freshness and persistence:
 * 0% -> 0, 50% -> 12.5, 100% -> 25. No saturation shortcut — both facts are
 * meaningful across the whole range.
 */
export function linearShareCurvePoints(share: number): number {
	if (!Number.isFinite(share) || share <= 0) return 0;
	return Math.min(25, share * 25);
}

/**
 * Compute the aggression score from a competitor dossier.
 *
 * Returns null when the dossier is not_enough_history or the observed window
 * is shorter than MIN_AGGRESSION_WINDOW_DAYS — too little evidence for a
 * fair score. Deterministic: same dossier + same `now` -> same score.
 *
 * Each component is rounded to a whole point BEFORE summing so the four
 * displayed bars always add up exactly to the displayed total.
 */
export function computeAggressionScore(
	dossier: CompetitorDossier,
	now: Date = new Date(),
): AggressionScore | null {
	if (dossier.status !== "ready" || dossier.adHistory.length === 0) {
		return null;
	}

	const observedSinceTime = Date.parse(dossier.observedSince);
	if (Number.isNaN(observedSinceTime)) {
		return null;
	}
	const windowDays = Math.floor((now.getTime() - observedSinceTime) / MS_PER_DAY);
	if (windowDays < MIN_AGGRESSION_WINDOW_DAYS) {
		return null;
	}

	const adCount = dossier.adHistory.length;
	const adsPerWeek = adCount / (windowDays / 7);

	const testedCount = dossier.adHistory.filter(
		(entry) => (entry.variantCount ?? 0) > 1,
	).length;
	const testedShare = testedCount / adCount;

	const activeAds = dossier.adHistory.filter((entry) => entry.active);
	const freshCutoff = now.getTime() - AGGRESSION_FRESHNESS_DAYS * MS_PER_DAY;
	const freshCount = activeAds.filter((entry) => {
		const firstObserved = Date.parse(entry.firstObservedAt);
		return !Number.isNaN(firstObserved) && firstObserved >= freshCutoff;
	}).length;
	const freshShare = activeAds.length > 0 ? freshCount / activeAds.length : 0;

	const persistentCount = dossier.adHistory.filter(
		(entry) => entry.longevityDays >= AGGRESSION_PERSISTENCE_DAYS,
	).length;
	const persistentShare = persistentCount / adCount;

	const components: AggressionScoreComponents = {
		velocity: Math.round(velocityCurvePoints(adsPerWeek)),
		testing: Math.round(testingCurvePoints(testedShare)),
		freshness: Math.round(linearShareCurvePoints(freshShare)),
		persistence: Math.round(linearShareCurvePoints(persistentShare)),
	};
	const score =
		components.velocity + components.testing + components.freshness + components.persistence;

	return {
		score,
		components,
		formulaVersion: AGGRESSION_FORMULA_VERSION,
		band: aggressionBandForScore(score),
		facts: {
			windowDays,
			adCount,
			activeCount: activeAds.length,
			adsPerWeek: Math.round(adsPerWeek * 10) / 10,
			testedShare,
			freshShare,
			persistentShare,
		},
	};
}
