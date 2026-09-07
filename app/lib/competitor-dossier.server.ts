import { adLongevityDays } from "~/lib/ad-display";
import { classifyAdAngle, type AngleId } from "~/lib/angle-classifier";
import {
	countDossierLandingPageChanges,
	getDossierHealthyScanStats,
	getDossierLatestLandingPageChange,
	listDossierObservationHistory,
	type DossierObservationRow,
} from "~/lib/data/competitor-dossier.server";
import type { AppEnv } from "~/lib/env.server";
import { trackedDaysBetween } from "~/lib/trend-chart-data";

/**
 * Competitor dossier: what this watchlist's accumulated observation history
 * adds up to. Computed entirely from existing tables (ad_observation,
 * watchlist_run, ad, watch_event) — the compounding "workspace memory" layer
 * made visible.
 *
 * Honesty rules (mirroring trend-chart-data):
 * - "Running N days" only comes from an active ad with Meta's published start
 *   date; everything else uses our own closed observation window ("Tracked").
 *   The basis is carried on every entry so the UI can label provenance.
 * - Every ready dossier states its evidence window (observedSince + scan
 *   count). Below two healthy scans or zero observed ads, the result is a
 *   typed not_enough_history state — never a fake insight.
 */

const MS_PER_DAY = 86_400_000;

export const DOSSIER_MIN_SCANS = 2;
export const DOSSIER_LONGEVITY_LEADER_COUNT = 3;
export const DOSSIER_HOOK_PREFIX_WORDS = 8;
export const DOSSIER_HOOK_PATTERN_MIN_COUNT = 2;
export const DOSSIER_HOOK_PATTERN_LIMIT = 5;
export const DOSSIER_VELOCITY_WEEKS = 8;

export interface DossierAdHistoryEntry {
	metaAdId: string;
	hook: string;
	/** Meta's published start date, when the Ad Library exposed one. */
	metaFirstSeenAt: string | null;
	/** Earliest observation by THIS watchlist (our data, not Meta's). */
	firstObservedAt: string;
	lastObservedAt: string;
	observedRunCount: number;
	active: boolean;
	format: string;
	/** Meta-published creative variant count; null when the source omitted it. */
	variantCount: number | null;
	longevityDays: number;
	/** "running" = Meta's published start date; "tracked" = our own window. */
	longevityBasis: "running" | "tracked";
	/** Render-ready provenance label, e.g. "Running 41 days". */
	longevityLabel: string;
}

export interface DossierFormatShare {
	format: string;
	count: number;
}

export interface DossierHookPattern {
	/** Normalized grouping key (lowercased first-8-words prefix). */
	pattern: string;
	/** Raw prefix from the first occurrence, for display. */
	sample: string;
	count: number;
}

export interface DossierVelocityBucket {
	/** ISO week start (UTC Monday), YYYY-MM-DD. */
	weekStart: string;
	/** Compact label, e.g. "13 Jul". */
	label: string;
	count: number;
}

export interface DossierVelocity {
	/** Oldest → newest, one bucket per ISO week (zeros kept). */
	buckets: DossierVelocityBucket[];
	maxCount: number;
	/** Ads first observed before the charted window — shown, not hidden. */
	earlierCount: number;
}

export interface DossierLandingPageChanges {
	count: number;
	latest: {
		eventId: string;
		eventType: string;
		title: string;
		createdAt: string;
	} | null;
}

/** One confidently classified marketing angle and how many ads landed on it. */
export interface DossierAngleShare {
	angle: AngleId;
	count: number;
}

/**
 * Angle read across every distinct ad in retained history, classified from
 * the ad's own copy (hook + offer + CTA). Honesty split mirrors the
 * classifier's own confidence tiers:
 * - `shares` counts only confident classifications, sorted by count desc.
 * - `tentativeCount` is low-confidence fallback reads (brand_lifestyle) —
 *   reported separately, never mixed into the confident counts.
 * - `unclassifiedCount` is ads the classifier honestly declined — shown, not
 *   hidden, so the mix never implies coverage it does not have.
 */
export interface DossierAngleMix {
	shares: DossierAngleShare[];
	tentativeCount: number;
	unclassifiedCount: number;
}

export interface CompetitorDossierReady {
	status: "ready";
	/** Earliest observation in retained history — the evidence window start. */
	observedSince: string;
	/** Retained healthy scans backing every number in this dossier. */
	scanCount: number;
	adHistory: DossierAdHistoryEntry[];
	longevityLeaders: DossierAdHistoryEntry[];
	activeCount: number;
	inactiveCount: number;
	formatMix: DossierFormatShare[];
	hookPatterns: DossierHookPattern[];
	adVelocity: DossierVelocity;
	landingPageChanges: DossierLandingPageChanges;
	/** See DossierAngleMix — always present on a ready dossier. */
	angleMix: DossierAngleMix;
	/** Ads whose persisted copy carries a non-empty offer line. */
	offerCount: number;
}

export interface CompetitorDossierInsufficient {
	status: "not_enough_history";
	scanCount: number;
	adCount: number;
}

