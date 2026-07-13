import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addDigestItem,
  clearDigestItems,
  createDigestRun,
  getDigest,
  getDigestByPeriod,
  getLatestDigestRunSummaryForWatchlist,
  listRetryableDigestRuns,
  updateDigestRunSummary,
} from "~/lib/data/digests.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const mockState = vi.hoisted(() => ({
  data: {
    addDigestItem: vi.fn(),
    clearDigestItems: vi.fn(),
    createDigestRun: vi.fn(),
    getDigest: vi.fn(),
    getDigestByPeriod: vi.fn(),
    getSuccessfulRunStatsForUserBetween: vi.fn(),
    listAdsByIds: vi.fn(),
    listRetryableDigestRuns: vi.fn(),
    listWatchEventsBetween: vi.fn(),
    listWatchlists: vi.fn(),
    updateDigestRunSummary: vi.fn(),
  },
  deliverWeeklyDigest: vi.fn(),
}));

vi.mock("~/lib/auth.server", () => ({}));
vi.mock("~/lib/data.server", () => mockState.data);
vi.mock("~/lib/delivery.server", () => ({
  deliverWeeklyDigest: mockState.deliverWeeklyDigest,
}));
vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn().mockResolvedValue("starter"),
  PLAN_LIMITS: {
    free: { digests: false, digestCadence: "none" },
    scout: { digests: true, digestCadence: "weekly" },
    starter: { digests: true, digestCadence: "weekly" },
    agency: { digests: true, digestCadence: "daily_and_weekly" },
  },
}));

const OVERLAP_PARAGRAPHS = [
  "First generation says boAt refreshed its landing page offer while the rest of the monitored account stayed stable throughout this weekly period.",
  "Second generation says boAt changed its promotional offer while no other evidence-backed movement appeared in this weekly monitoring period.",
];

