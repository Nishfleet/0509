import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { loadAlertsFeed } from "../../../app/lib/site/alerts-feed.server";
import { parseChangeShotKeys, parsePublishedChange } from "../../../app/lib/site-change";
import { readChangeShot } from "../../../app/lib/site-changes.server";

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

async function seedEntity(ws: string, entity: string, role: "self" | "competitor"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, ?, ?, ?, 'on', ?)`,
  )
    .bind(entity, ws, role, `${entity}.example`, entity, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'home', ?)`,
  )
    .bind(`page-${entity}`, entity, `https://${entity}.example/`, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, last_polled_at) VALUES (?, ?, 'src_site_web', ?, ?)`,
  )
    .bind(`watch-${entity}`, entity, `https://${entity}.example/`, NOW.toISOString())
    .run();
}

async function seedPublishedChange(input: {
  ws: string;
  entity: string;
  signal: string;
  observedAt: string;
  band: "publish" | "uncertain" | "alert" | "check";
  p: number;
  beforeKey: string | null;
  afterKey: string | null;
  title?: string;
  summary?: string;
}): Promise<void> {
  const url = `https://${input.entity}.example/`;
  const payload = {
    textKey: `snapshot/text/${input.signal}.txt`,
    previousTextKey: `snapshot/text/${input.signal}-prev.txt`,
    screenshotKey: input.afterKey,
    previousScreenshotKey: input.beforeKey ?? "",
    p: input.p,
    band: input.band,
  };
  await env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(`snap-${input.signal}`, `watch-${input.entity}`, `page-${input.entity}`, input.observedAt, `snapshot/site/watch-${input.entity}/${input.signal}.txt`, 'hp')
    .run();
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title, summary, aspect, url, evidence_url,
       payload_json, dedup_key, observed_at, last_seen_at)
     VALUES (?, ?, ?, 'src_site_web', ?, ?, 'change', ?, ?, 'breakage', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.signal,
      input.ws,
      input.entity,
      `watch-${input.entity}`,
      `snap-${input.signal}`,
      input.title ?? `${input.band} change`,
      input.summary ?? "The page answered differently.",
      url,
      url,
      JSON.stringify(payload),
      input.signal,
      input.observedAt,
      input.observedAt,
    )
    .run();
}