export type CompetitorDossier = CompetitorDossierReady | CompetitorDossierInsufficient;

/** The honest empty state; also the loader's degrade-on-failure fallback. */
export function insufficientCompetitorDossier(
	scanCount = 0,
	adCount = 0,
): CompetitorDossierInsufficient {
	return { status: "not_enough_history", scanCount, adCount };
}

export async function buildCompetitorDossier(
	env: AppEnv,
	watchlistId: string,
	userId: string,
	now: Date = new Date(),
): Promise<CompetitorDossier> {
	if (!env.DB) {
		return insufficientCompetitorDossier();
	}

	// All four reads are independent — one parallel wave. The hot path is an
	// established watchlist (enough history), so the change-count reads run
	// speculatively; the not-enough-history case spends two extra cheap
	// indexed reads and still returns the honest insufficient state.
	const [stats, history, changeCount, latestChange] = await Promise.all([
		getDossierHealthyScanStats(env, watchlistId, userId),
		listDossierObservationHistory(env, watchlistId, userId),
		countDossierLandingPageChanges(env, watchlistId, userId),
		getDossierLatestLandingPageChange(env, watchlistId, userId),
	]);
	const scanCount = Number(stats?.scan_count ?? 0);
	if (scanCount < DOSSIER_MIN_SCANS || history.length === 0) {
		return insufficientCompetitorDossier(scanCount, history.length);
	}

	const adHistory = history.map((row) => toHistoryEntry(row, now));
	const longevityLeaders = [...adHistory]
		.sort(
			(left, right) =>
				right.longevityDays - left.longevityDays || left.metaAdId.localeCompare(right.metaAdId),
		)
		.slice(0, DOSSIER_LONGEVITY_LEADER_COUNT);
	const activeCount = adHistory.filter((entry) => entry.active).length;

	return {
		status: "ready",
		observedSince: history[0].first_observed_at,
		scanCount,
		adHistory,
		longevityLeaders,
		activeCount,
		inactiveCount: adHistory.length - activeCount,
		formatMix: computeFormatMix(adHistory),
		hookPatterns: computeHookPatterns(adHistory),
		adVelocity: computeAdVelocity(
			adHistory.map((entry) => entry.firstObservedAt),
			now,
		),
		landingPageChanges: {
			count: changeCount,
			latest: latestChange
				? {
						eventId: latestChange.id,
						eventType: latestChange.event_type,
						title: latestChange.title,
						createdAt: latestChange.created_at,
					}
				: null,
		},
		angleMix: computeAngleMix(history),
		offerCount: history.filter((row) => Boolean(row.offer_text?.trim())).length,
	};
}

/** The copy fields angle classification reads per ad. */
export interface AngleMixInput {
	hook: string | null;
	offer_text: string | null;
	cta: string | null;
}

/**
 * Classify each distinct ad's persisted copy (hook + offer + CTA, null/empty
 * parts skipped) and aggregate. Confident classifications become sorted
 * shares; low-confidence fallback reads are counted as tentative only; ads
 * the classifier declines (too short, ambiguous) are reported as
 * unclassified — the three buckets always sum to the ad count.
 */
export function computeAngleMix(entries: readonly AngleMixInput[]): DossierAngleMix {
	const counts = new Map<AngleId, number>();
	let tentativeCount = 0;
	let unclassifiedCount = 0;

	for (const entry of entries) {
		const text = [entry.hook, entry.offer_text, entry.cta]
			.map((part) => part?.trim())
			.filter(Boolean)
			.join(" \n ");
		const classification = classifyAdAngle(text);
		if (!classification) {
			unclassifiedCount += 1;
			continue;
		}
		if (classification.lowConfidence) {
			tentativeCount += 1;
			continue;
		}
		counts.set(classification.angle, (counts.get(classification.angle) ?? 0) + 1);
	}

	const shares = [...counts.entries()]
		.map(([angle, count]) => ({ angle, count }))
		.sort((left, right) => right.count - left.count || left.angle.localeCompare(right.angle));

	return { shares, tentativeCount, unclassifiedCount };
}

function toHistoryEntry(row: DossierObservationRow, now: Date): DossierAdHistoryEntry {
	const active = Boolean(row.latest_is_active);
	const longevity = resolveLongevity(row, active, now);

	return {
		metaAdId: row.ad_id,
		hook: row.hook,
		metaFirstSeenAt: row.meta_first_seen_at,
		firstObservedAt: row.first_observed_at,
		lastObservedAt: row.last_observed_at,
		observedRunCount: Number(row.observed_run_count) || 0,
		active,
		format: row.creative_format,
		variantCount: normalizeVariantCount(row.variant_count),
		longevityDays: longevity.days,
		longevityBasis: longevity.basis,
		longevityLabel: formatLongevityLabel(longevity.days, longevity.basis),
	};
}

/** Positive integer variant counts only; anything else is honestly unknown. */
function normalizeVariantCount(value: unknown): number | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return null;
	}
	return Math.floor(parsed);
}

