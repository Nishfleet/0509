import { describe, expect, it } from "vitest";

import {
  loadAdsDomainPublisherCursor,
  saveAdsDomainPublisherCursor,
} from "~/lib/ads-domain-publisher.server";

import { appEnv, db } from "./fixtures";

/**
 * Issue #2361: the ads_domain_publisher_state migration (0092) adds the
 * singleton D1 row that persists the all-lists resume cursor. These assert
 * the real READ and WRITE paths against the migration-applied local D1 — a
 * mocked binding cannot see the schema, the CHECK constraint, or the seed row.
 */
describe("ads_domain_publisher_state migration (issue #2361)", () => {
  it("seeds a singleton cursor row at offset 0 (read path)", async () => {
    const cursor = await loadAdsDomainPublisherCursor(appEnv);
    expect(cursor.offset).toBe(0);
    expect(cursor.list).toBe("");
  });

  it("upserts and reads back the cursor (write + read path)", async () => {
    await saveAdsDomainPublisherCursor(appEnv, "sneaker-resale", 30);
    const afterFirst = await loadAdsDomainPublisherCursor(appEnv);
    expect(afterFirst.offset).toBe(30);
    expect(afterFirst.list).toBe("sneaker-resale");

    // A second save overwrites the singleton row (ON CONFLICT upsert) — it
    // must NOT insert a second row.
    await saveAdsDomainPublisherCursor(appEnv, "festive-india-2026", 7);
    const afterSecond = await loadAdsDomainPublisherCursor(appEnv);
    expect(afterSecond.offset).toBe(7);
    expect(afterSecond.list).toBe("festive-india-2026");

    const count = await db()
      .prepare("SELECT COUNT(*) AS n FROM ads_domain_publisher_state")
      .bind()
      .all<{ n: number }>();
    expect(count.results[0].n).toBe(1);
  });

  it("enforces the singleton id = 1 CHECK constraint", async () => {
    await expect(
      db()
        .prepare(
          "INSERT INTO ads_domain_publisher_state (id, last_list, last_offset, updated_at) VALUES (2, 'x', 0, '1970-01-01T00:00:00.000Z')",
        )
        .run(),
    ).rejects.toThrow();
  });
});