async function seedAlert(input: {
  ws: string;
  entity: string;
  signal: string;
  severity: "high" | "normal";
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO alert (id, workspace_id, entity_id, signal_id, kind, severity, title, status, created_at)
     VALUES (?, ?, ?, ?, 'own_site_broken', ?, 'Your site looks broken', 'unread', ?)`,
  )
    .bind(`alert-${input.signal}`, input.ws, input.entity, input.signal, input.severity, NOW.toISOString())
    .run();
}

async function putShot(key: string, body: string): Promise<void> {
  await env.SNAPSHOTS.put(key, body, { httpMetadata: { contentType: "image/png" } });
}

async function reset(): Promise<void> {
  for (const table of ["alert", "incident", "signal", "snapshot", "watch", "page", "entity", "workspace", '"user"']) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
  const listed = await env.SNAPSHOTS.list({ prefix: "snapshot/" });
  await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));
}

describe("the before-and-after feed", () => {
  beforeEach(async () => {
    await reset();
    await seedWorkspace("ws-mine", "user-mine");
    await seedEntity("ws-mine", "rival", "competitor");
    await seedWorkspace("ws-theirs", "user-theirs");
    await seedEntity("ws-theirs", "other", "competitor");
  });

  it("reads only its own workspace's signals", async () => {
    await seedPublishedChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-mine",
      observedAt: NOW.toISOString(),
      band: "publish",
      p: 0.95,
      beforeKey: "snapshot/site/watch-rival/sig-mine-before.png",
      afterKey: "snapshot/site/watch-rival/sig-mine-after.png",
    });
    await seedPublishedChange({
      ws: "ws-theirs",
      entity: "other",
      signal: "sig-theirs",
      observedAt: NOW.toISOString(),
      band: "publish",
      p: 0.95,
      beforeKey: "snapshot/site/watch-other/sig-theirs-before.png",
      afterKey: "snapshot/site/watch-other/sig-theirs-after.png",
    });

    const feed = await loadAlertsFeed("ws-mine", NOW);
    expect(feed.map((item) => item.signalId)).toEqual(["sig-mine"]);
  });

  it("reads a real screenshot pair out of R2 and reports the missing one as absent", async () => {
    const beforeKey = "snapshot/site/watch-rival/sig-pub-before.png";
    await putShot(beforeKey, "before-sig-pub");
    await seedPublishedChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-pub",
      observedAt: NOW.toISOString(),
      band: "publish",
      p: 0.95,
      beforeKey,
      afterKey: null,
    });

    const [item] = await loadAlertsFeed("ws-mine", NOW);
    expect(item?.hasBefore).toBe(true);
    expect(item?.hasAfter).toBe(false);
    expect(await readChangeShot("ws-mine", "sig-pub", "before")).not.toBeNull();
    expect(await readChangeShot("ws-mine", "sig-pub", "after")).toBeNull();
  });

  it("refuses a payload key that is not under snapshot/site/", async () => {
    await seedPublishedChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-escape",
      observedAt: NOW.toISOString(),
      band: "publish",
      p: 0.95,
      beforeKey: "snapshot/text/sig-escape.txt",
      afterKey: "secret/sig-escape.png",
    });

    const [item] = await loadAlertsFeed("ws-mine", NOW);
    expect(item?.hasBefore).toBe(false);
    expect(item?.hasAfter).toBe(false);
    expect(await readChangeShot("ws-mine", "sig-escape", "before")).toBeNull();
    expect(await readChangeShot("ws-mine", "sig-escape", "after")).toBeNull();
  });

  it("puts own-site alerts first, high before normal, then publish before uncertain, then newest", async () => {
    await seedPublishedChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-publish-old",
      observedAt: "2026-09-20T12:00:00.000Z",
      band: "publish",
      p: 0.99,
      beforeKey: null,
      afterKey: null,
    });
    await seedPublishedChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-publish-new",
      observedAt: NOW.toISOString(),
      band: "publish",
      p: 0.99,
      beforeKey: null,
      afterKey: null,
    });
    await seedPublishedChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-uncertain",
      observedAt: NOW.toISOString(),
      band: "uncertain",
      p: 0.5,
      beforeKey: null,
      afterKey: null,
    });
    await seedPublishedChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-alert-low",
      observedAt: NOW.toISOString(),
      band: "alert",
      p: 0.7,
      beforeKey: null,
      afterKey: null,
    });
    await seedAlert({ ws: "ws-mine", entity: "rival", signal: "sig-alert-low", severity: "normal" });
    await seedPublishedChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-alert-high",
      observedAt: NOW.toISOString(),
      band: "alert",
      p: 0.95,
      beforeKey: null,
      afterKey: null,
    });
    await seedAlert({ ws: "ws-mine", entity: "rival", signal: "sig-alert-high", severity: "high" });

    const feed = await loadAlertsFeed("ws-mine", NOW);
    expect(feed.map((item) => item.signalId)).toEqual([
      "sig-alert-high",
      "sig-alert-low",
      "sig-publish-new",
      "sig-publish-old",
      "sig-uncertain",
    ]);
    expect(feed.slice(0, 2).map((item) => ({ isAlert: item.isAlert, severity: item.severity }))).toEqual([
      { isAlert: true, severity: "high" },
      { isAlert: true, severity: "normal" },
    ]);
  });

  it("leaves a signal older than thirty days out of the feed", async () => {
    await seedPublishedChange({
      ws: "ws-mine",
      entity: "rival",
      signal: "sig-old",
      observedAt: "2026-07-01T12:00:00.000Z",
      band: "publish",
      p: 0.99,
      beforeKey: null,
      afterKey: null,
    });
    expect(await loadAlertsFeed("ws-mine", NOW)).toEqual([]);
  });
});

describe("the change payload shape", () => {
  it("reads the Jev publishChange keys and its band", () => {
    const json = JSON.stringify({
      textKey: "snapshot/text/a.txt",
      previousTextKey: "snapshot/text/b.txt",
      screenshotKey: null,
      previousScreenshotKey: "snapshot/site/w/b.png",
      p: 0.4,
      band: "uncertain",
    });
    expect(parsePublishedChange(json)).toEqual({
      before: "snapshot/site/w/b.png",
      after: null,
      band: "uncertain",
    });
    expect(parseChangeShotKeys(json)?.band).toBe("uncertain");
  });

  it("reads the swept engine keys and reports the publish band", () => {
    const json = JSON.stringify({
      page: { role: "home", url: "https://rival.example/" },
      before: { snapshotId: "b", screenshotKey: "snapshot/site/w/before.png" },
      after: { snapshotId: "a", screenshotKey: "snapshot/site/w/after.png" },
      diffKey: null,
      wordsAdded: 1,
      wordsRemoved: 0,
    });
    expect(parseChangeShotKeys(json)).toEqual({
      before: "snapshot/site/w/before.png",
      after: "snapshot/site/w/after.png",
      band: "publish",
    });
    expect(parsePublishedChange(json)).toBeNull();
  });

  it("returns null for an unreadable payload instead of guessing", () => {
    expect(parseChangeShotKeys("{")).toBeNull();
    expect(parseChangeShotKeys(JSON.stringify({ unrelated: true }))).toBeNull();
  });
});
