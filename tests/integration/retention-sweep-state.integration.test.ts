import { describe, expect, it } from "vitest";

import { reconcileOrphanedArtifacts } from "~/lib/retention.server";

import { db } from "./fixtures";

/**
 * Issue #1926: the R2 -> D1 orphan reconciliation persists its R2 list cursor
 * in the `retention_sweep_state` table (migration 0085). This suite applies the
 * repo's real migrations and asserts the new READ and WRITE path for that
 * table — a mocked D1 binding cannot see the real schema.
 */
describe("retention_sweep_state migration (0085)", () => {
  it("writes and reads the orphan-reconcile cursor row", async () => {
    const key = "r2_orphan_reconcile_cursor";

    await db()
      .prepare(
        `INSERT INTO retention_sweep_state (state_key, cursor_value, mode, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           cursor_value = excluded.cursor_value,
           mode = excluded.mode,
           updated_at = excluded.updated_at`,
      )
      .bind(key, "first-cursor", "delete", "2026-09-07T12:00:00.000Z")
      .run();

    const read = await db()
      .prepare(
        `SELECT cursor_value, mode FROM retention_sweep_state WHERE state_key = ?`,
      )
      .bind(key)
      .all<{ cursor_value: string | null; mode: string }>();

    expect(read.results[0]?.cursor_value).toBe("first-cursor");
    expect(read.results[0]?.mode).toBe("delete");

    // Upsert overwrites the single row rather than inserting a duplicate.
    await db()
      .prepare(
        `INSERT INTO retention_sweep_state (state_key, cursor_value, mode, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           cursor_value = excluded.cursor_value,
           mode = excluded.mode,
           updated_at = excluded.updated_at`,
      )
      .bind(key, "second-cursor", "dry-run", "2026-09-07T13:00:00.000Z")
      .run();

    const rows = await db()
      .prepare(`SELECT cursor_value, mode FROM retention_sweep_state WHERE state_key = ?`)
      .bind(key)
      .all<{ cursor_value: string | null; mode: string }>();

    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.cursor_value).toBe("second-cursor");
    expect(rows.results[0]?.mode).toBe("dry-run");
  });

  it("allows the cursor to be cleared back to null", async () => {
    const key = "r2_orphan_reconcile_cursor";

    await db()
      .prepare(
        `INSERT INTO retention_sweep_state (state_key, cursor_value, mode, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           cursor_value = excluded.cursor_value,
           mode = excluded.mode,
           updated_at = excluded.updated_at`,
      )
      .bind(key, "some-cursor", "delete", "2026-09-07T12:00:00.000Z")
      .run();

    await db()
      .prepare(
        `INSERT INTO retention_sweep_state (state_key, cursor_value, mode, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           cursor_value = excluded.cursor_value,
           mode = excluded.mode,
           updated_at = excluded.updated_at`,
      )
      .bind(key, null, "delete", "2026-09-07T13:00:00.000Z")
      .run();

    const read = await db()
      .prepare(`SELECT cursor_value FROM retention_sweep_state WHERE state_key = ?`)
      .bind(key)
      .all<{ cursor_value: string | null }>();

    expect(read.results[0]?.cursor_value).toBeNull();
  });

  it("keeps a key referenced via landing_page_snapshot metadata against real D1", async () => {
    const key = "landing-pages/2026-01-01/0123456789abcdef0123456789abcdef.html";
    await db()
      .prepare(
        `INSERT INTO landing_page_snapshot (
           id, raw_url, canonical_url, raw_headline, normalized_headline,
           normalized_headline_hash, capture_method, artifact_key, metadata_json,
           captured_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "snap-ref",
        "https://example.test/",
        "https://example.test/",
        "Headline",
        "headline",
        "hash",
        "browser_render",
        null,
        JSON.stringify({ htmlArtifactKey: key }),
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();

    const deletes: string[] = [];
    const result = await reconcileOrphanedArtifacts(
      {
        DB: db(),
        LANDING_PAGE_ARTIFACTS: {
          async list() {
            return { objects: [{ key }], truncated: false };
          },
          async delete(k: string) {
            deletes.push(k);
          },
        },
        R2_ORPHAN_RECONCILE_ENABLED: "1",
      } as never,
      { now: new Date("2026-09-07T12:00:00.000Z").getTime() },
    );

    expect(result.referenced).toBe(1);
    expect(result.deleted).toBe(0);
    expect(deletes).toEqual([]);
  });

  it("keeps a key referenced via ad.raw_json against real D1", async () => {
    const key = "landing-pages/2026-01-01/fedcba9876543210fedcba9876543210.jpeg";
    await db()
      .prepare(
        `INSERT INTO ad (
           id, advertiser, body, preview_headline, preview_subhead, hook,
           offer_text, cta, creative_format, language_label, destination_type,
           countries_json, platforms_json, source, research_summary, raw_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "ad-ref",
        "Advertiser",
        "body",
        "headline",
        "subhead",
        "hook",
        "offer",
        "cta",
        "image",
        "en",
        "link",
        "[]",
        "[]",
        "meta",
        "research",
        JSON.stringify({ landingPage: { metadata: { screenshotArtifactKey: key } } }),
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();

    const deletes: string[] = [];
    const result = await reconcileOrphanedArtifacts(
      {
        DB: db(),
        LANDING_PAGE_ARTIFACTS: {
          async list() {
            return { objects: [{ key }], truncated: false };
          },
          async delete(k: string) {
            deletes.push(k);
          },
        },
        R2_ORPHAN_RECONCILE_ENABLED: "1",
      } as never,
      { now: new Date("2026-09-07T12:00:00.000Z").getTime() },
    );

    expect(result.referenced).toBe(1);
    expect(result.deleted).toBe(0);
    expect(deletes).toEqual([]);
  });
});
