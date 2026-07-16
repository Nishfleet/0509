import { afterEach, describe, expect, it, vi } from "vitest";

import { buildWeeklyStrategyParagraph } from "~/lib/digest-strategy.server";
import { readDigestSourceEventId } from "~/lib/digest-provenance";

afterEach(() => {
  vi.useRealTimers();
});

describe("digest provenance and bounded strategy generation", () => {
  it("accepts only an explicit original watch_event ID", () => {
    expect(readDigestSourceEventId({ eventId: " event-1 " })).toBe("event-1");
    expect(readDigestSourceEventId({ eventId: "" })).toBeNull();
    expect(readDigestSourceEventId({})).toBeNull();
  });

  it("settles a never-resolving AI call as unavailable after 30 seconds", async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => new Promise<never>(() => {}));
    const pending = buildWeeklyStrategyParagraph(
      {
        AI: { run },
      } as never,
      {
        items: [{
          watchlistId: "watch-1",
          watchlistName: "Watch",
          title: "Offer changed",
          summary: "The offer changed.",
          metadata: { eventId: "event-1", proofCaptureId: "proof-1", eventStatus: "confirmed", priorityScore: 80 },
        }],
        periodStart: "2026-07-06T05:00:00.000Z",
        periodEnd: "2026-07-13T05:00:00.000Z",
      },
    );
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(pending).resolves.toBeNull();
  });
});
