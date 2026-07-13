import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wiring tests for the AI weekly strategy paragraph in runDigests:
 * generation gating (plan/cadence), persistence BEFORE delivery, and the
 * never-regenerate rule for existing runs and the retry sweep.
 */

const GOOD_PARAGRAPH =
  "boAt refreshed the offer on its landing page, which was the only logged movement this week. " +
  "Pricing and offer positioning is where the competitive pressure is concentrated right now.";

const STORED_PARAGRAPH =
  "Stored paragraph from the original generation: boAt moved its landing page offer and nothing else changed across the watched competitors this week.";

function weeklyEvent() {
  return {
    id: "event-1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 79,
    proofCaptureId: "proof-1",
    title: "Landing page offer changed",
    summary: "Offer changed on the landing page.",
    confirmedAt: "2026-07-12T05:00:00.000Z",
    createdAt: "2026-07-12T05:00:00.000Z",
    metadata: {},
  };
}

function provisionalEvent() {
  return {
    id: "event-provisional",
    eventType: "landing_page_cta_changed",
    status: "proof_pending",
    importanceScore: 95,
    proofCaptureId: null,
    title: "Possible CTA change",
    summary: "A high-priority CTA change is still waiting on proof.",
    confirmedAt: null,
    createdAt: "2026-07-12T06:00:00.000Z",
    metadata: {},
  };
}

function dataServerMock(overrides: Record<string, unknown> = {}) {
  return {
    addDigestItem: vi.fn(),
    clearDigestItems: vi.fn(),
    createAdObservation: vi.fn(),
    createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
    createEventCandidate: vi.fn(),
    createLandingPageSnapshot: vi.fn(),
    createProofCapture: vi.fn(),
    createWatchEvent: vi.fn(),
    createWatchlistRun: vi.fn(),
    countProofCapturesForWatchlistSince: vi.fn(),
    countProofCapturesForWorkspaceSince: vi.fn(),
    finishWatchlistRun: vi.fn(),
    getDigestByPeriod: vi.fn().mockResolvedValue(null),
    getDigest: vi.fn().mockResolvedValue(null),
    getSuccessfulRunStatsForUserBetween: vi.fn().mockResolvedValue({
      runs: 0,
      watchlistsChecked: 0,
      adsSeen: 0,
    }),
    listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
    getUserDeliveryProfile: vi.fn(),
    hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
    getRecentSuccessfulRuns: vi.fn(),
    getSavedQuery: vi.fn(),
    getWatchlist: vi.fn(),
    hydrateAdsWithPersistedCreatives: vi.fn(),
    listActiveWatchlists: vi.fn(),
    listProofCapturesForTarget: vi.fn(),
    listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
    listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
    listRecentWorkspaceProofCaptures: vi.fn(),
    listSuccessfulProofCapturesForAd: vi.fn(),
    listObservationsForRun: vi.fn(),
    listWatchEvents: vi.fn(),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listWatchEventsBetween: vi.fn().mockResolvedValue([weeklyEvent()]),
    listWatchlists: vi.fn().mockResolvedValue([{ id: "watch-1", name: "boAt watch" }]),
    logMetaIntegrationStatus: vi.fn(),
    repairIncompleteDigestRun: vi.fn().mockResolvedValue(true),
    touchWatchlistScanned: vi.fn(),
    updateDigestRunSummary: vi.fn(),
    upsertProofTarget: vi.fn(),
    upsertAd: vi.fn(),
    upsertDigestDelivery: vi.fn(),
    ...overrides,
  };
}

function planServerMock(plan: string) {
  return {
    getUserPlan: vi.fn().mockResolvedValue(plan),
    PLAN_LIMITS: {
      free: { digests: false, digestCadence: "none" },
      scout: { digests: true, digestCadence: "weekly" },
      starter: { digests: true, digestCadence: "weekly" },
      agency: { digests: true, digestCadence: "daily_and_weekly" },
    },
  };
}

