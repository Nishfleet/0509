import { describe, expect, it } from "vitest";

import {
  createDigestRun,
  getDigest,
  getLatestDigestRunSummaryForWatchlist,
  listDigests,
  updateDigestRunSummary,
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
