import { describe, expect, it } from "vitest";

import {
  createEventCandidate,
  createWatchEvent,
} from "~/lib/data/watch-events.server";

function emptyD1() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all<T>() {
              return { results: [] as T[] };
            },
            async run() {
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

describe("watch event replay identity", () => {
  it("keeps distinct ads separate while replaying the same run event idempotently", async () => {
    const env = { DB: emptyD1() } as never;
    const base = {
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_url_changed" as const,
      baselineFromRunId: null,
      title: "Landing page changed",
      summary: "A landing page changed.",
      metadata: {},
    };

    const firstId = await createWatchEvent(env, { ...base, adId: "ad-1" });
    const replayId = await createWatchEvent(env, { ...base, adId: "ad-1" });
    const secondId = await createWatchEvent(env, { ...base, adId: "ad-2" });

    expect(replayId).toBe(firstId);
    expect(secondId).not.toBe(firstId);
  });

  it("keeps distinct ads separate while replaying the same candidate idempotently", async () => {
    const env = { DB: emptyD1() } as never;
    const base = {
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_url_changed" as const,
      status: "confirmed" as const,
      importanceScore: 75,
      proofTargetId: null,
      title: "Landing page changed",
      summary: "A landing page changed.",
      metadata: {},
      proofRequired: false,
    };

    const firstId = await createEventCandidate(env, { ...base, adId: "ad-1" });
    const replayId = await createEventCandidate(env, { ...base, adId: "ad-1" });
    const secondId = await createEventCandidate(env, { ...base, adId: "ad-2" });

    expect(replayId).toBe(firstId);
    expect(secondId).not.toBe(firstId);
  });
});
