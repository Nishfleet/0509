import { afterEach, describe, expect, it, vi } from "vitest";

import { buildWeeklyStrategyParagraph } from "~/lib/digest-strategy.server";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("digest strategy call budget", () => {
	it("uses the smaller caller budget instead of the default AI timeout", async () => {
		vi.useFakeTimers();
		const run = vi.fn(() => new Promise(() => undefined));
		let settled = false;
		const result = buildWeeklyStrategyParagraph(
			{ AI: { run } } as never,
			{
				items: [
					{
						watchlistId: "watch-1",
						watchlistName: "Nykaa watch",
						title: "Landing page offer changed",
						summary: "Offer changed on the landing page.",
						metadata: { priorityScore: 80, sourceStatus: "proof_backed" },
					},
				],
				periodStart: "2026-07-06T05:00:00.000Z",
				periodEnd: "2026-07-13T05:00:00.000Z",
				timeoutMs: 25,
			},
		).then((value) => {
			settled = true;
			return value;
		});

		await vi.advanceTimersByTimeAsync(24);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toBe(true);
		await expect(result).resolves.toBeNull();
		expect(run).toHaveBeenCalledTimes(1);
	});
});
