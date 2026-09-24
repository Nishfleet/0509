import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readAgentAlerts } from "../../../app/lib/agent/read.server";
import { readCompetitorPage } from "../../../app/lib/competitor-page.server";
import { readChangeShot, readSiteChangeViews } from "../../../app/lib/site-changes.server";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const SINCE = "2026-08-01T00:00:00.000Z";

async function seedWorkspace(ws: string, user: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(user, `${user}@0509.io`, NOW.toISOString(), NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(ws, ws, user, NOW.toISOString())
    .run();
}

async function seedChange(input: {
  ws: string;
  entity: string;
  name: string;
  role: "self" | "competitor";
  state: "on" | "off";
  signal: string;
  observedAt: string;
}): Promise<void> {
  const watch = `watch-${input.entity}`;
  const page = `page-${input.entity}`;
  const url = `https://${input.entity}.example/`;
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(input.entity, input.ws, input.role, `${input.entity}.example`, input.name, input.state, SINCE)
    .run();
  await env.DB.prepare(`INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'home', ?)`)
    .bind(page, input.entity, url, SINCE)
    .run();
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, last_polled_at) VALUES (?, ?, 'src_site_web', ?, ?)`,
  )
    .bind(watch, input.entity, url, input.observedAt)
    .run();
  const prefix = `snapshot/site/${watch}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash) VALUES (?, ?, ?, ?, ?, 'h1')`,
    ).bind(`${input.signal}-before`, watch, page, "2026-09-22T02:00:00.000Z", `${prefix}/${input.signal}-before.txt`),
    env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash) VALUES (?, ?, ?, ?, ?, 'h2')`,
    ).bind(`${input.signal}-after`, watch, page, input.observedAt, `${prefix}/${input.signal}-after.txt`),
  ]);
  const payload = {
    page: { role: "home", url },
    before: {
      snapshotId: `${input.signal}-before`,
      textKey: `${prefix}/${input.signal}-before.txt`,
      screenshotKey: `${prefix}/${input.signal}-before.png`,
    },
    after: {
      snapshotId: `${input.signal}-after`,
      textKey: `${prefix}/${input.signal}-after.txt`,
      screenshotKey: `${prefix}/${input.signal}-after.png`,
    },
    diffKey: `${prefix}/${input.signal}-after.diff.json`,
    wordsAdded: 3,
    wordsRemoved: 2,
    status: 200,
    transport: "fetch",
  };
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, aspect, url, evidence_url,
       payload_json, dedup_key, observed_at, last_seen_at)
     VALUES (?1, ?2, ?3, 'src_site_web', ?4, ?5, 'change', 'home', ?6, ?6, ?7, ?5, ?8, ?8)`,
  )
    .bind(input.signal, input.ws, input.entity, watch, `${input.signal}-after`, url, JSON.stringify(payload), input.observedAt)
    .run();
  await env.SNAPSHOTS.put(`${prefix}/${input.signal}-before.png`, `before-${input.signal}`, {
    httpMetadata: { contentType: "image/png" },
  });
  await env.SNAPSHOTS.put(`${prefix}/${input.signal}-after.png`, `after-${input.signal}`, {
    httpMetadata: { contentType: "image/png" },
  });
  await env.SNAPSHOTS.put(
    payload.diffKey,
    JSON.stringify({
      hunks: [{ lines: [" Welcome.", `-Plans from $10 at ${input.name}.`, `+Plans from $12 at ${input.name}.`] }],
    }),
  );
}

describe("site changes a customer can see", () => {
  beforeEach(async () => {
    for (const table of ["signal", "snapshot", "watch", "page", "entity", "workspace", '"user"']) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    const listed = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
    await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));

    await seedWorkspace("ws-mine", "user-mine");
    await seedWorkspace("ws-other", "user-other");
    await seedChange({ ws: "ws-mine", entity: "rival", name: "Rival", role: "competitor", state: "on", signal: "sig-rival", observedAt: "2026-09-24T02:10:00.000Z" });
    await seedChange({ ws: "ws-mine", entity: "paused", name: "Paused", role: "competitor", state: "off", signal: "sig-paused", observedAt: "2026-09-23T02:10:00.000Z" });
    await seedChange({ ws: "ws-mine", entity: "mine", name: "Mine", role: "self", state: "on", signal: "sig-mine", observedAt: "2026-09-20T02:10:00.000Z" });
    await seedChange({ ws: "ws-other", entity: "theirs", name: "Theirs", role: "competitor", state: "on", signal: "sig-theirs", observedAt: "2026-09-24T03:10:00.000Z" });
  });

  it("lists the workspace's on brands and its own site, newest first, with the mark and both captures", async () => {
    const views = await readSiteChangeViews({ workspaceId: "ws-mine", entityId: null, since: SINCE, limit: 30 });

    expect(views.map((view) => view.id)).toEqual(["sig-rival", "sig-mine"]);
    const [rival, mine] = views;
    expect(rival?.headline).toBe("Rival changed its homepage");
    expect(rival?.mark).toEqual({ removed: "Plans from $10 at Rival.", added: "Plans from $12 at Rival." });
    expect(rival?.sentence).toBe("3 words added, 2 removed.");
    expect(rival?.before).toEqual({ src: "/app/changes/sig-rival/before", capturedAt: "2026-09-22 02:00 UTC" });
    expect(rival?.after).toEqual({ src: "/app/changes/sig-rival/after", capturedAt: "2026-09-24 02:10 UTC" });
    expect(mine?.headline).toBe("Your homepage changed");
  });

  it("keeps a paused brand's history on its own page", async () => {
    const page = await readCompetitorPage("ws-mine", "paused", NOW);
    expect(page?.changes.map((view) => view.id)).toEqual(["sig-paused"]);
    expect(page?.weekCount).toBe(1);
    expect(page?.biggestId).toBe("sig-paused");
    expect(page?.watch).toEqual({ pages: 1, lastPolledAt: "2026-09-23T02:10:00.000Z" });
  });

  it("never shows another workspace's competitor, its changes or its screenshots", async () => {
    expect(await readCompetitorPage("ws-mine", "theirs", NOW)).toBeNull();
    expect(await readSiteChangeViews({ workspaceId: "ws-mine", entityId: "theirs", since: SINCE, limit: 30 })).toEqual([]);
    expect(await readChangeShot("ws-mine", "sig-theirs", "after")).toBeNull();
    expect(await readCompetitorPage("ws-mine", "mine", NOW)).toBeNull();
  });

  it("serves the workspace's own before and after screenshots", async () => {
    const before = await readChangeShot("ws-mine", "sig-rival", "before");
    const after = await readChangeShot("ws-mine", "sig-rival", "after");
    expect(await before?.text()).toBe("before-sig-rival");
    expect(await after?.text()).toBe("after-sig-rival");
    expect(after?.httpMetadata?.contentType).toBe("image/png");
    expect(await readChangeShot("ws-mine", "no-such-signal", "after")).toBeNull();
  });

  it("gives agents the same changes in list_alerts", async () => {
    const recent = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    await env.DB.prepare("UPDATE signal SET observed_at = ? WHERE id = 'sig-rival'").bind(recent(1)).run();
    await env.DB.prepare("UPDATE signal SET observed_at = ? WHERE id = 'sig-mine'").bind(recent(2)).run();
    const { alerts } = await readAgentAlerts("ws-mine");
    const changes = alerts.filter((alert) => alert.kind === "site_change");
    expect(changes.map((alert) => alert.title)).toEqual(["Rival changed its homepage", "Your homepage changed"]);
    expect(changes[0]?.body).toContain('Now: "Plans from $12 at Rival."');
  });
});
