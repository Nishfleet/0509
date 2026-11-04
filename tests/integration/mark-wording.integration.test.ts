import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readMarkWording } from "../../app/lib/data/mark_wording.server";
import { composeBrief } from "../../workers/standing/compose-brief";

const AT = "2026-09-16T10:00:00.000Z";
const WEEK = { startsAt: new Date("2026-09-14T12:00:00.000Z"), closesAt: new Date("2026-09-21T12:00:00.000Z") };
const DIFF_KEY = "snapshot/site/w-a/diff.json";

async function seedChange(id: string, ws: string, diffKey: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, dedup_key, observed_at, canonical_url, url_hash, payload_json, aspect)
     VALUES (?1, ?2, 'rv-a', 'src-a', 'change', 'Acme changed its pricing page', ?1, ?3, 'https://x.example/' || ?1, ?1, ?4, 'copy')`,
  )
    .bind(id, ws, AT, JSON.stringify({ diffKey, before: { textKey: "b.txt" }, after: { textKey: "a.txt" } }))
    .run();
  await env.DB.prepare(
    `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, decided_at)
     VALUES ('v-' || ?1, ?2, 'noteworthy_change', 'h-' || ?1, ?1, 'rv-a', 0.95, ?3)`,
  )
    .bind(id, ws, AT)
    .run();
}

describe("mark wording from the stored diff", () => {
  beforeEach(async () => {
    for (const table of ["jev_verdict", "signal", "entity", "source", "workspace"])
      await env.DB.exec(`DELETE FROM ${table}`);
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u-a', 'T', 'a@example.test', 1, ?1, ?1)`,
      ).bind(AT),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES ('ws-a', 'ws-a', 'u-a', 'UTC', ?1)`,
      ).bind(AT),
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES ('src-a', 'key-a', 'site', 'web', 'pl-a', 'scraped_page')`,
      ),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, state, created_at)
         VALUES ('rv-a', 'ws-a', 'competitor', 'rv-a.example', 'Acme', '{}', 'on', ?1)`,
      ).bind(AT),
    ]);
    await env.SNAPSHOTS.put(DIFF_KEY, JSON.stringify({ hunks: [{ lines: ["-Pro is $20", "+Pro is $29"] }] }));
  });

  it("reads removed and added wording for a change", async () => {
    await seedChange("c1", "ws-a", DIFF_KEY);
    const wording = await readMarkWording(env.DB, { workspaceId: "ws-a", signalIds: ["c1"] });
    expect(wording.get("c1")).toEqual({ removed: "Pro is $20", added: "Pro is $29" });
  });

  it("skips a change with no stored diff, a missing object and another workspace", async () => {
    await seedChange("c-none", "ws-a", null);
    await seedChange("c-gone", "ws-a", "snapshot/site/w-a/missing.json");
    const wording = await readMarkWording(env.DB, { workspaceId: "ws-other", signalIds: ["c-none", "c-gone"] });
    expect(wording.size).toBe(0);
    const own = await readMarkWording(env.DB, { workspaceId: "ws-a", signalIds: ["c-none", "c-gone"] });
    expect(own.size).toBe(0);
  });

  it("puts before and after on the brief's read-first marks", async () => {
    await seedChange("c1", "ws-a", DIFF_KEY);
    const payload = await composeBrief(env.DB, {
      workspaceId: "ws-a",
      schedule: { timezone: "UTC", weekday: 1, hour: 8 },
      week: WEEK,
      readThisFirst: { picks: ["c1"], judged: 1, unjudged: false },
    });
    expect(payload.read_this_first[0]).toMatchObject({ before: "Pro is $20", after: "Pro is $29" });
  });
});
