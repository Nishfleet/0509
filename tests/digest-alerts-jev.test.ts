import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	DIGEST_ALERTS_MAX_ITEMS,
	DIGEST_ALERTS_MODEL,
	DIGEST_ALERTS_SITE,
	DIGEST_ALERTS_WOULD_SUPPRESS_BELOW,
	DIGEST_ALERTS_WORTH_ALERT_LEVELS,
	DigestAlertsAnswerError,
	buildDigestAlertsRequest,
	decideDigestAlerts,
	digestAlertItemKeys,
	digestAlertWouldSuppress,
	digestAlertsBindingCircuitIsOpen,
	digestAlertsJevEnabled,
	digestAlertsStateSha256,
	resetDigestAlertsBindingCircuitForTests,
	shadowScoreDigestItems,
	significanceQuestionId,
	worthTellingQuestionId,
	type DigestAlertItemInput,
	type DigestAlertsAi,
} from "../app/lib/digest-alerts-jev.server";
import type { AppEnv } from "../app/lib/env.server";

function item(
	eventId: string,
	overrides: Partial<DigestAlertItemInput> = {},
): DigestAlertItemInput {
	return {
		eventId,
		watchlistId: `wl_${eventId}`,
		watchlistName: `Watchlist ${eventId}`,
		eventType: "ad_new",
		title: `Title ${eventId}`,
		summary: `Summary ${eventId}`,
		priorityScore: 42,
		inCohort: true,
		...overrides,
	};
}

const baseInput = {
	digestRunId: "run_1",
	cadence: "daily",
	periodStart: "2026-09-19T00:00:00.000Z",
	periodEnd: "2026-09-20T00:00:00.000Z",
};

/** A binding that answers every per-item question pair validly. */
function fakeAi(
	overrides: {
		worthTellingP?: number;
		worthAlert?: number;
		confidence?: number;
		usage?: { input_tokens: number; output_tokens: number };
		model?: string;
		dropKeys?: readonly string[];
	} = {},
): DigestAlertsAi {
	return {
		async run(_model, input) {
			const questions = input.questions as Record<string, { type: string }>;
			const answers: Record<string, unknown> = {};
			for (const [id, question] of Object.entries(questions)) {
				if (overrides.dropKeys?.includes(id)) continue;
				if (question.type === "noul") {
					answers[id] = {
						type: "noul",
						noul: overrides.worthTellingP ?? 0.8,
					};
				} else {
					answers[id] = {
						type: "score",
						score: overrides.worthAlert ?? 2,
						confidence: overrides.confidence ?? 0.7,
					};
				}
			}
			return {
				answers,
				usage: overrides.usage ?? { input_tokens: 1200, output_tokens: 60 },
				model: overrides.model ?? "jev-1.13.0",
			};
		},
	};
}

const enabledEnv = { JEV_ALERTS: "1" } as AppEnv;

beforeEach(() => {
	resetDigestAlertsBindingCircuitForTests();
});

describe("digestAlertsJevEnabled", () => {
	it("is off when the var is absent or not a listed enable value", () => {
		expect(digestAlertsJevEnabled({} as AppEnv)).toBe(false);
		expect(digestAlertsJevEnabled({ JEV_ALERTS: "0" } as AppEnv)).toBe(false);
		expect(digestAlertsJevEnabled({ JEV_ALERTS: "yes please" } as AppEnv)).toBe(
			false,
		);
	});

	it("is on for the listed enable values, case- and space-insensitive", () => {
		for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
			expect(digestAlertsJevEnabled({ JEV_ALERTS: value } as AppEnv)).toBe(true);
		}
	});
});

