import {
	claimDigestStrategyGenerationLease,
	completeDigestStrategyGeneration,
} from "~/lib/data.server";
import {
	DIGEST_STRATEGY_GENERATION_LEASE_MS,
	DIGEST_STRATEGY_GENERATION_PENDING,
	DIGEST_STRATEGY_GENERATION_READY,
	DIGEST_STRATEGY_MODEL,
	readPendingDigestStrategyGeneration,
} from "~/lib/digest-strategy";
import {
	buildWeeklyStrategyParagraph,
	type DigestStrategyItemInput,
} from "~/lib/digest-strategy.server";
import type { AppEnv } from "~/lib/env.server";
import type { UserPlan } from "~/lib/plan.server";
import type { DigestRecord } from "~/lib/types";

// Strategy prose is additive. Give it a small, explicit share of the cron
// window so deterministic digest delivery remains available to every user.
export const DIGEST_STRATEGY_GENERATION_RUN_BUDGET_MS = 60_000;

export function createDigestStrategyGenerationDeadline(
	hardDeadlineAt: number | undefined,
	now = Date.now(),
) {
	const runBudgetDeadline = now + DIGEST_STRATEGY_GENERATION_RUN_BUDGET_MS;
	return typeof hardDeadlineAt === "number" && Number.isFinite(hardDeadlineAt)
		? Math.min(runBudgetDeadline, hardDeadlineAt)
		: runBudgetDeadline;
}

export function createDigestStrategyGenerationLease(now = Date.now()) {
	return {
		leaseId: crypto.randomUUID(),
		leaseExpiresAt: new Date(
			now + DIGEST_STRATEGY_GENERATION_LEASE_MS,
		).toISOString(),
	};
}

export async function recoverDigestStrategyGeneration(
	env: AppEnv,
	input: {
		digest: DigestRecord;
		periodStart: string;
		periodEnd: string;
		plan: UserPlan;
		strategyGenerationDeadlineAt: number;
	},
) {
	const pending = readPendingDigestStrategyGeneration(input.digest.summary);
	if (!pending) return { outcome: "not_pending" as const, digest: input.digest };
	if (!digestStrategyGenerationLeaseExpired(pending.leaseExpiresAt)) {
		return { outcome: "active" as const };
	}

	const lease = createDigestStrategyGenerationLease();
	const claimed = await claimDigestStrategyGenerationLease(env, input.digest.id, {
		expectedLeaseId: pending.leaseId,
		expectedLeaseExpiresAt: pending.leaseExpiresAt,
		leaseId: lease.leaseId,
		leaseExpiresAt: lease.leaseExpiresAt,
	});
	if (!claimed) return { outcome: "claim_lost" as const };

	const settled = await settleDigestStrategyGeneration(env, {
		digestRunId: input.digest.id,
		leaseId: lease.leaseId,
		summary: input.digest.summary ?? {},
		items: input.digest.items,
		periodStart: input.periodStart,
		periodEnd: input.periodEnd,
		plan: input.plan,
		strategyGenerationDeadlineAt: input.strategyGenerationDeadlineAt,
	});
	if (!settled) return { outcome: "settlement_lost" as const };

	return {
		outcome: "settled" as const,
		digest: { ...input.digest, summary: settled.summary },
		strategyParagraph: settled.strategyParagraph,
	};
}

export async function settleDigestStrategyGeneration(
	env: AppEnv,
	input: {
		digestRunId: string;
		leaseId: string;
		summary: Record<string, unknown>;
		items: readonly DigestStrategyItemInput[];
		periodStart: string;
		periodEnd: string;
		plan: UserPlan;
		strategyGenerationDeadlineAt: number;
	},
) {
	const remainingBudgetMs = Math.max(
		0,
		Math.floor(input.strategyGenerationDeadlineAt - Date.now()),
	);
	const generatedStrategy =
		(input.plan === "starter" || input.plan === "agency") &&
		remainingBudgetMs > 0
			? await buildWeeklyStrategyParagraph(env, {
					items: input.items,
					periodStart: input.periodStart,
					periodEnd: input.periodEnd,
					timeoutMs: remainingBudgetMs,
				})
			: null;
	const readySummary: Record<string, unknown> = {
		...input.summary,
		strategyGenerationStatus: DIGEST_STRATEGY_GENERATION_READY,
	};
	delete readySummary.strategyGenerationLeaseId;
	delete readySummary.strategyGenerationLeaseExpiresAt;
	delete readySummary.strategyParagraph;
	delete readySummary.strategyModel;
	delete readySummary.strategyGeneratedAt;
	delete readySummary.strategyWatchlistIds;

	if (generatedStrategy) {
		readySummary.strategyParagraph = generatedStrategy.paragraph;
		readySummary.strategyModel = DIGEST_STRATEGY_MODEL;
		readySummary.strategyGeneratedAt = new Date().toISOString();
		readySummary.strategyWatchlistIds = generatedStrategy.watchlistIds;
	}

	const completed = await completeDigestStrategyGeneration(
		env,
		input.digestRunId,
		{
			leaseId: input.leaseId,
			summary: readySummary,
		},
	);
	return completed
		? {
				summary: readySummary,
				strategyParagraph: generatedStrategy?.paragraph ?? null,
			}
		: null;
}

function digestStrategyGenerationLeaseExpired(
	leaseExpiresAt: string,
	now = Date.now(),
) {
	const expiresAt = Date.parse(leaseExpiresAt);
	return !Number.isFinite(expiresAt) || expiresAt <= now;
}
