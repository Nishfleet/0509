/**
 * Shared (client-safe) helpers for the AI weekly strategy paragraph stored in
 * `digest_run.summary_json`. Generation lives in `digest-strategy.server.ts`;
 * this module only knows how to read a stored summary shape back out.
 */

export const DIGEST_STRATEGY_MODEL = "@cf/meta/llama-3.2-3b-instruct";
export const DIGEST_STRATEGY_GENERATION_LEASE_MS = 2 * 60 * 1000;
export const DIGEST_STRATEGY_GENERATION_PENDING = "pending" as const;
export const DIGEST_STRATEGY_GENERATION_READY = "ready" as const;

export interface PendingDigestStrategyGeneration {
	status: typeof DIGEST_STRATEGY_GENERATION_PENDING;
	leaseId: string;
	leaseExpiresAt: string;
}

export interface DigestStrategyNote {
	paragraph: string;
	generatedAt: string | null;
	watchlistIds: string[] | null;
}

/**
 * Reads a stored strategy paragraph out of a digest_run summary object.
 * Tolerates legacy summary shapes: invalid/missing paragraphs return null,
 * while a valid legacy paragraph stays readable with null provenance.
 */
export function readDigestStrategyNote(
	summary: Record<string, unknown> | null | undefined,
): DigestStrategyNote | null {
	if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
		return null;
	}

	const rawParagraph = summary.strategyParagraph;
	if (typeof rawParagraph !== "string") {
		return null;
	}

	const paragraph = rawParagraph.replace(/\s+/g, " ").trim();
	if (!paragraph) {
		return null;
	}

	const rawGeneratedAt = summary.strategyGeneratedAt;
	const generatedAt =
		typeof rawGeneratedAt === "string" && rawGeneratedAt.trim()
			? rawGeneratedAt.trim()
			: null;

	const rawWatchlistIds = summary.strategyWatchlistIds;
	const watchlistIds =
		Array.isArray(rawWatchlistIds) &&
		rawWatchlistIds.length > 0 &&
		rawWatchlistIds.every((value) => typeof value === "string" && value.trim())
			? [...new Set(rawWatchlistIds.map((value) => (value as string).trim()))]
			: null;

	return { paragraph, generatedAt, watchlistIds };
}

/**
 * Missing state is legacy-ready: old runs must keep replaying their immutable
 * stored content rather than unexpectedly generating new customer-visible AI.
 */
export function readPendingDigestStrategyGeneration(
	summary: Record<string, unknown> | null | undefined,
): PendingDigestStrategyGeneration | null {
	if (
		!summary ||
		typeof summary !== "object" ||
		Array.isArray(summary) ||
		summary.strategyGenerationStatus !== DIGEST_STRATEGY_GENERATION_PENDING
	) {
		return null;
	}

	return {
		status: DIGEST_STRATEGY_GENERATION_PENDING,
		leaseId: readSummaryString(summary.strategyGenerationLeaseId),
		leaseExpiresAt: readSummaryString(summary.strategyGenerationLeaseExpiresAt),
	};
}

function readSummaryString(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}