/**
 * Active + published Meta start date → "running" days up to now. Everything
 * else — inactive ads (which must stop accruing) and ads without a published
 * date — uses the closed local observation window ("tracked").
 */
function resolveLongevity(
	row: DossierObservationRow,
	active: boolean,
	now: Date,
): { days: number; basis: "running" | "tracked" } {
	if (active) {
		const running = adLongevityDays(
			{ firstSeenAt: row.meta_first_seen_at, lastSeenAt: null },
			now,
		);
		if (running !== null) {
			return { days: running, basis: "running" };
		}
	}

	const tracked = trackedDaysBetween(row.first_observed_at, row.last_observed_at);
	return { days: tracked ?? 1, basis: "tracked" };
}

function formatLongevityLabel(days: number, basis: "running" | "tracked"): string {
	const verb = basis === "running" ? "Running" : "Tracked";
	return days === 1 ? `${verb} 1 day` : `${verb} ${days} days`;
}

function computeFormatMix(entries: readonly DossierAdHistoryEntry[]): DossierFormatShare[] {
	const counts = new Map<string, number>();
	for (const entry of entries) {
		const format = entry.format.trim() || "unknown";
		counts.set(format, (counts.get(format) ?? 0) + 1);
	}

	return [...counts.entries()]
		.map(([format, count]) => ({ format, count }))
		.sort((left, right) => right.count - left.count || left.format.localeCompare(right.format));
}

/** Lowercased, punctuation-stripped prefix of up to the first 8 words. */
function normalizeHookPrefix(hook: string): string {
	return hook
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s']/gu, " ")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, DOSSIER_HOOK_PREFIX_WORDS)
		.join(" ");
}

/**
 * Recurring hook openings: ads grouped by the normalized first-8-words prefix,
 * kept only when the same opening appears at least twice — a single hook is
 * not a pattern.
 */
export function computeHookPatterns(
	entries: readonly Pick<DossierAdHistoryEntry, "hook">[],
): DossierHookPattern[] {
	const groups = new Map<string, { sample: string; count: number }>();
	for (const entry of entries) {
		const pattern = normalizeHookPrefix(entry.hook);
		if (!pattern) {
			continue;
		}

		const existing = groups.get(pattern);
		if (existing) {
			groups.set(pattern, { ...existing, count: existing.count + 1 });
			continue;
		}

		const sample = entry.hook.trim().split(/\s+/).slice(0, DOSSIER_HOOK_PREFIX_WORDS).join(" ");
		groups.set(pattern, { sample, count: 1 });
	}

	return [...groups.entries()]
		.filter(([, group]) => group.count >= DOSSIER_HOOK_PATTERN_MIN_COUNT)
		.map(([pattern, group]) => ({ pattern, sample: group.sample, count: group.count }))
		.sort((left, right) => right.count - left.count || left.pattern.localeCompare(right.pattern))
		.slice(0, DOSSIER_HOOK_PATTERN_LIMIT);
}

/** UTC Monday (start of the ISO week) for the given time. */
function isoWeekStartTime(time: number): number {
	const date = new Date(time);
	const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	const daysSinceMonday = (date.getUTCDay() + 6) % 7;
	return dayStart - daysSinceMonday * MS_PER_DAY;
}

const WEEK_LABEL_FORMAT = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});

/**
 * New ads first observed by this watchlist, bucketed per ISO week over the
 * trailing DOSSIER_VELOCITY_WEEKS weeks. Ads first observed before the window
 * are counted in `earlierCount` rather than silently dropped; timestamps in
 * the future clamp to the current week (clock-skew guard).
 */
export function computeAdVelocity(
	firstObservedTimes: readonly string[],
	now: Date = new Date(),
	weeks: number = DOSSIER_VELOCITY_WEEKS,
): DossierVelocity {
	const currentWeekStart = isoWeekStartTime(now.getTime());
	const windowStart = currentWeekStart - (weeks - 1) * 7 * MS_PER_DAY;
	const countsByWeekStart = new Map<number, number>();
	let earlierCount = 0;

	for (const iso of firstObservedTimes) {
		const time = Date.parse(iso);
		if (Number.isNaN(time)) {
			continue;
		}

		const weekStart = isoWeekStartTime(Math.min(time, now.getTime()));
		if (weekStart < windowStart) {
			earlierCount += 1;
			continue;
		}

		countsByWeekStart.set(weekStart, (countsByWeekStart.get(weekStart) ?? 0) + 1);
	}

	const buckets: DossierVelocityBucket[] = [];
	for (let index = 0; index < weeks; index += 1) {
		const weekStart = windowStart + index * 7 * MS_PER_DAY;
		buckets.push({
			weekStart: new Date(weekStart).toISOString().slice(0, 10),
			label: WEEK_LABEL_FORMAT.format(new Date(weekStart)),
			count: countsByWeekStart.get(weekStart) ?? 0,
		});
	}

	return {
		buckets,
		maxCount: buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0),
		earlierCount,
	};
}
