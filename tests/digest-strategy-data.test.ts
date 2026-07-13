import { describe, expect, it } from "vitest";

import {
  createDigestRun,
  getDigest,
  getLatestDigestRunSummaryForUser,
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
  harness.sqlite
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
    )
    .run("user-1", "Owner", "owner@example.com", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  return harness;
}

describe("digest_run summary persistence", () => {
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
        },
      );

      const digest = await getDigest(env, digestRunId);
      expect(digest?.summary).toMatchObject({
        totalEvents: 2,
        strategyParagraph: PARAGRAPH,
        strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
      });

      const listed = await listDigests(env, "user-1");
      expect(listed).toHaveLength(1);
      expect(listed[0]?.summary).toMatchObject({ strategyParagraph: PARAGRAPH });
    } finally {
      harness.close();
    }
  });

  it("updateDigestRunSummary replaces what INSERT OR IGNORE silently dropped", async () => {
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

      // Same period again: INSERT OR IGNORE keeps the original summary.
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
      await expect(getLatestDigestRunSummaryForUser(env, "user-1")).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("getLatestDigestRunSummaryForUser returns the newest stored paragraph, skipping runs without one", async () => {
    const harness = setup();
    try {
      const env = { DB: harness.db } as never;
      await createDigestRun(env, "user-1", "2026-06-29T05:00:00.000Z", "2026-07-06T05:00:00.000Z", {
        totalEvents: 1,
        strategyParagraph: `${PARAGRAPH} (older week)`,
        strategyGeneratedAt: "2026-07-06T05:01:00.000Z",
      });
      // Newer weekly run with a paragraph.
      await createDigestRun(env, "user-1", "2026-07-06T05:00:00.000Z", "2026-07-13T05:00:00.000Z", {
        totalEvents: 2,
        strategyParagraph: PARAGRAPH,
        strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
      });
      // Newest run (e.g. a daily heartbeat) has no paragraph — must be skipped.
      await createDigestRun(env, "user-1", "2026-07-13T05:00:00.000Z", "2026-07-14T05:00:00.000Z", {
        totalEvents: 0,
        watchlists: 1,
      });

      await expect(getLatestDigestRunSummaryForUser(env, "user-1")).resolves.toEqual({
        paragraph: PARAGRAPH,
        generatedAt: "2026-07-13T05:01:00.000Z",
        periodEnd: "2026-07-13T05:00:00.000Z",
      });

      // Another user's runs never leak in.
      await expect(getLatestDigestRunSummaryForUser(env, "user-2")).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });
});