describe("buildDigestAlertsRequest", () => {
	it("emits one noul and one score question per item, keyed by event id", () => {
		const { state, questions } = buildDigestAlertsRequest({
			...baseInput,
			items: [item("evt_1"), item("evt_2", { inCohort: false })],
		});
		expect(Object.keys(questions).sort()).toEqual(
			[
				"significance:evt_1",
				"significance:evt_2",
				"worth_telling:evt_1",
				"worth_telling:evt_2",
			].sort(),
		);
		const typed = questions as Record<string, { type: string; criteria?: unknown }>;
		expect(typed["worth_telling:evt_1"].type).toBe("noul");
		expect(typed["significance:evt_1"].type).toBe("score");
		expect(
			(typed["significance:evt_1"].criteria as unknown[]).length,
		).toBe(DIGEST_ALERTS_WORTH_ALERT_LEVELS.length);
		const stateItems = (state as { items: Array<{ key: string; in_cohort: boolean }> }).items;
		expect(stateItems.map((entry) => entry.key)).toEqual(["evt_1", "evt_2"]);
		expect(stateItems[1].in_cohort).toBe(false);
	});

	it("caps the batch at DIGEST_ALERTS_MAX_ITEMS and dedupes repeated event ids", () => {
		const many = Array.from({ length: DIGEST_ALERTS_MAX_ITEMS + 10 }, (_, i) =>
			item(`evt_${i}`),
		);
		expect(
			digestAlertItemKeys([...many, item("evt_0")]).length,
		).toBe(DIGEST_ALERTS_MAX_ITEMS);
	});
});

