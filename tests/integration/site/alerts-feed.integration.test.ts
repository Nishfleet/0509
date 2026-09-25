import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { loadShot } from "../../../app/lib/site/alerts-feed.server";

const NOW = new Date("2026-09-24T12:00:00.000Z");

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

async function seedSweptChange(input: {
  ws: string;
  entity: string;
  signal: string;
  observedAt: string;
  before: { exists: boolean };
  after: { exists: boolean };
}): Promise<void> {
  const watch = `watch-${input.entity}`;
  const page = `page-${input.entity}`;
  const url = `https://${input.entity}.example/`;
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, ?, 'on', ?)`,
  )
    .bind(input.entity, input.ws, `${input.entity}.example`, input.entity, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'home', ?)`,
  )
    .bind(page, input.entity, url, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, last_polled_at) VALUES (?, ?, 'src_site_web', ?, ?)`,
  )
    .bind(watch, input.entity, url, input.observedAt)
    .run();
  const prefix = `snapshot/site/${watch}`;
  const payload = {
    page: { role: "home", url },
    before: {
      snapshotId: `${input.signal}-before`,
      textKey: `${prefix}/${input.signal}-before.txt`,
      screenshotKey: input.before.exists ? `${prefix}/${input.signal}-before.png` : null,
    },
    after: {
      snapshotId: `${input.signal}-after`,
      textKey: `${prefix}/${input.signal}-after.txt`,
      screenshotKey: input.after.exists ? `${prefix}/${input.signal}-after.png` : null,
    },
    diffKey: `${prefix}/${input.signal}-after.diff.json`,
    wordsAdded: 3,
    wordsRemoved: 2,
    status: 200,
    transport: "fetch",
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash) VALUES (?, ?, ?, ?, ?, 'h1')`,
    ).bind(`${input.signal}-before`, watch, page, "2026-09-22T02:00:00.000Z", `${prefix}/${input.signal}-before.txt`),
    env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash) VALUES (?, ?, ?, ?, ?, 'h2')`,
    ).bind(`${input.signal}-after`, watch, page, input.observedAt, `${prefix}/${input.signal}-after.txt`),
  ]);
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, aspect, url, evidence_url,
       payload_json, dedup_key, observed_at, last_seen_at)
     VALUES (?, ?, ?, 'src_site_web', ?, ?, 'change', 'home', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.signal,
      input.ws,
      input.entity,
      watch,
      `${input.signal}-after`,
      url,
      url,
      JSON.stringify(payload),
      `${input.signal}-after`,
      input.observedAt,
      input.observedAt,
    )
    .run();
  if (input.before.exists) {
    await env.SNAPSHOTS.put(`${prefix}/${input.signal}-before.png`, `before-${input.signal}`, {
      httpMetadata: { contentType: "image/png" },
    });
  }
  if (input.after.exists) {
    await env.SNAPSHOTS.put(`${prefix}/${input.signal}-after.png`, `after-${input.signal}`, {
      httpMetadata: { contentType: "image/png" },
    });
  }
}

async function seedPublishedChange(input: {
  ws: string;
  entity: string;
  signal: string;
  observedAt: string;
  band: "publish" | "uncertain" | "alert" | "check";
  p: number;
}): Promise<void> {
  const watch = `watch-${input.entity}`;
  const page = `page-${input.entity}`;
  const url = `https://${input.entity}.example/`;
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'self', ?, ?, 'on', ?)`,
  )
    .bind(input.entity, input.ws, `${input.entity}.example`, input.entity, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'home', ?)`,
  )
    .bind(page, input.entity, url, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, last_polled_at) VALUES (?, ?, 'src_site_web', ?, ?)`,
  )
    .bind(watch, input.entity, url, input.observedAt)
    .run();
  await env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash) VALUES (?, ?, ?, ?, ?, 'hp')`,
  )
    .bind(`${input.signal}-prev`, watch, page, "2026-09-22T02:00:00.000Z", `snapshot/site/${watch}/${input.signal}-prev.txt`)
    .run();
  const payload = {
    textKey: `snapshot/text/${input.signal}.txt`,
    previousTextKey: `snapshot/text/${input.signal}-prev.txt`,
    screenshotKey: null,
    previousScreenshotKey: `snapshot/site/${watch}/${input.signal}-prev.png`,
    p: input.p,
    band: input.band,
  };
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, aspect, url, evidence_url,
       payload_json, dedup_key, observed_at, last_seen_at)
     VALUES (?, ?, ?, 'src_site_web', ?, ?, 'change', 'breakage', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.signal,
      input.ws,
      input.entity,
      watch,
      `${input.signal}-prev`,
      url,
      url,
      JSON.stringify(payload),
      input.signal,
      input.observedAt,
      input.observedAt,
    )
    .run();
  await env.SNAPSHOTS.put(`snapshot/site/${watch}/${input.signal}-prev.png`, `before-${input.signal}`, {
    httpMetadata: { contentType: "image/png" },
  });
}

describe("loadShot", () => {
  beforeEach(async () => {
    for (const table of ["signal", "snapshot", "watch", "page", "entity", "workspace", '"user"']) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    const listed = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
    await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));
  });

  it("serves the workspace's own swept before and after", async () => {
    await seedWorkspace("ws-mine", "user-mine");
    await seedSweptChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-1",
      observedAt: NOW.toISOString(),
      before: { exists: true },
      after: { exists: true },
    });
    const before = await loadShot("ws-mine", "sig-1", "before");
    const after = await loadShot("ws-mine", "sig-1", "after");
    expect(await before?.text()).toBe("before-sig-1");
    expect(await after?.text()).toBe("after-sig-1");
  });

  it("returns null when the swept change has no before screenshot key", async () => {
    await seedWorkspace("ws-mine", "user-mine");
    await seedSweptChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-noprev",
      observedAt: NOW.toISOString(),
      before: { exists: false },
      after: { exists: true },
    });
    expect(await loadShot("ws-mine", "sig-noprev", "before")).toBeNull();
    expect(await loadShot("ws-mine", "sig-noprev", "after")).not.toBeNull();
  });

  it("never serves another workspace's signal", async () => {
    await seedWorkspace("ws-mine", "user-mine");
    await seedWorkspace("ws-theirs", "user-theirs");
    await seedSweptChange({
      ws: "ws-theirs",
      entity: "rival",
      signal: "sig-theirs",
      observedAt: NOW.toISOString(),
      before: { exists: true },
      after: { exists: true },
    });
    expect(await loadShot("ws-mine", "sig-theirs", "before")).toBeNull();
    expect(await loadShot("ws-mine", "sig-theirs", "after")).toBeNull();
  });

  it("falls back to the published payload's keys under snapshot/site/", async () => {
    await seedWorkspace("ws-mine", "user-mine");
    await seedPublishedChange({
      ws: "ws-mine",
      entity: "me",
      signal: "sig-pub",
      observedAt: NOW.toISOString(),
      band: "publish",
      p: 0.95,
    });
    const before = await loadShot("ws-mine", "sig-pub", "before");
    expect(await before?.text()).toBe("before-sig-pub");
    expect(await loadShot("ws-mine", "sig-pub", "after")).toBeNull();
  });
});
