import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { backfillChangeExcerpts } from "../../../app/lib/site/backfill-excerpts.server";

const AT = "2026-10-10T10:00:00.000Z";

const signal = (id: string, payload: unknown) =>
  env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, aspect, payload_json, dedup_key, observed_at)
     VALUES (?1, 'ws-bf', 'rival-bf', 'src-bf', 'change', 'Change', 'https://rival.example/', 'copy', ?2, ?3, ?4)`,
  ).bind(id, JSON.stringify(payload), `dedup-${id}`, AT);

const excerptOf = async (id: string) =>
  (
    await env.DB.prepare(`SELECT json_extract(payload_json, '$.excerpt') AS excerpt FROM signal WHERE id = ?1`)
      .bind(id)
      .first<{ excerpt: string | null }>()
  )?.excerpt;

describe("backfilling change excerpts", () => {
  beforeEach(async () => {
    for (const table of ["signal", "entity", "workspace"]) await env.DB.exec(`DELETE FROM ${table}`);
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.exec(`DELETE FROM source WHERE id = 'src-bf'`);
    await env.SNAPSHOTS.put(
      "snapshot/site/bf/one.diff.json",
      JSON.stringify({ hunks: [{ lines: ["@@ -1,1 +1,1 @@", "-Old", "+New"] }] }),
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES ('src-bf', 'key-bf', 'site', 'web', 'plugin-bf', 'scraped_page')`,
      ),
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u-bf', 'U', 'u-bf@example.test', 1, ?1, ?1)`,
      ).bind(AT),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES ('ws-bf', 'W', 'u-bf', 'UTC', ?1)`,
      ).bind(AT),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES ('rival-bf', 'ws-bf', 'competitor', 'rival.example', 'Rival', 'on', ?1)`,
      ).bind(AT),
      signal("sig-old", { diffKey: "snapshot/site/bf/one.diff.json", wordsAdded: 1 }),
      signal("sig-gone", { diffKey: "snapshot/site/bf/missing.diff.json" }),
      signal("sig-done", { diffKey: "snapshot/site/bf/one.diff.json", excerpt: [] }),
      signal("sig-nodiff", { diffKey: null }),
    ]);
  });

  it("adds the stored hunks to old changes, keeps their other fields, and leaves finished ones alone", async () => {
    expect(await backfillChangeExcerpts()).toBe(2);

    expect(JSON.parse((await excerptOf("sig-old")) ?? "null")).toEqual([
      { lines: ["@@ -1,1 +1,1 @@", "-Old", "+New"] },
    ]);
    const kept = await env.DB.prepare(
      `SELECT json_extract(payload_json, '$.wordsAdded') AS n FROM signal WHERE id = 'sig-old'`,
    ).first<{ n: number }>();
    expect(kept?.n).toBe(1);
    expect(await excerptOf("sig-done")).toBe("[]");
    expect(await excerptOf("sig-nodiff")).toBeNull();
  });

  it("marks a change whose diff is gone with an empty excerpt, so it is not read again", async () => {
    await backfillChangeExcerpts();
    expect(await excerptOf("sig-gone")).toBe("[]");
    expect(await backfillChangeExcerpts()).toBe(0);
  });
});
