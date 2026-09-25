import { describe, expect, it } from "vitest";

import type { OnboardingTimes } from "../../app/lib/data/onboarding_run.server";
import { onboardingTimingLines } from "../../app/lib/onboarding/timings";

function times(overrides: Partial<OnboardingTimes>): OnboardingTimes {
  return {
    startedAt: "2026-09-25T10:00:00.000Z",
    cardReadyAt: "2026-09-25T10:00:20.000Z",
    competitorsReadyAt: "2026-09-25T10:00:50.000Z",
    firstSignalAt: "2026-09-25T10:01:20.000Z",
    ...overrides,
  };
}

describe("onboardingTimingLines", () => {
  it("gives three plain lines with the right seconds when every stage is within budget", () => {
    expect(onboardingTimingLines(times({}))).toEqual([
      "Input to card: 20s",
      "Card to competitors: 30s",
      "Competitors to first signal: 30s",
    ]);
  });

  it("marks the input to card line when the card is past the 30s budget", () => {
    expect(
      onboardingTimingLines(times({ cardReadyAt: "2026-09-25T10:00:31.000Z" })),
    ).toContain("Input to card: 31s (over the 30s budget)");
  });

  it("marks the card to competitors line when competitors land 61s after the start", () => {
    const lines = onboardingTimingLines(
      times({
        cardReadyAt: "2026-09-25T10:00:20.000Z",
        competitorsReadyAt: "2026-09-25T10:01:01.000Z",
      }),
    );
    expect(lines[1]).toBe("Card to competitors: 41s (over the 60s budget)");
  });

  it("reads not yet when the first signal has not arrived", () => {
    expect(onboardingTimingLines(times({ firstSignalAt: null }))).toEqual([
      "Input to card: 20s",
      "Card to competitors: 30s",
      "Competitors to first signal: not yet",
    ]);
  });

  it("reads not yet for every stage that has not been reached", () => {
    expect(
      onboardingTimingLines(
        times({ cardReadyAt: null, competitorsReadyAt: null, firstSignalAt: null }),
      ),
    ).toEqual([
      "Input to card: not yet",
      "Card to competitors: not yet",
      "Competitors to first signal: not yet",
    ]);
  });
});
