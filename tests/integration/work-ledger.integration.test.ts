import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { parseBriefPayload } from "../../app/lib/brief-payload";
import { readWorkLedger } from "../../app/lib/data/work_ledger.server";
import { renderBrief } from "../../workers/delivery/brief-template";
import { composeBrief } from "../../workers/standing/compose-brief";

const FROM = "2026-09-14T12:00:00.000Z";
const UNTIL = "2026-09-21T12:00:00.000Z";
const IN = "2026-09-16T10:00:00.000Z";
const BEFORE = "2026-09-01T10:00:00.000Z";
const WEEK = { startsAt: new Date(FROM), closesAt: new Date(UNTIL) };

async function seedWorkspace(ws: string, rival: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'T', ?2, 1, ?3, ?3)`,
    ).bind(`u-${ws}`, `${ws}@example.test`, BEFORE),
    env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?1, ?2, 'UTC', ?3)`,
    ).bind(ws, `u-${ws}`, BEFORE),
    env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'site', 'web', ?3, 'scraped_page')`,
    ).bind(`src-${ws}`, `key-${ws}`, `pl-${ws}`),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, state, created_at)
       VALUES (?1, ?2, 'competitor', ?1 || '.example', 'Rival', '{}', 'on', ?3)`,
    ).bind(rival, ws, BEFORE),
    env.DB.prepare(`INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?1, ?2, ?3, 'home')`).bind(
      `w-${ws}`,
      rival,
      `src-${ws}`,
    ),
    env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, discovered_at) VALUES (?1, ?2, 'https://r.example/', ?3)`,
    ).bind(`pg-${ws}`, rival, BEFORE),
    env.DB.prepare(
      `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at)
       VALUES (?1, ?2, ?3, ?4, 5, 1, NULL, ?5)`,
    ).bind(`st-${ws}`, ws, rival, FROM, BEFORE),
    env.DB.prepare(
      `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at)
       VALUES (?1, ?2, ?3, '2026-09-07T12:00:00.000Z', 5, 1, NULL, ?4)`,
    ).bind(`st0-${ws}`, ws, rival, BEFORE),
  ]);
}

async function snapshot(id: string, ws: string, at: string, page = `pg-${ws}`): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_hash) VALUES (?1, ?2, ?3, ?4, ?1)`,
  )
    .bind(id, `w-${ws}`, page, at)
    .run();
}

async function signal(input: {
  id: string;
  ws: string;
  rival: string;
  kind: "change" | "mention";
  p?: number;
  tombstoned?: boolean;
  state?: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, dedup_key, observed_at, canonical_url, url_hash, is_tombstoned, state, aspect)
     VALUES (?1, ?2, ?3, ?4, ?5, ?1, ?1, ?6, 'https://x.example/' || ?1, ?1, ?7, ?8, 'copy')`,
  )
    .bind(
      input.id,
      input.ws,
      input.rival,
      `src-${input.ws}`,
      input.kind,
      IN,
      input.tombstoned === true ? 1 : 0,
      input.state ?? null,
    )
    .run();
  if (input.p === undefined) return;
  await env.DB.prepare(
    `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at)
     VALUES (?1, ?2, ?3, ?1, ?4, ?5, ?6)`,
  )
    .bind(
      `v-${input.id}`,
      input.ws,
      input.kind === "change" ? "noteworthy_change" : "mention_matters",
      input.id,
      input.p,
      IN,
    )
    .run();
}

describe("the work ledger against real D1", () => {
  beforeEach(async () => {
    for (const table of [
      "jev_verdict",
      "signal",
      "snapshot",
      "page",
      "watch",
      "standing",
      "entity",
      "source",
      "workspace",
    ]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await seedWorkspace("ws-a", "rv-a");
    await seedWorkspace("ws-b", "rv-b");
  });

  it("counts reads, changes told, changes set aside and mentions kept in the window only", async () => {
    await snapshot("s1", "ws-a", IN);
    await snapshot("s2", "ws-a", "2026-09-17T10:00:00.000Z");
    await snapshot("s-old", "ws-a", BEFORE);
    await signal({ id: "c-told", ws: "ws-a", rival: "rv-a", kind: "change", p: 0.95 });
    await signal({ id: "c-small", ws: "ws-a", rival: "rv-a", kind: "change", p: 0.3 });
    await signal({ id: "c-new", ws: "ws-a", rival: "rv-a", kind: "change" });
    await signal({ id: "m-kept", ws: "ws-a", rival: "rv-a", kind: "mention", p: 0.9 });
    await signal({ id: "m-drop", ws: "ws-a", rival: "rv-a", kind: "mention", tombstoned: true });
    await signal({ id: "m-wait", ws: "ws-a", rival: "rv-a", kind: "mention", state: "unjudged" });

    expect(await readWorkLedger(env.DB, { workspaceId: "ws-a", from: FROM, until: UNTIL })).toEqual({
      rivals: 1,
      pages_read: 1,
      changes_seen: 3,
      changes_told: 1,
      changes_set_aside: 1,
      mentions_read: 2,
      mentions_kept: 1,
    });
  });

  it("does not count a read that has no page behind it", async () => {
    await env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_hash) VALUES ('s-nopage', 'w-ws-a', NULL, ?1, 'h')`,
    )
      .bind(IN)
      .run();
    expect(await readWorkLedger(env.DB, { workspaceId: "ws-a", from: FROM, until: UNTIL })).toMatchObject({
      rivals: 0,
      pages_read: 0,
    });
  });

  it("counts a page once however many times it was read, and each page that was read", async () => {
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, discovered_at) VALUES ('pg-two', 'rv-a', 'https://r.example/pricing', ?1)`,
    )
      .bind(BEFORE)
      .run();
    await snapshot("s1", "ws-a", IN);
    await snapshot("s2", "ws-a", "2026-09-17T10:00:00.000Z");
    await snapshot("s3", "ws-a", IN, "pg-two");
    expect(await readWorkLedger(env.DB, { workspaceId: "ws-a", from: FROM, until: UNTIL })).toMatchObject({
      rivals: 1,
      pages_read: 2,
    });
  });

  it("never counts another workspace's reads or signals", async () => {
    await snapshot("sb", "ws-b", IN);
    await signal({ id: "cb", ws: "ws-b", rival: "rv-b", kind: "change", p: 0.95 });
    expect(await readWorkLedger(env.DB, { workspaceId: "ws-a", from: FROM, until: UNTIL })).toMatchObject({
      pages_read: 0,
      changes_seen: 0,
      changes_told: 0,
    });
  });

  it("turns a quiet week's brief into proof of work, in the headline and the footer", async () => {
    await snapshot("s1", "ws-a", IN);
    await snapshot("s2", "ws-a", "2026-09-17T10:00:00.000Z");
    await signal({ id: "c-small", ws: "ws-a", rival: "rv-a", kind: "change", p: 0.3 });
    const payload = await composeBrief(env.DB, {
      workspaceId: "ws-a",
      schedule: { timezone: "UTC", weekday: 1, hour: 8 },
      week: WEEK,
      readThisFirst: { picks: [], judged: 1, unjudged: false },
    });
    expect(payload.why_line).toBe(
      "Quiet week: we read 1 page across 1 competitor; saw 1 change, none worth your time.",
    );
    const { text } = renderBrief(parseBriefPayload(JSON.stringify(payload)), {
      unsubscribe_url: "https://0509.io/u/t",
      asset_base_url: "https://assets.0509.io",
    });
    expect(text).toContain(
      "This week we read 1 page across 1 competitor; saw 1 change, none worth your time. 1 change judged too small to interrupt you stayed off the brief.",
    );
  });
});