function envWith(aiRun: ReturnType<typeof vi.fn> | null, users: unknown[] = [
  { id: "user-1", email: "owner@example.com", name: "Owner" },
]) {
  return {
    ...(aiRun ? { AI: { run: aiRun } } : {}),
    DB: {
      prepare() {
        return {
          async all<T>() {
            return { results: users as T[] };
          },
          bind() {
            return {
              async all<T>() {
                return { results: users as T[] };
              },
            };
          },
        };
      },
    },
  } as never;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("weekly digest strategy paragraph flow", () => {
  it("generates, persists before delivery, and threads the paragraph for starter weekly digests", async () => {
    const data = dataServerMock();
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    const result = await runWeeklyDigests(envWith(aiRun));

    expect(result).toBe(1);
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(data.createDigestRun).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        totalEvents: 1,
        strategyParagraph: GOOD_PARAGRAPH,
        strategyModel: "@cf/meta/llama-3.2-3b-instruct",
        strategyGeneratedAt: expect.any(String),
        strategyWatchlistIds: ["watch-1"],
      }),
      expect.objectContaining({
        returnClaim: true,
        items: [
          expect.objectContaining({
            watchlistId: "watch-1",
            eventType: "landing_page_offer_changed",
          }),
        ],
      }),
    );
    expect(data.updateDigestRunSummary).not.toHaveBeenCalled();
    expect(data.createDigestRun.mock.invocationCallOrder[0]).toBeLessThan(
      deliverWeeklyDigest.mock.invocationCallOrder[0]!,
    );
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        digestRunId: "digest-1",
        strategyParagraph: GOOD_PARAGRAPH,
      }),
    );
  });

  it("keeps provisional items in the digest but excludes them from mixed AI strategy input", async () => {
    const data = dataServerMock({
      listWatchEventsBetween: vi.fn().mockResolvedValue([weeklyEvent(), provisionalEvent()]),
    });
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    await expect(runWeeklyDigests(envWith(aiRun))).resolves.toBe(1);

    const request = aiRun.mock.calls[0]?.[1] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = request.messages.find((message) => message.role === "user")?.content ?? "";
    expect(userPrompt).toContain("Landing page offer changed");
    expect(userPrompt).not.toContain("Possible CTA change");

    expect(data.createDigestRun).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        totalEvents: 2,
        strategyParagraph: GOOD_PARAGRAPH,
        strategyWatchlistIds: ["watch-1"],
      }),
      expect.objectContaining({
        items: [
          expect.objectContaining({
            title: "Landing page offer changed",
            metadata: expect.objectContaining({ eventStatus: "confirmed" }),
          }),
          expect.objectContaining({
            title: "Possible CTA change",
            metadata: expect.objectContaining({ eventStatus: "proof_pending" }),
          }),
        ],
      }),
    );
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        strategyParagraph: GOOD_PARAGRAPH,
        items: [
          expect.objectContaining({ title: "Landing page offer changed" }),
          expect.objectContaining({ title: "Possible CTA change" }),
        ],
      }),
    );
  });

  it("persists and delivers provisional-only digest items without an AI strategy summary", async () => {
    const data = dataServerMock({
      listWatchEventsBetween: vi.fn().mockResolvedValue([provisionalEvent()]),
    });
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    await expect(runWeeklyDigests(envWith(aiRun))).resolves.toBe(1);

    expect(aiRun).not.toHaveBeenCalled();
    expect(data.createDigestRun).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.any(String),
      expect.any(String),
      expect.not.objectContaining({ strategyParagraph: expect.anything() }),
      expect.objectContaining({
        items: [
          expect.objectContaining({
            title: "Possible CTA change",
            metadata: expect.objectContaining({ eventStatus: "proof_pending" }),
          }),
        ],
      }),
    );
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        strategyParagraph: null,
        items: [expect.objectContaining({ title: "Possible CTA change" })],
      }),
    );
  });

  it("skips generation for scout weekly digests without changing delivery", async () => {
    const data = dataServerMock();
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("scout"));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    const result = await runWeeklyDigests(envWith(aiRun));

    expect(result).toBe(1);
    expect(aiRun).not.toHaveBeenCalled();
    expect(data.updateDigestRunSummary).not.toHaveBeenCalled();
    expect(data.createDigestRun).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.any(String),
      expect.any(String),
      expect.not.objectContaining({ strategyParagraph: expect.anything() }),
      expect.objectContaining({
        returnClaim: true,
        items: [expect.objectContaining({ watchlistId: "watch-1" })],
      }),
    );
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ strategyParagraph: null }),
    );
  });

  it("skips free-plan users entirely — no digest, no AI call", async () => {
    const data = dataServerMock();
    const deliverWeeklyDigest = vi.fn();
    const aiRun = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("free"));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    const result = await runWeeklyDigests(envWith(aiRun));

    expect(result).toBe(0);
    expect(aiRun).not.toHaveBeenCalled();
    expect(deliverWeeklyDigest).not.toHaveBeenCalled();
    expect(data.createDigestRun).not.toHaveBeenCalled();
  });

  it("skips generation for agency daily digests — weekly only", async () => {
    const data = dataServerMock();
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("agency"));

    const { runDailyDigests } = await import("~/lib/monitoring.server");
    const result = await runDailyDigests(envWith(aiRun));

    expect(result).toBe(1);
    expect(aiRun).not.toHaveBeenCalled();
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ strategyParagraph: null }),
    );
  });

  it("never blocks delivery when generation fails — the digest ships without a paragraph", async () => {
    const data = dataServerMock();
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    const aiRun = vi.fn().mockRejectedValue(new Error("Workers AI capacity"));

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    const result = await runWeeklyDigests(envWith(aiRun));

    expect(result).toBe(1);
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(data.updateDigestRunSummary).not.toHaveBeenCalled();
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ strategyParagraph: null }),
    );
  });

  it("reuses the stored paragraph for an existing run instead of regenerating", async () => {
    const existingDigest = {
      id: "digest-existing",
      userId: "user-1",
      periodStart: "2026-04-13T05:00:00.000Z",
      periodEnd: "2026-04-20T05:00:00.000Z",
      summary: {
        totalEvents: 1,
        watchlists: 1,
        strategyParagraph: STORED_PARAGRAPH,
        strategyGeneratedAt: "2026-04-20T05:01:00.000Z",
      },
      createdAt: "2026-04-20T05:01:00.000Z",
      items: [
        {
          id: "digest-item-1",
          digestRunId: "digest-existing",
          watchlistId: "watch-1",
          watchlistName: "boAt watch",
          eventType: "landing_page_offer_changed",
          title: "Stored offer change",
          summary: "The original digest item.",
          metadata: {},
          createdAt: "2026-04-20T05:01:00.000Z",
        },
      ],
      delivery: {
        id: "delivery-1",
        digestRunId: "digest-existing",
        provider: "cloudflare_email",
        status: "failed",
        recipientEmail: "owner@example.com",
        externalMessageId: null,
        errorMessage: "timeout",
        deliveredAt: null,
      },
    };
    const data = dataServerMock({
      getDigestByPeriod: vi.fn().mockResolvedValue(existingDigest),
    });
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    await runWeeklyDigests(envWith(aiRun));

    expect(aiRun).not.toHaveBeenCalled();
    expect(data.createDigestRun).not.toHaveBeenCalled();
    expect(data.updateDigestRunSummary).not.toHaveBeenCalled();
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        digestRunId: "digest-existing",
        strategyParagraph: STORED_PARAGRAPH,
      }),
    );
  });

  it("atomically repairs a legacy partial run before delivering its full stored strategy", async () => {
    const secondEvent = {
      ...weeklyEvent(),
      id: "event-2",
      eventType: "landing_page_cta_changed",
      title: "Landing page CTA changed",
      summary: "CTA changed on the landing page.",
    };
    const partialDigest = {
      id: "digest-partial",
      userId: "user-1",
      periodStart: "2026-07-06T05:00:00.000Z",
      periodEnd: "2026-07-13T05:00:00.000Z",
      summary: {
        totalEvents: 2,
        watchlists: 1,
        strategyParagraph: STORED_PARAGRAPH,
        strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
      },
      createdAt: "2026-07-13T05:01:00.000Z",
      items: [
        {
          id: "digest-item-1",
          digestRunId: "digest-partial",
          watchlistId: "watch-1",
          watchlistName: "boAt watch",
          eventType: "landing_page_offer_changed",
          title: "Only the first item survived",
          summary: "The legacy worker stopped before item two.",
          metadata: {},
          createdAt: "2026-07-13T05:01:00.000Z",
        },
      ],
      delivery: null,
    };
    const repairedDigest = {
      ...partialDigest,
      items: [
        {
          ...partialDigest.items[0],
          title: "Landing page offer changed",
          summary: "Offer changed on the landing page.",
        },
        {
          ...partialDigest.items[0],
          id: "digest-item-2",
          eventType: "landing_page_cta_changed",
          title: "Landing page CTA changed",
          summary: "CTA changed on the landing page.",
        },
      ],
    };
    const data = dataServerMock({
      getDigestByPeriod: vi.fn().mockResolvedValue(partialDigest),
      getDigest: vi.fn().mockResolvedValue(repairedDigest),
      listWatchEventsBetween: vi.fn().mockResolvedValue([weeklyEvent(), secondEvent]),
    });
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    await expect(runWeeklyDigests(envWith(aiRun))).resolves.toBe(1);

    expect(aiRun).not.toHaveBeenCalled();
    expect(data.repairIncompleteDigestRun).toHaveBeenCalledWith(
      expect.anything(),
      "digest-partial",
      expect.objectContaining({
        summary: partialDigest.summary,
        items: expect.arrayContaining([
          expect.objectContaining({ title: "Landing page offer changed" }),
          expect.objectContaining({ title: "Landing page CTA changed" }),
        ]),
      }),
    );
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        digestRunId: "digest-partial",
        heartbeat: null,
        strategyParagraph: STORED_PARAGRAPH,
        items: [
          expect.objectContaining({ title: "Landing page offer changed" }),
          expect.objectContaining({ title: "Landing page CTA changed" }),
        ],
      }),
    );
  });

  it("fails closed when an incomplete legacy run cannot be reconstructed exactly", async () => {
    const data = dataServerMock({
      getDigestByPeriod: vi.fn().mockResolvedValue({
        id: "digest-unreconstructable",
        userId: "user-1",
        periodStart: "2026-07-06T05:00:00.000Z",
        periodEnd: "2026-07-13T05:00:00.000Z",
        summary: { totalEvents: 2, watchlists: 1 },
        createdAt: "2026-07-13T05:01:00.000Z",
        items: [],
        delivery: null,
      }),
    });
    const deliverWeeklyDigest = vi.fn();
    const aiRun = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    await expect(runWeeklyDigests(envWith(aiRun))).resolves.toBe(0);

    expect(data.repairIncompleteDigestRun).not.toHaveBeenCalled();
    expect(deliverWeeklyDigest).not.toHaveBeenCalled();
  });

  it("replays the persisted paragraph in the retry sweep without a second AI call", async () => {
    const data = dataServerMock({
      listRetryableDigestRuns: vi.fn().mockResolvedValue([
        {
          id: "digest-retry",
          userId: "user-1",
          userEmail: "owner@example.com",
          userName: "Owner",
          periodStart: "2026-04-13T05:00:00.000Z",
          periodEnd: "2026-04-20T05:00:00.000Z",
        },
      ]),
      getDigest: vi.fn().mockResolvedValue({
        id: "digest-retry",
        userId: "user-1",
        periodStart: "2026-04-13T05:00:00.000Z",
        periodEnd: "2026-04-20T05:00:00.000Z",
        summary: {
          totalEvents: 1,
          watchlists: 1,
          strategyParagraph: STORED_PARAGRAPH,
          strategyGeneratedAt: "2026-04-20T05:01:00.000Z",
        },
        createdAt: "2026-04-20T05:01:00.000Z",
        items: [
          {
            id: "item-1",
            digestRunId: "digest-retry",
            watchlistId: "watch-1",
            watchlistName: "boAt watch",
            eventType: "landing_page_offer_changed",
            title: "Landing page offer changed",
            summary: "Offer changed on the landing page.",
            metadata: { priorityScore: 79, sourceStatus: "proof_backed" },
            createdAt: "2026-04-19T00:00:00.000Z",
          },
        ],
        delivery: null,
      }),
    });
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    // No users with active watchlists this tick — only the retry sweep runs.
    const result = await runWeeklyDigests(envWith(aiRun, []));

    expect(result).toBe(1);
    expect(aiRun).not.toHaveBeenCalled();
    expect(deliverWeeklyDigest).toHaveBeenCalledTimes(1);
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        digestRunId: "digest-retry",
        strategyParagraph: STORED_PARAGRAPH,
      }),
    );
  });

});
