import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCollection, updateCollectionItem } from "~/lib/data/collections.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

/**
 * Concurrent same-label tag adds (Nishfleet/0509#2445).
 *
 * `ensureTags` reads `tag` by `(user_id, label)`, then inserts when absent.
 * `idx_tag_user_label` is UNIQUE (migrations/0001_app.sql), so when two saves
 * carrying the same new label both observe the label as absent, the loser's
 * INSERT throws `UNIQUE constraint failed: tag.user_id, tag.label` and the
 * whole save fails even though the desired end-state is identical.
 *
 * Scope note: this harness runs `node:sqlite` over a single synchronous
 * in-memory connection, so a save cannot be parked mid-read to build a
 * deterministic interleave (holding the read open serializes on the
 * connection). The race is therefore exercised by genuine concurrent
 * dispatch via `Promise.all`, which is the issue's own `repro:` line. That
 * variant is a real, reproducible failure on the pre-fix code, not a lucky
 * microtask ordering.
 */
describe("collections tags (sqlite)", () => {
  let harness: ReturnType<typeof createSqliteD1>;
  let env: Parameters<typeof updateCollectionItem>[0];

  beforeEach(() => {
    harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0000_auth.sql");
    applyMigration(harness.sqlite, "migrations/0001_app.sql");
    harness.sqlite
      .prepare(
        `
          INSERT INTO user (id, name, email, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run("user-1", "Owner", "owner@example.com", "2026-07-15", "2026-07-15");
    env = { DB: harness.db } as Parameters<typeof updateCollectionItem>[0];
  });

  afterEach(() => {
    harness.close();
  });

  async function seedItem(name: string) {
    const collection = await createCollection(env, "user-1", { name });
    const itemId = `item-${name}`;
    const adId = `ad-${name}`;
    harness.sqlite
      .prepare(
        `
          INSERT INTO ad (
            id, advertiser, body, body_secondary, preview_headline, preview_subhead,
            hook, offer_text, cta, creative_format, language_label, destination_type,
            landing_page_url, ad_snapshot_url, countries_json, platforms_json,
            first_seen_at, last_seen_at, is_active, source, research_summary,
            raw_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        adId,
        "Acme",
        "Body",
        null,
        "Headline",
        "Subhead",
        "Hook",
        "",
        "Shop",
        "image",
        "en",
        "external",
        "https://example.com",
        null,
        "[]",
        '["facebook"]',
        "2026-07-15",
        "2026-07-15",
        1,
        "test",
        "",
        "{}",
        "2026-07-15",
        "2026-07-15",
      );
    harness.sqlite
      .prepare(
        `
          INSERT INTO collection_item (
            id, collection_id, ad_id, note, ad_snapshot_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        itemId,
        collection!.id,
        adId,
        null,
        JSON.stringify({ id: adId }),
        "2026-07-15",
        "2026-07-15",
      );
    return itemId;
  }

  function tagRowCount(label: string) {
    const row = harness.sqlite
      .prepare("SELECT COUNT(*) AS count FROM tag WHERE user_id = ? AND label = ?")
      .get("user-1", label) as { count: number };
    return row.count;
  }

  function tagIdsForItem(itemId: string) {
    return (
      harness.sqlite
        .prepare("SELECT tag_id FROM collection_item_tag WHERE collection_item_id = ?")
        .all(itemId) as { tag_id: string }[]
    ).map((row) => row.tag_id);
  }

  it("keeps exactly one tag row when two same-label saves are issued concurrently", async () => {
    const itemA = await seedItem("Alpha");
    const itemB = await seedItem("Beta");

    // Pre-fix this rejects with UNIQUE constraint failed: tag.user_id, tag.label.
    await Promise.all([
      updateCollectionItem(env, "user-1", itemA, { note: null, tags: ["dupe"] }),
      updateCollectionItem(env, "user-1", itemB, { note: null, tags: ["dupe"] }),
    ]);

    expect(tagRowCount("dupe")).toBe(1);

    // Both saves must end up pointing at the single surviving row, so the
    // loser adopted the winner's id rather than writing one it never inserted.
    const rows = harness.sqlite
      .prepare("SELECT id FROM tag WHERE user_id = ? AND label = ?")
      .all("user-1", "dupe") as { id: string }[];
    expect(tagIdsForItem(itemA)).toEqual([rows[0]!.id]);
    expect(tagIdsForItem(itemB)).toEqual([rows[0]!.id]);
  });

  it("reuses the existing tag row without duplicating it on sequential saves", async () => {
    const itemA = await seedItem("Alpha");
    const itemB = await seedItem("Beta");

    await updateCollectionItem(env, "user-1", itemA, { note: null, tags: ["shared"] });
    await updateCollectionItem(env, "user-1", itemB, { note: null, tags: ["shared"] });

    expect(tagRowCount("shared")).toBe(1);
    expect(tagIdsForItem(itemA)).toEqual(tagIdsForItem(itemB));
  });

  it("adds several new labels in one save exactly once each", async () => {
    const itemA = await seedItem("Alpha");

    await updateCollectionItem(env, "user-1", itemA, {
      note: null,
      tags: ["one", "two", "one"],
    });

    expect(tagRowCount("one")).toBe(1);
    expect(tagRowCount("two")).toBe(1);
    expect(tagIdsForItem(itemA)).toHaveLength(2);
  });
});
