import { adLongevityDays } from "~/lib/ad-display";
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

/**
 * TODO(angle-mix): once `app/lib/angle-classifier.ts` lands with
 * `classifyAdAngle(text)`, classify each history entry's hook and aggregate
 * shares here. Deliberately optional and undefined until that module exists —
 * do not fake angle data.
 */
export interface DossierAngleShare {
	angle: string;
	count: number;
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
	/** See DossierAngleShare — stays undefined until the classifier ships. */
	angleMix?: DossierAngleShare[];
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

	const [stats, history] = await Promise.all([
		getDossierHealthyScanStats(env, watchlistId, userId),
		listDossierObservationHistory(env, watchlistId, userId),
	]);
	const scanCount = Number(stats?.scan_count ?? 0);
	if (scanCount < DOSSIER_MIN_SCANS || history.length === 0) {
		return insufficientCompetitorDossier(scanCount, history.length);
	}

	const [changeCount, latestChange] = await Promise.all([
		countDossierLandingPageChanges(env, watchlistId, userId),
		getDossierLatestLandingPageChange(env, watchlistId, userId),
	]);

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
	};
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
		longevityDays: longevity.days,
		longevityBasis: longevity.basis,
		longevityLabel: formatLongevityLabel(longevity.days, longevity.basis),
	};
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