describe("validateDigestAlertsAnswer / decideDigestAlerts", () => {
	it("returns validated per-item answers with usage and model", async () => {
		const decision = await decideDigestAlerts(fakeAi({ model: "jev-9" }), {
			...baseInput,
			items: [item("evt_1"), item("evt_2")],
		});
		expect(decision.answers.get("evt_1")).toEqual({
			worthTellingP: 0.8,
			worthAlert: 2,
			worthAlertConfidence: 0.7,
		});
		expect(decision.usage).toEqual({ input_tokens: 1200, output_tokens: 60 });
		expect(decision.model).toBe("jev-9");
		expect(decision.stateSha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it("rejects an answer missing one item's score question", async () => {
		await expect(
			decideDigestAlerts(
				fakeAi({ dropKeys: [significanceQuestionId("evt_2")] }),
				{ ...baseInput, items: [item("evt_1"), item("evt_2")] },
			),
		).rejects.toBeInstanceOf(DigestAlertsAnswerError);
	});

	it("rejects a noul answer with a wrong type or out-of-range value", async () => {
		const badType: DigestAlertsAi = {
			async run() {
				return {
					answers: {
						[worthTellingQuestionId("evt_1")]: { type: "score", score: 1 },
						[significanceQuestionId("evt_1")]: { type: "score", score: 1 },
					},
				};
			},
		};
		await expect(
			decideDigestAlerts(badType, { ...baseInput, items: [item("evt_1")] }),
		).rejects.toBeInstanceOf(DigestAlertsAnswerError);

		const badRange: DigestAlertsAi = {
			async run() {
				return {
					answers: {
						[worthTellingQuestionId("evt_1")]: { type: "noul", noul: 1.4 },
						[significanceQuestionId("evt_1")]: { type: "score", score: 1 },
					},
				};
			},
		};
		await expect(
			decideDigestAlerts(badRange, { ...baseInput, items: [item("evt_1")] }),
		).rejects.toBeInstanceOf(DigestAlertsAnswerError);
	});

	it("rejects an unpaid-gateway shape so the caller can open the circuit", async () => {
		const unpaid: DigestAlertsAi = {
			async run() {
				return {
					errors: [
						{
							message:
								"Insufficient balance; add money to your gateway or use BYOK",
							code: 2021,
						},
					],
					success: false,
				};
			},
		};
		await expect(
			decideDigestAlerts(unpaid, { ...baseInput, items: [item("evt_1")] }),
		).rejects.toThrow(/unpaid/i);
	});
});

describe("digestAlertWouldSuppress", () => {
	it("flags only in-cohort items below the provisional floor", () => {
		expect(
			digestAlertWouldSuppress(
				{ inCohort: true },
				{ worthTellingP: DIGEST_ALERTS_WOULD_SUPPRESS_BELOW - 0.01 },
			),
		).toBe(true);
		expect(
			digestAlertWouldSuppress(
				{ inCohort: true },
				{ worthTellingP: DIGEST_ALERTS_WOULD_SUPPRESS_BELOW },
			),
		).toBe(false);
		expect(
			digestAlertWouldSuppress(
				{ inCohort: false },
				{ worthTellingP: 0 },
			),
		).toBe(false);
	});
});

describe("shadowScoreDigestItems", () => {
	it("does nothing when the flag is off — no AI call, no rows", async () => {
		const run = vi.fn();
		const persist = vi.fn();
		const result = await shadowScoreDigestItems(
			{ JEV_ALERTS: "0", AI: { run } } as unknown as AppEnv,
			{ ...baseInput, items: [item("evt_1")] },
			persist,
		);
		expect(result).toBeNull();
		expect(run).not.toHaveBeenCalled();
		expect(persist).not.toHaveBeenCalled();
	});

	it("persists one evidence row per scored item and reports would-suppress", async () => {
		const rows: unknown[] = [];
		const persist = vi.fn(async (_env: AppEnv, input: readonly unknown[]) => {
			rows.push(...input);
			return input.length;
		});
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const result = await shadowScoreDigestItems(
			{ ...enabledEnv, AI: fakeAi({ worthTellingP: 0.2 }) } as AppEnv,
			{
				...baseInput,
				items: [
					item("evt_1"),
					item("evt_2", { inCohort: false }),
				],
			},
			persist,
		);
		expect(result).toEqual({ scored: 2, wouldSuppress: ["evt_1"] });
		expect(persist).toHaveBeenCalledTimes(1);
		const written = rows as Array<{
			eventId: string;
			worthTellingP: number;
			worthAlert: number;
			wouldSuppress: boolean;
			inCohort: boolean;
			digestRunId: string;
		}>;
		expect(written.map((row) => row.eventId).sort()).toEqual([
			"evt_1",
			"evt_2",
		]);
		expect(written[0]).toMatchObject({
			digestRunId: "run_1",
			worthTellingP: 0.2,
			worthAlert: 2,
		});
		expect(
			written.find((row) => row.eventId === "evt_1")?.wouldSuppress,
		).toBe(true);
		expect(
			written.find((row) => row.eventId === "evt_2")?.wouldSuppress,
		).toBe(false);
		const summary = JSON.parse(info.mock.calls.at(-1)?.[0] as string);
		expect(summary).toMatchObject({
			event: "jev_digest_scores",
			site: DIGEST_ALERTS_SITE,
			digest_run_id: "run_1",
			items_scored: 2,
			would_suppress: ["evt_1"],
		});
		info.mockRestore();
	});

	it("swallows AI failures and still returns null with a log line", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const persist = vi.fn();
		const failing: DigestAlertsAi = {
			async run() {
				throw new Error("binding exploded");
			},
		};
		const result = await shadowScoreDigestItems(
			{ ...enabledEnv, AI: failing } as AppEnv,
			{ ...baseInput, items: [item("evt_1")] },
			persist,
		);
		expect(result).toBeNull();
		expect(persist).not.toHaveBeenCalled();
		const summary = JSON.parse(info.mock.calls.at(-1)?.[0] as string);
		expect(summary.event).toBe("digest_alerts_shadow_failed");
		expect(digestAlertsBindingCircuitIsOpen()).toBe(false);
		info.mockRestore();
	});

	it("opens the isolate circuit on an unpaid binding and skips later runs", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const unpaid: DigestAlertsAi = {
			async run() {
				throw new Error("Insufficient balance; add money to your gateway");
			},
		};
		const env = { ...enabledEnv, AI: unpaid } as AppEnv;
		await shadowScoreDigestItems(env, { ...baseInput, items: [item("evt_1")] });
		expect(digestAlertsBindingCircuitIsOpen()).toBe(true);
		const run = vi.fn();
		const second = await shadowScoreDigestItems(
			{ ...enabledEnv, AI: { run } } as unknown as AppEnv,
			{ ...baseInput, items: [item("evt_2")] },
		);
		expect(second).toBeNull();
		expect(run).not.toHaveBeenCalled();
		info.mockRestore();
	});
});

describe("digestAlertsStateSha256", () => {
	it("is stable across key order", async () => {
		const a = await digestAlertsStateSha256({ b: 1, a: { d: 2, c: 3 } });
		const b = await digestAlertsStateSha256({ a: { c: 3, d: 2 }, b: 1 });
		expect(a).toBe(b);
	});
});
