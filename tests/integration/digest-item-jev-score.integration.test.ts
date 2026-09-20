import { describe, expect, it } from "vitest";

import { createDigestRun } from "~/lib/data.server";
import {
	listDigestItemJevScores,
	upsertDigestItemJevScores,
} from "~/lib/data/digests.server";

import { appEnv, db, ISO_T0, seedUser, seedWatchlist, uid } from "./fixtures";

/**
 * Issue #3539 (epic #3530): the additive `digest_item_jev_score` evidence
 * table for Jev advisory scoring.
 *
 * This is a MIGRATION-backed test on real workerd + D1: the schema comes from
 * applying the repo's real `migrations/*.sql`, which is exactly what the D1
 * schema rule requires — a mocked-binding unit test cannot see the table, the
 * CHECK constraints, or the upsert key. Both halves are asserted:
 *
 *   1. the WRITE path — `upsertDigestItemJevScores` inserts rows and a retry
 *      of the same (digest_run_id, event_id) upserts instead of duplicating;
 *   2. the READ path — `listDigestItemJevScores` returns the stored scores
 *      beside the heuristic priority_score the benchmark compares against.
 */

const PERIOD_START = "2026-09-19T00:00:00.000Z";
const PERIOD_END = "2026-09-20T00:00:00.000Z";

function scoreRow(
	digestRunId: string,
	watchlistId: string,
	eventId: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		digestRunId,
		eventId,
		watchlistId,
		eventType: "ad_new",
		inCohort: true,
		priorityScore: 42,
		worthTellingP: 0.2,
		worthAlert: 1,
		worthAlertConfidence: 0.7,
		wouldSuppress: true,
		stateSha256: "a".repeat(64),
		model: "jev-1.13.0",
		inputTokens: 1200,
		outputTokens: 60,
		ms: 320,
		...overrides,
	};
}

describe("digest_item_jev_score", () => {
	it("writes and reads back advisory scores beside priority_score", async () => {
		const userId = await seedUser();
		const watchlistId = await seedWatchlist(userId);
		const digestRunId = await createDigestRun(
			appEnv,
			userId,
			PERIOD_START,
			PERIOD_END,
			{ note: "jev-score-write-read" },
		);

		const written = await upsertDigestItemJevScores(appEnv, [
			scoreRow(digestRunId, watchlistId, uid("evt")),
			scoreRow(digestRunId, watchlistId, uid("evt"), {
				inCohort: false,
				priorityScore: null,
				worthTellingP: 0.9,
				worthAlert: 3,
				worthAlertConfidence: null,
				wouldSuppress: false,
			}),
		]);
		expect(written).toBe(2);

		const rows = await listDigestItemJevScores(appEnv, digestRunId);
		expect(rows).toHaveLength(2);
		const suppressed = rows.find((row) => row.wouldSuppress)!;
		expect(suppressed).toMatchObject({
			digestRunId,
			watchlistId,
			eventType: "ad_new",
			inCohort: true,
			priorityScore: 42,
			worthTellingP: 0.2,
			worthAlert: 1,
			worthAlertConfidence: 0.7,
			model: "jev-1.13.0",
			inputTokens: 1200,
			outputTokens: 60,
			ms: 320,
		});
		expect(suppressed.stateSha256).toMatch(/^[0-9a-f]{64}$/);
		const rescued = rows.find((row) => !row.inCohort)!;
		expect(rescued.priorityScore).toBeNull();
		expect(rescued.worthAlert).toBe(3);
	});

	it("upserts on (digest_run_id, event_id) so a retried run never duplicates", async () => {
		const userId = await seedUser();
		const watchlistId = await seedWatchlist(userId);
		const digestRunId = await createDigestRun(
			appEnv,
			userId,
			PERIOD_START,
			"2026-09-21T00:00:00.000Z",
			{ note: "jev-score-upsert" },
		);
		const eventId = uid("evt");

		await upsertDigestItemJevScores(appEnv, [
			scoreRow(digestRunId, watchlistId, eventId, { worthTellingP: 0.2 }),
		]);
		await upsertDigestItemJevScores(appEnv, [
			scoreRow(digestRunId, watchlistId, eventId, {
				worthTellingP: 0.9,
				worthAlert: 3,
				wouldSuppress: false,
				model: "jev-1.14.0",
			}),
		]);

		const rows = await listDigestItemJevScores(appEnv, digestRunId);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			eventId,
			worthTellingP: 0.9,
			worthAlert: 3,
			wouldSuppress: false,
			model: "jev-1.14.0",
		});
	});

	it("enforces the CHECK constraints on stored probabilities and bands", async () => {
		const userId = await seedUser();
		const watchlistId = await seedWatchlist(userId);
		const digestRunId = await createDigestRun(
			appEnv,
			userId,
			PERIOD_START,
			"2026-09-22T00:00:00.000Z",
			{ note: "jev-score-checks" },
		);

		await expect(
			upsertDigestItemJevScores(appEnv, [
				scoreRow(digestRunId, watchlistId, uid("evt"), { worthTellingP: 1.4 }),
			]),
		).rejects.toThrow();
		await expect(
			upsertDigestItemJevScores(appEnv, [
				scoreRow(digestRunId, watchlistId, uid("evt"), { worthAlert: 4 }),
			]),
		).rejects.toThrow();
	});

	it("cascades with the digest run so evidence never outlives its run", async () => {
		const userId = await seedUser();
		const watchlistId = await seedWatchlist(userId);
		const digestRunId = await createDigestRun(
			appEnv,
			userId,
			PERIOD_START,
			"2026-09-23T00:00:00.000Z",
			{ note: "jev-score-cascade" },
		);
		await upsertDigestItemJevScores(appEnv, [
			scoreRow(digestRunId, watchlistId, uid("evt")),
		]);
		await db()
			.prepare("DELETE FROM digest_run WHERE id = ?")
			.bind(digestRunId)
			.run();
		expect(await listDigestItemJevScores(appEnv, digestRunId)).toHaveLength(0);
	});
});