function setupHarness() {
  const harness = createSqliteD1();
  applyMigration(harness.sqlite, "migrations/0000_auth.sql");
  applyMigration(harness.sqlite, "migrations/0001_app.sql");
  applyMigration(harness.sqlite, "migrations/0002_monitoring_trust.sql");
  harness.sqlite.exec(`
    CREATE TABLE delivery_attempt (
      id TEXT PRIMARY KEY NOT NULL,
      digest_run_id TEXT,
      status TEXT NOT NULL,
      webhook_status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  harness.sqlite
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
    )
    .run("user-1", "Owner", "owner@example.com", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  harness.sqlite
    .prepare(
      `INSERT INTO watchlist (
        id, user_id, name, target_type, target_id, target_fingerprint,
        target_label, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      "watch-1",
      "user-1",
      "boAt watch",
      "target-1",
      "fingerprint-1",
      "boAt",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
  return harness;
}

function monitoringDb(harness: ReturnType<typeof createSqliteD1>) {
  return {
    ...harness.db,
    prepare(sql: string) {
      const statement = harness.db.prepare(sql);
      return {
        ...statement,
        all<T>() {
          return statement.bind().all<T>();
        },
      };
    },
  };
}

function serializedCreateDigestRun() {
  let queue = Promise.resolve();
  return vi.fn(async (...args: Parameters<typeof createDigestRun>) => {
    const previous = queue;
    let release = () => {};
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await createDigestRun(...args);
    } finally {
      release();
    }
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function installDataMocks(
  events: (...args: never[]) => unknown,
) {
  const data = mockState.data;
  data.addDigestItem.mockReset().mockImplementation(addDigestItem);
  data.clearDigestItems.mockReset().mockImplementation(clearDigestItems);
  data.createDigestRun.mockReset().mockImplementation(serializedCreateDigestRun());
  data.getDigest.mockReset().mockImplementation(getDigest);
  data.getDigestByPeriod.mockReset().mockImplementation(getDigestByPeriod);
  data.getSuccessfulRunStatsForUserBetween.mockReset().mockResolvedValue({
      runs: 0,
      watchlistsChecked: 0,
      adsSeen: 0,
    });
  data.listAdsByIds.mockReset().mockResolvedValue([]);
  data.listRetryableDigestRuns.mockReset().mockImplementation(listRetryableDigestRuns);
  data.listWatchEventsBetween.mockReset().mockImplementation(events);
  data.listWatchlists.mockReset().mockResolvedValue([{ id: "watch-1", name: "boAt watch" }]);
  data.updateDigestRunSummary.mockReset().mockImplementation(updateDigestRunSummary);

  return {
    addDigestItem: data.addDigestItem,
    clearDigestItems: data.clearDigestItems,
    createDigestRun: data.createDigestRun,
    updateDigestRunSummary: data.updateDigestRunSummary,
  };
}

beforeEach(() => {
  vi.resetModules();
  mockState.deliverWeeklyDigest.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("weekly digest overlap", () => {
  it("keeps generation, persisted state, email, retry, and report on one winning paragraph", async () => {
    const harness = setupHarness();

    let aiCalls = 0;
    let releaseBoth: (() => void) | null = null;
    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const aiRun = vi.fn(async () => {
      const callIndex = aiCalls;
      aiCalls += 1;
      if (aiCalls === 2) releaseBoth?.();
      await bothStarted;
      return OVERLAP_PARAGRAPHS[callIndex];
    });
    mockState.deliverWeeklyDigest.mockImplementation(async () => {
      return { attempts: 1, channels: ["email"] };
    });
    const mutations = installDataMocks(vi.fn(async () => [
      {
        id: "event-1",
        eventType: "landing_page_offer_changed",
        status: "confirmed",
        importanceScore: 79,
        proofCaptureId: "proof-1",
        title: "Landing page offer changed",
        summary: "Offer changed on the landing page.",
      },
    ]));
    const env = { AI: { run: aiRun }, DB: monitoringDb(harness) } as never;
    const options = { periodEnd: "2026-07-13T05:00:00.000Z" };

    try {
      await import("~/lib/delivery.server");
      const { runWeeklyDigests } = await import("~/lib/monitoring.server");
      await Promise.all([
        runWeeklyDigests(env, options),
        runWeeklyDigests(env, options),
      ]);

      const storedRow = harness.sqlite
        .prepare("SELECT id, summary_json FROM digest_run")
        .get() as { id: string; summary_json: string };
      const storedSummary = JSON.parse(storedRow.summary_json) as { strategyParagraph: string };
      const storedParagraph = storedSummary.strategyParagraph;
      const initialParagraphs = mockState.deliverWeeklyDigest.mock.calls
        .map((call) => call[1].strategyParagraph);

      expect(OVERLAP_PARAGRAPHS).toContain(storedParagraph);
      expect(initialParagraphs).toEqual([storedParagraph]);
      expect(
        harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_run").get(),
      ).toMatchObject({ count: 1 });
      expect(
        harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_item").get(),
      ).toMatchObject({ count: 1 });
      expect(mutations.addDigestItem).not.toHaveBeenCalled();
      expect(mutations.clearDigestItems).not.toHaveBeenCalled();
      expect(mutations.updateDigestRunSummary).not.toHaveBeenCalled();

      harness.sqlite.prepare("UPDATE watchlist SET is_active = 0 WHERE id = ?").run("watch-1");
      await runWeeklyDigests(env, options);

      expect(mockState.deliverWeeklyDigest).toHaveBeenCalledTimes(2);
      expect(mockState.deliverWeeklyDigest.mock.calls[1]?.[1].strategyParagraph).toBe(
        storedParagraph,
      );
      await expect(
        getLatestDigestRunSummaryForWatchlist(env, "user-1", "watch-1"),
      ).resolves.toMatchObject({ paragraph: storedParagraph });
    } finally {
      harness.close();
    }
  });

  it("delivers the persisted winner when another execution starts after the row exists", async () => {
    const harness = setupHarness();
    const events = vi.fn(async () => [
      {
        id: "event-winner",
        eventType: "landing_page_offer_changed",
        status: "confirmed",
        importanceScore: 79,
        proofCaptureId: "proof-winner",
        title: "Winner offer changed",
        summary: "The persisted winner changed its offer.",
      },
    ]);
    const mutations = installDataMocks(events);
    const aiRun = vi.fn().mockResolvedValue(OVERLAP_PARAGRAPHS[0]);

    const firstDeliveryStarted = deferred();
    const firstDeliveryGate = deferred();
    let deliveryCalls = 0;
    mockState.deliverWeeklyDigest.mockImplementation(async () => {
      deliveryCalls += 1;
      if (deliveryCalls === 1) {
        firstDeliveryStarted.resolve();
        await firstDeliveryGate.promise;
      }
      return { attempts: 1, channels: ["email"] };
    });

    const env = { AI: { run: aiRun }, DB: monitoringDb(harness) } as never;
    const options = { periodEnd: "2026-07-13T05:00:00.000Z" };
    let winner: Promise<number> | null = null;

    try {
      const { runWeeklyDigests } = await import("~/lib/monitoring.server");
      winner = runWeeklyDigests(env, options);
      await firstDeliveryStarted.promise;

      expect(
        harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_item").get(),
      ).toMatchObject({ count: 1 });

      // The delayed execution recomputes a conflicting local candidate, but
      // the already-claimed run must remain its only delivery source.
      events.mockResolvedValue([
        {
          id: "event-loser",
          eventType: "landing_page_cta_changed",
          status: "confirmed",
          importanceScore: 95,
          proofCaptureId: "proof-loser",
          title: "Losing CTA candidate",
          summary: "This delayed candidate must not be written or delivered.",
        },
      ]);
      await runWeeklyDigests(env, options);
      firstDeliveryGate.resolve();
      await winner;

      expect(aiRun).toHaveBeenCalledTimes(1);
      expect(mutations.createDigestRun).toHaveBeenCalledTimes(1);
      expect(mockState.deliverWeeklyDigest).toHaveBeenCalledTimes(2);
      expect(mockState.deliverWeeklyDigest.mock.calls[1]?.[1]).toMatchObject({
        strategyParagraph: OVERLAP_PARAGRAPHS[0],
        items: [
          expect.objectContaining({
            title: "Winner offer changed",
            summary: "The persisted winner changed its offer.",
          }),
        ],
      });
      expect(
        mockState.deliverWeeklyDigest.mock.calls[1]?.[1].items,
      ).not.toEqual([
        expect.objectContaining({ title: "Losing CTA candidate" }),
      ]);
      expect(
        harness.sqlite.prepare("SELECT title, summary FROM digest_item").get(),
      ).toMatchObject({
        title: "Winner offer changed",
        summary: "The persisted winner changed its offer.",
      });
      expect(mutations.addDigestItem).not.toHaveBeenCalled();
      expect(mutations.clearDigestItems).not.toHaveBeenCalled();
      expect(mutations.updateDigestRunSummary).not.toHaveBeenCalled();
    } finally {
      firstDeliveryGate.resolve();
      await winner?.catch(() => undefined);
      harness.close();
    }
  });
});
