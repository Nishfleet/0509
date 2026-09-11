import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCollection, updateCollectionItem } from "~/lib/data/collections.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

/**
 * Concurrent same-label tag adds.
 *
 * `ensureTags` reads `tag` by `(user_id, label)`, then inserts when absent.
 * `idx_tag_user_label` is UNIQUE (migrations/0001_app.sql), so when two saves
 * carrying the same new label interleave between the read and the insert, the
 * loser's INSERT throws `UNIQUE constraint failed: tag.user_id, tag.label`
 * and the whole save fails even though the desired end-state is identical.
 *
 * The race is made deterministic (not timing-dependent) by latching the first
 * `SELECT ... FROM tag` for a label: the second save is admitted only after
 * the first save's insert has happened, which is exactly the interleaving a
 * double-clicked "Save" produces in production.
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

  /**
   * Wrap the env so the FIRST `SELECT id FROM tag ... label = ?` for `label`
   * is held open until `release()` is called. This reproduces the
   * read-then-INSERT interleaving: the loser has already seen "absent" when
   * the winner commits its row.
   */
  function latchFirstTagSelect(label: string) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let armed = true;
    const held: { promise: Promise<void> | null } = { promise: null };

    const db = {
      prepare(sql: string) {
        const statement = harness.db.prepare(sql);
        return {
          bind(...bindings: unknown[]) {
            const bound = statement.bind(...bindings);
            const isTagSelect =
              sql.includes("FROM tag") && sql.includes("label = ?") && bindings.includes(label);
            let wait: Promise<void> | null = null;
            if (armed && isTagSelect) {
              armed = false;
              wait = released;
              held.promise = wait;
            }
            return {
              run: () => bound.run(),
              all: () => bound.all(),
              first: async () => {
                if (wait) {
                  const pending = wait;
                  held.promise = null;
                  await pending;
                }
                return bound.first();
              },
            };
          },
        };
      },
      batch: (statements: never[]) => harness.db.batch(statements),
    };

    return { env: { ...env, DB: db } as typeof env, release };
  }

  it("adopts the winner's tag row instead of failing when two saves add the same new label", async () => {
    const itemA = await seedItem("Alpha");
    const itemB = await seedItem("Beta");

    const latch = latchFirstTagSelect("new");
    const winner = updateCollectionItem(env, "user-1", itemA, { note: null, tags: ["new"] });
    const loser = updateCollectionItem(latch.env, "user-1", itemB, { note: null, tags: ["new"] });

    // Winner completes its insert while the loser is still parked on its read.
    await winner;
    latch.release();
    await expect(loser).resolves.toBeUndefined();

    expect(tagRowCount("new")).toBe(1);

    const tagged = harness.sqlite
      .prepare("SELECT COUNT(*) AS count FROM collection_item_tag")
      .get() as { count: number };
    expect(tagged.count).toBe(2);
  });

  it("keeps exactly one tag row when two same-label saves are issued concurrently", async () => {
    const itemA = await seedItem("Alpha");
    const itemB = await seedItem("Beta");

    await Promise.all([
      updateCollectionItem(env, "user-1", itemA, { note: null, tags: ["dupe"] }),
      updateCollectionItem(env, "user-1", itemB, { note: null, tags: ["dupe"] }),
    ]);

    expect(tagRowCount("dupe")).toBe(1);
  });

  it("reuses the existing tag row without duplicating it on sequential saves", async () => {
    const itemA = await seedItem("Alpha");
    const itemB = await seedItem("Beta");

    await updateCollectionItem(env, "user-1", itemA, { note: null, tags: ["shared"] });
    await updateCollectionItem(env, "user-1", itemB, { note: null, tags: ["shared"] });

    expect(tagRowCount("shared")).toBe(1);
  });
});
