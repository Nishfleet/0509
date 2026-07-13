import { describe, expect, it } from "vitest";

import {
  addDigestItem,
  createDigestRun,
  getDigest,
  getLatestDigestRunSummaryForWatchlist,
  listDigests,
  repairIncompleteDigestRun,
  updateDigestRunSummary,
  upsertDigestDelivery,
} from "~/lib/data.server";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const PARAGRAPH =
  "Nykaa refreshed its landing page discount while boAt introduced new festival-focused ads across the watched accounts this week.";

function setup() {
  const harness = createSqliteD1();
  applyMigration(harness.sqlite, "migrations/0000_auth.sql");
  applyMigration(harness.sqlite, "migrations/0001_app.sql");
  applyMigration(harness.sqlite, "migrations/0002_monitoring_trust.sql");
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
  // This focused fixture predates the delivery migrations, but legacy digest
  // repair must still prove no provider-known attempt is in flight or sent.
  harness.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS delivery_attempt (
      digest_run_id TEXT,
      status TEXT NOT NULL
    );
  `);
  return harness;
}

describe("digest_run summary persistence", () => {
  it("reports which overlapping create actually claimed the period", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      const first = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        { strategyParagraph: `${PARAGRAPH} first` },
        {
          returnClaim: true,
          items: [{
            watchlistId: "watch-1",
            watchlistName: "First winner",
            eventType: "landing_page_offer_changed",
            title: "First item",
            summary: "The winner's item.",
          }],
        },
      );
      const second = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        { strategyParagraph: `${PARAGRAPH} second` },
        {
          returnClaim: true,
          items: [{
            watchlistId: "watch-1",
            watchlistName: "Losing candidate",
            eventType: "landing_page_cta_changed",
            title: "Losing item",
            summary: "This item must never be persisted.",
          }],
        },
      );

      expect(first).toMatchObject({ created: true, digestRunId: expect.any(String) });
      expect(second).toEqual({ created: false, digestRunId: first.digestRunId });
      const stored = await getDigest(env, first.digestRunId);
      expect(stored?.summary).toMatchObject({
        strategyParagraph: `${PARAGRAPH} first`,
      });
      expect(stored?.items).toEqual([
        expect.objectContaining({ title: "First item", summary: "The winner's item." }),
      ]);
    } finally {
      harness.close();
    }
  });

  it("atomically repairs a legacy partial item set while preserving its summary", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      const summary = {
        totalEvents: 2,
        watchlists: 1,
        strategyParagraph: PARAGRAPH,
        strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
        strategyWatchlistIds: ["watch-1"],
      };
      const digestRunId = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        summary,
      );
      await addDigestItem(env, digestRunId, {
        watchlistId: "watch-1",
        watchlistName: "Partial legacy item",
        eventType: "landing_page_offer_changed",
        title: "Only the first item survived",
        summary: "The worker stopped before the second item was written.",
      });

      const items = [
        {
          watchlistId: "watch-1",
          watchlistName: "boAt watch",
          eventType: "landing_page_offer_changed" as const,
          title: "Offer changed",
          summary: "The offer changed.",
        },
        {
          watchlistId: "watch-1",
          watchlistName: "boAt watch",
          eventType: "landing_page_cta_changed" as const,
          title: "CTA changed",
          summary: "The CTA changed.",
        },
      ];

      await expect(
        repairIncompleteDigestRun(env, digestRunId, { summary, items }),
      ).resolves.toBe(true);
      await expect(
        repairIncompleteDigestRun(env, digestRunId, {
          summary,
          items: items.map((item) => ({ ...item, title: `Losing ${item.title}` })),
        }),
      ).resolves.toBe(false);
      const repaired = await getDigest(env, digestRunId);
      expect(repaired?.summary).toEqual(summary);
      expect(repaired?.items.map((item) => item.title)).toEqual([
        "Offer changed",
        "CTA changed",
      ]);
      expect(JSON.stringify(repaired?.summary)).not.toContain("__digestItemRepairToken");
    } finally {
      harness.close();
    }
  });

  it("does not overwrite a newer summary with a stale repair candidate", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      const staleSummary = {
        totalEvents: 2,
        watchlists: 1,
        strategyParagraph: "The original stored strategy.",
      };
      const newerSummary = {
        ...staleSummary,
        strategyParagraph: "A concurrent worker saved this newer strategy.",
        strategyGeneratedAt: "2026-07-13T05:03:00.000Z",
      };
      const digestRunId = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        staleSummary,
      );
      await addDigestItem(env, digestRunId, {
        watchlistId: "watch-1",
        watchlistName: "Legacy survivor",
        eventType: "landing_page_offer_changed",
        title: "Original partial item",
        summary: "This row must survive the stale repair attempt.",
      });
      await updateDigestRunSummary(env, digestRunId, newerSummary);

      await expect(
        repairIncompleteDigestRun(env, digestRunId, {
          summary: staleSummary,
          items: [
            {
              watchlistId: "watch-1",
              watchlistName: "boAt watch",
              eventType: "landing_page_offer_changed",
              title: "Stale replacement one",
              summary: "A stale worker proposed this row.",
            },
            {
              watchlistId: "watch-1",
              watchlistName: "boAt watch",
              eventType: "landing_page_cta_changed",
              title: "Stale replacement two",
              summary: "A stale worker proposed this row too.",
            },
          ],
        }),
      ).resolves.toBe(false);

      const unchanged = await getDigest(env, digestRunId);
      expect(unchanged?.summary).toEqual(newerSummary);
      expect(unchanged?.items.map((item) => item.title)).toEqual(["Original partial item"]);
    } finally {
      harness.close();
    }
  });

  it("fails closed when the candidate count cannot reproduce the stored checksum", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      const summary = { totalEvents: 2, watchlists: 1 };
      const digestRunId = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        summary,
      );

      await expect(
        repairIncompleteDigestRun(env, digestRunId, {
          summary,
          items: [{
            watchlistId: "watch-1",
            watchlistName: "boAt watch",
            eventType: "landing_page_offer_changed",
            title: "Only one reconstructable item",
            summary: "The second original item is no longer reconstructable.",
          }],
        }),
      ).resolves.toBe(false);
      expect((await getDigest(env, digestRunId))?.items).toEqual([]);
      expect((await getDigest(env, digestRunId))?.summary).toEqual(summary);
    } finally {
      harness.close();
    }
  });

  it("rolls the whole repair back when any replacement item is invalid", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      const summary = { totalEvents: 2, watchlists: 1 };
      const digestRunId = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        summary,
      );
      await addDigestItem(env, digestRunId, {
        watchlistId: "watch-1",
        watchlistName: "Legacy survivor",
        eventType: "landing_page_offer_changed",
        title: "Original partial item",
        summary: "This row must survive a rolled-back repair.",
      });

      await expect(
        repairIncompleteDigestRun(env, digestRunId, {
          summary,
          items: [
            {
              watchlistId: "watch-1",
              watchlistName: "boAt watch",
              eventType: "landing_page_offer_changed",
              title: "Valid replacement",
              summary: "The first replacement is valid.",
            },
            {
              watchlistId: "watch-missing",
              watchlistName: "Missing watchlist",
              eventType: "landing_page_cta_changed",
              title: "Invalid replacement",
              summary: "The foreign key must reject this row.",
            },
          ],
        }),
      ).rejects.toThrow();

      const unchanged = await getDigest(env, digestRunId);
      expect(unchanged?.summary).toEqual(summary);
      expect(unchanged?.items.map((item) => item.title)).toEqual(["Original partial item"]);
      expect(JSON.stringify(unchanged?.summary)).not.toContain("__digestItemRepairToken");
    } finally {
      harness.close();
    }
  });

  it("never repairs an incomplete digest that has already been sent", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      const summary = { totalEvents: 1, watchlists: 1 };
      const digestRunId = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        summary,
      );
      await upsertDigestDelivery(env, digestRunId, {
        provider: "cloudflare_email",
        status: "sent",
        recipientEmail: "owner@example.com",
        externalMessageId: "message-1",
        errorMessage: null,
        deliveredAt: "2026-07-13T05:02:00.000Z",
      });

      await expect(
        repairIncompleteDigestRun(env, digestRunId, {
          summary,
          items: [{
            watchlistId: "watch-1",
            watchlistName: "boAt watch",
            eventType: "landing_page_offer_changed",
            title: "Late repair",
            summary: "This must not mutate a sent digest.",
          }],
        }),
      ).resolves.toBe(false);
      expect((await getDigest(env, digestRunId))?.items).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("never downgrades a sent digest delivery during a later retry write", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      const digestRunId = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        { totalEvents: 0, watchlists: 1 },
      );
      await upsertDigestDelivery(env, digestRunId, {
        provider: "cloudflare_email",
        status: "sent",
        recipientEmail: "owner@example.com",
        externalMessageId: "message-sent",
        errorMessage: null,
        deliveredAt: "2026-07-13T05:02:00.000Z",
      });
      await upsertDigestDelivery(env, digestRunId, {
        provider: "whatsapp_cloud_api",
        status: "pending",
        recipientEmail: "+919999999999",
        externalMessageId: null,
        errorMessage: "A later worker still had an older pending result.",
        deliveredAt: null,
      });

      expect((await getDigest(env, digestRunId))?.delivery).toMatchObject({
        provider: "cloudflare_email",
        status: "sent",
        recipientEmail: "owner@example.com",
        externalMessageId: "message-sent",
        errorMessage: null,
        deliveredAt: "2026-07-13T05:02:00.000Z",
      });
    } finally {
      harness.close();
    }
  });

  it.each(["pending", "sent"] as const)(
    "never repairs while a provider attempt is %s",
    async (attemptStatus) => {
      const harness = setup();
      try {
        const env = { DB: harness.db } as never;
        const summary = { totalEvents: 1, watchlists: 1 };
        const digestRunId = await createDigestRun(
          env,
          "user-1",
          "2026-07-06T05:00:00.000Z",
          "2026-07-13T05:00:00.000Z",
          summary,
        );
        harness.sqlite
          .prepare("INSERT INTO delivery_attempt (digest_run_id, status) VALUES (?, ?)")
          .run(digestRunId, attemptStatus);

        await expect(
          repairIncompleteDigestRun(env, digestRunId, {
            summary,
            items: [{
              watchlistId: "watch-1",
              watchlistName: "boAt watch",
              eventType: "landing_page_offer_changed",
              title: "Late repair",
              summary: "This must wait for the provider outcome.",
            }],
          }),
        ).resolves.toBe(false);
        expect((await getDigest(env, digestRunId))?.items).toEqual([]);
      } finally {
        harness.close();
      }
    },
  );

  it("stores the strategy summary on create and reads it back via getDigest and listDigests", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      const digestRunId = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        {
          totalEvents: 2,
          watchlists: 1,
          strategyParagraph: PARAGRAPH,
          strategyModel: "@cf/meta/llama-3.2-3b-instruct",
          strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
          strategyWatchlistIds: ["watch-1"],
        },
      );

      const digest = await getDigest(env, digestRunId);
      expect(digest?.summary).toMatchObject({
        totalEvents: 2,
        strategyParagraph: PARAGRAPH,
        strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
        strategyWatchlistIds: ["watch-1"],
      });

      const listed = await listDigests(env, "user-1");
      expect(listed).toHaveLength(1);
      expect(listed[0]?.summary).toMatchObject({ strategyParagraph: PARAGRAPH });
    } finally {
      harness.close();
    }
  });

  it("allows an explicit recovery path to replace an existing summary", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      const firstId = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        { totalEvents: 0, watchlists: 1 },
      );

      // Same period again: the period claim keeps the original summary.
      const secondId = await createDigestRun(
        env,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        { totalEvents: 2, strategyParagraph: PARAGRAPH },
      );
      expect(secondId).toBe(firstId);
      expect((await getDigest(env, firstId))?.summary).toEqual({
        totalEvents: 0,
        watchlists: 1,
      });

      await updateDigestRunSummary(env, firstId, {
        totalEvents: 2,
        strategyParagraph: PARAGRAPH,
        strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
      });
      expect((await getDigest(env, firstId))?.summary).toMatchObject({
        strategyParagraph: PARAGRAPH,
      });
    } finally {
      harness.close();
    }
  });

  it("tolerates legacy summary shapes without breaking reads", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      const insert = harness.sqlite.prepare(
        "INSERT INTO digest_run (id, user_id, period_start, period_end, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      insert.run(
        "digest-legacy-invalid",
        "user-1",
        "2026-06-22T05:00:00.000Z",
        "2026-06-29T05:00:00.000Z",
        "not-json{",
        "2026-06-29T05:01:00.000Z",
      );
      insert.run(
        "digest-legacy-array",
        "user-1",
        "2026-06-29T05:00:00.000Z",
        "2026-07-06T05:00:00.000Z",
        "[1,2,3]",
        "2026-07-06T05:01:00.000Z",
      );

      expect((await getDigest(env, "digest-legacy-invalid"))?.summary).toEqual({});
      expect((await getDigest(env, "digest-legacy-array"))?.summary).toEqual({});
      await expect(
        getLatestDigestRunSummaryForWatchlist(env, "user-1", "watch-1"),
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("returns only a paragraph proven to belong exclusively to the report watchlist", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      await createDigestRun(env, "user-1", "2026-06-29T05:00:00.000Z", "2026-07-06T05:00:00.000Z", {
        totalEvents: 1,
        strategyParagraph: `${PARAGRAPH} (older week)`,
        strategyGeneratedAt: "2026-07-06T05:01:00.000Z",
        strategyWatchlistIds: ["watch-1"],
      });
      // Newer weekly run with a paragraph.
      await createDigestRun(env, "user-1", "2026-07-06T05:00:00.000Z", "2026-07-13T05:00:00.000Z", {
        totalEvents: 2,
        strategyParagraph: PARAGRAPH,
        strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
        strategyWatchlistIds: ["watch-1"],
      });
      // Newest run (e.g. a daily heartbeat) has no paragraph — must be skipped.
      await createDigestRun(env, "user-1", "2026-07-13T05:00:00.000Z", "2026-07-14T05:00:00.000Z", {
        totalEvents: 0,
        watchlists: 1,
      });

      await expect(
        getLatestDigestRunSummaryForWatchlist(env, "user-1", "watch-1"),
      ).resolves.toEqual({
        paragraph: PARAGRAPH,
        generatedAt: "2026-07-13T05:01:00.000Z",
        periodEnd: "2026-07-13T05:00:00.000Z",
      });

      // Another user's runs never leak in.
      await expect(
        getLatestDigestRunSummaryForWatchlist(env, "user-2", "watch-1"),
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("fails closed for legacy, mismatched, and mixed-watchlist provenance", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      await createDigestRun(env, "user-1", "2026-06-15T05:00:00.000Z", "2026-06-22T05:00:00.000Z", {
        strategyParagraph: PARAGRAPH,
        strategyGeneratedAt: "2026-06-22T05:01:00.000Z",
      });
      await createDigestRun(env, "user-1", "2026-06-22T05:00:00.000Z", "2026-06-29T05:00:00.000Z", {
        strategyParagraph: PARAGRAPH,
        strategyGeneratedAt: "2026-06-29T05:01:00.000Z",
        strategyWatchlistIds: ["watch-2"],
      });
      await createDigestRun(env, "user-1", "2026-06-29T05:00:00.000Z", "2026-07-06T05:00:00.000Z", {
        strategyParagraph: PARAGRAPH,
        strategyGeneratedAt: "2026-07-06T05:01:00.000Z",
        strategyWatchlistIds: ["watch-1", "watch-2"],
      });

      await expect(
        getLatestDigestRunSummaryForWatchlist(env, "user-1", "watch-1"),
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });
});
