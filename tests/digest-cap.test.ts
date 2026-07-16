import { describe, expect, it } from "vitest";

import {
  createDigestRun,
  getDigest,
  getDigestByPeriod,
  listDigests,
} from "~/lib/data/digests.server";
import { hasCompleteDigestItemSet } from "~/lib/digest-orchestration.server";
import { DIGEST_ITEM_COHORT_CAP, selectDigestCohort } from "~/lib/digest-provenance";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

function item(index: number, watchlistIndex = index % 75) {
  return {
    watchlistId: `watch-${watchlistIndex}`,
    watchlistName: `Watch ${watchlistIndex}`,
    eventType: "landing_page_offer_changed" as const,
    title: `Change ${index}`,
    summary: `Summary ${index}`,
    metadata: { eventId: `event-${index}`, priorityScore: index % 101 },
  };
}

describe("digest cohort cap", () => {
	it("treats a provenance-marked capped item set as complete", () => {
		const items = Array.from({ length: DIGEST_ITEM_COHORT_CAP }, (_, index) => ({
			metadata: { eventId: `event-${index}` },
		}));

		expect(
			hasCompleteDigestItemSet({
				summary: {
					totalEvents: 4_200,
					totalEligibleEvents: 4_200,
					includedEvents: DIGEST_ITEM_COHORT_CAP,
					omittedEvents: 4_200 - DIGEST_ITEM_COHORT_CAP,
					digestItemSetProvenance: "atomic-v2",
				},
				items,
			}),
		).toBe(true);
		expect(
			hasCompleteDigestItemSet({
				summary: {
					totalEvents: 4_200,
					totalEligibleEvents: 4_200,
					includedEvents: DIGEST_ITEM_COHORT_CAP,
					omittedEvents: 1,
					digestItemSetProvenance: "atomic-v2",
				},
				items,
			}),
		).toBe(false);
	});

  it("covers every Agency-sized watchlist before filling the ranked remainder", () => {
    const input = Array.from({ length: 4_200 }, (_, index) => item(index));
    const first = selectDigestCohort(input);
    const second = selectDigestCohort(input);

    expect(first).toEqual(second);
    expect(first.includedEvents).toBe(DIGEST_ITEM_COHORT_CAP);
    expect(first.omittedEvents).toBe(4_200 - DIGEST_ITEM_COHORT_CAP);
    expect(new Set(first.items.map((entry) => entry.watchlistId)).size).toBe(75);
  });

  it("re-enforces the cap and count summary at the atomic create boundary", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0000_auth.sql");
    applyMigration(harness.sqlite, "migrations/0001_app.sql");
    applyMigration(harness.sqlite, "migrations/0002_monitoring_trust.sql");
    harness.sqlite
      .prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)")
      .run("user-1", "Owner", "owner@example.com", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    for (let index = 0; index < 75; index += 1) {
      harness.sqlite
        .prepare(`INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`)
        .run(`watch-${index}`, "user-1", `Watch ${index}`, `target-${index}`, `fingerprint-${index}`, `target-${index}`, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    }
    try {
      const claim = await createDigestRun(
        { DB: harness.db } as never,
        "user-1",
        "2026-07-06T05:00:00.000Z",
        "2026-07-13T05:00:00.000Z",
        {},
        { returnClaim: true, items: Array.from({ length: 4_200 }, (_, index) => item(index)) },
      );
      expect(claim.created).toBe(true);
      const digest = await getDigest({ DB: harness.db } as never, claim.digestRunId);
      expect(digest?.items).toHaveLength(DIGEST_ITEM_COHORT_CAP);
      expect(digest?.summary).toMatchObject({
        totalEligibleEvents: 4_200,
        includedEvents: DIGEST_ITEM_COHORT_CAP,
        omittedEvents: 4_200 - DIGEST_ITEM_COHORT_CAP,
        digestItemSetProvenance: "atomic-v2",
      });
    } finally {
      harness.close();
    }
  });

  it("returns the canonical cohort order from every persisted digest read", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0000_auth.sql");
    applyMigration(harness.sqlite, "migrations/0001_app.sql");
    applyMigration(harness.sqlite, "migrations/0002_monitoring_trust.sql");
    harness.sqlite
      .prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)")
      .run("user-1", "Owner", "owner@example.com", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    for (const watchlistId of ["watch-a", "watch-b"]) {
      harness.sqlite
        .prepare(`INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`)
        .run(watchlistId, "user-1", watchlistId, watchlistId, watchlistId, watchlistId, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    }
    const periodStart = "2026-07-06T05:00:00.000Z";
    const periodEnd = "2026-07-13T05:00:00.000Z";
    const input = [
      {
        watchlistId: "watch-a",
        watchlistName: "Watch A",
        eventType: "landing_page_offer_changed" as const,
        title: "Medium A",
        summary: "Medium priority event.",
        metadata: { eventId: "event-a-medium", priorityScore: 72 },
      },
      {
        watchlistId: "watch-b",
        watchlistName: "Watch B",
        eventType: "landing_page_offer_changed" as const,
        title: "High B",
        summary: "Highest priority event.",
        metadata: { eventId: "event-b-high", priorityScore: 95 },
      },
      {
        watchlistId: "watch-a",
        watchlistName: "Watch A",
        eventType: "landing_page_offer_changed" as const,
        title: "High A",
        summary: "High priority event.",
        metadata: { eventId: "event-a-high", priorityScore: 90 },
      },
    ];

    try {
      const claim = await createDigestRun(
        { DB: harness.db } as never,
        "user-1",
        periodStart,
        periodEnd,
        {},
        { returnClaim: true, items: input },
      );
      const expectedTitles = selectDigestCohort(input).items.map((entry) => entry.title);
      harness.sqlite.prepare("DELETE FROM digest_item WHERE digest_run_id = ?").run(claim.digestRunId);
      const insert = harness.sqlite.prepare(`
        INSERT INTO digest_item (
          id, digest_run_id, watchlist_id, watchlist_name, event_type,
          title, summary, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      input.forEach((entry, index) => {
        insert.run(
          `item-${index}`,
          claim.digestRunId,
          entry.watchlistId,
          entry.watchlistName,
          entry.eventType,
          entry.title,
          entry.summary,
          JSON.stringify(entry.metadata),
          "2026-07-13T05:00:00.000Z",
        );
      });

      await expect(getDigest({ DB: harness.db } as never, claim.digestRunId)).resolves.toMatchObject({
        items: expectedTitles.map((title) => ({ title })),
      });
      await expect(
        getDigestByPeriod({ DB: harness.db } as never, "user-1", periodStart, periodEnd),
      ).resolves.toMatchObject({ items: expectedTitles.map((title) => ({ title })) });
      await expect(listDigests({ DB: harness.db } as never, "user-1")).resolves.toMatchObject([
        { items: expectedTitles.map((title) => ({ title })) },
      ]);
    } finally {
      harness.close();
    }
  });
});
