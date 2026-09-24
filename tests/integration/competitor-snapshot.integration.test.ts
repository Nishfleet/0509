import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readCompetitorSnapshot } from "../../app/lib/competitor-snapshot.server";

/**
 * One brand's last 7 days as the brief sees it: the counted signals joined to
 * their verdicts, its newest frozen rank, and which of its sources answered
 * in the window (0509#5032, parent #4106). The reader only joins what the
 * standing worker already counted — it must never recompute a judgment.
 */

const NOW = new Date("2026-09-24T12:00:00.000Z");

async function seedOwner(ws: string, user: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Owner', ?2, 1, ?3, ?3)`,
  )
    .bind(user, `${user}@0509.io`, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?1, ?2, ?3, 'UTC', 1, 8, ?4)`,
  )
    .bind(ws, ws, user, NOW.toISOString())
    .run();
}

async function seedEntity(ws: string, id: string, domain: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)`,
  )
    .bind(id, ws, domain, name, NOW.toISOString())
    .run();
}

async function seedSource(id: string, kind: "ads" | "site", platform: string, pluginKey: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
     VALUES (?1, ?2, ?3, ?4, ?5, 'best_effort', 1, '{}')`,
  )
    .bind(id, `${id}-key`, kind, platform, pluginKey)
    .run();
}

async function seedWatch(id: string, entityId: string, sourceId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, is_active, last_polled_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
  )
    .bind(id, entityId, sourceId, `https://${entityId}.example/`, NOW.toISOString())
    .run();
}

async function seedSiteSnapshot(id: string, watchId: string, fetchedAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(id, watchId, fetchedAt, `hash-${id}`)
    .run();
}

async function seedStanding(id: string, ws: string, entityId: string, weekStartAt: string, rank: number, movement: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7)`,
  )
    .bind(id, ws, entityId, weekStartAt, rank, movement, weekStartAt)
    .run();
}

async function seedSignal(
  id: string,
  ws: string,
  entityId: string,
  sourceId: string,
  fields: {
    kind: "ad" | "mention" | "change" | "hiring";
    aspect?: string;
    publishedAt?: string | null;
    observedAt: string;
  },
): Promise<void> {
  const columns: string[] = ["id", "workspace_id", "entity_id", "source_id", "kind", "dedup_key", "observed_at"];
  const values: (string | number | null)[] = [id, ws, entityId, sourceId, fields.kind, `dedup-${id}`, fields.observedAt];
  if (fields.aspect !== undefined) {
    columns.push("aspect");
    values.push(fields.aspect);
  }
  if (fields.publishedAt !== undefined) {
    columns.push("published_at");
    values.push(fields.publishedAt);
  }
  const placeholders = values.map((_, index) => `?${index + 1}`).join(", ");
  await env.DB.prepare(
    `INSERT INTO signal (${columns.join(", ")}) VALUES (${placeholders})`,
  )
    .bind(...values)
    .run();
}

async function seedVerdict(
  id: string,
  ws: string,
  questionId: string,
  signalId: string,
  p: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, ws, questionId, `hash-${id}`, signalId, p, NOW.toISOString())
    .run();
}

beforeEach(async () => {
  for (const table of ["signal", "snapshot", "watch", "source", "entity", "standing", "workspace", '"user"', "jev_verdict"]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
});

describe("readCompetitorSnapshot against real D1", () => {
  it("counts only the verdicts that crossed, returns the newest rank and the answered sources", async () => {
    const ws = "ws-snap";
    const user = "user-snap";
    const entity = "snap-rival";
    const sourceAds = "snap-src-ads";
    const sourceSite = "snap-src-site";
    const watchAds = "snap-watch-ads";
    const watchSite = "snap-watch-site";
    const snapshotId = "snap-shot-1";

    await seedOwner(ws, user);
    await seedEntity(ws, entity, `${entity}.example`, "Rival");
    await seedSource(sourceAds, "ads", "meta", "snap-ads-meta");
    await seedSource(sourceSite, "site", "web", "snap-site-web");
    await seedWatch(watchAds, entity, sourceAds);
    await seedWatch(watchSite, entity, sourceSite);
    await seedSiteSnapshot(snapshotId, watchSite, "2026-09-22T08:00:00.000Z");

    await seedSignal("snap-sig-noteworthy", ws, entity, sourceSite, {
      kind: "change",
      aspect: "home",
      observedAt: "2026-09-20T10:00:00.000Z",
    });
    await seedVerdict("snap-jev-noteworthy", ws, "noteworthy_change", "snap-sig-noteworthy", 0.95);

    await seedSignal("snap-sig-low", ws, entity, sourceSite, {
      kind: "change",
      aspect: "pricing",
      observedAt: "2026-09-21T10:00:00.000Z",
    });
    await seedVerdict("snap-jev-low", ws, "noteworthy_change", "snap-sig-low", 0.5);

    await seedSignal("snap-sig-copy", ws, entity, sourceAds, {
      kind: "ad",
      aspect: "headline",
      observedAt: "2026-09-22T10:00:00.000Z",
    });

    await seedSignal("snap-sig-hiring-outside", ws, entity, sourceAds, {
      kind: "hiring",
      observedAt: "2026-09-14T10:00:00.000Z",
    });

    await seedStanding("snap-standing-1", ws, entity, "2026-09-21T00:00:00.000Z", 3, 1);

    const snapshot = await readCompetitorSnapshot(ws, entity, NOW);

    expect(snapshot.standing).toEqual({ rank: 3, movement: 1 });
    expect(snapshot.counts).toEqual({
      newCreatives: 0,
      copyChanges: 1,
      noteworthyChanges: 1,
      mentionsThatMatter: 0,
      newRoles: 0,
    });
    const byKey = new Map(snapshot.sources.map((source) => [source.kind, source]));
    expect(byKey.get("site")?.answered).toBe(true);
    expect(byKey.get("site")?.name).toBe("Your site checks source");
    expect(byKey.get("ads")?.answered).toBe(false);
    expect(byKey.get("ads")?.name).toBe("Meta ads");
  });

  it("returns zero counts, null standing and no sources for an unrelated workspace", async () => {
    const wsMine = "ws-snap-mine";
    const wsOther = "ws-snap-other";
    const userMine = "user-snap-mine";
    const userOther = "user-snap-other";
    const entityMine = "snap-mine-rival";
    const sourceAds = "snap-other-src-ads";
    const sourceSite = "snap-other-src-site";
    const watchAds = "snap-other-watch-ads";
    const watchSite = "snap-other-watch-site";

    await seedOwner(wsMine, userMine);
    await seedOwner(wsOther, userOther);
    await seedEntity(wsMine, entityMine, `${entityMine}.example`, "Mine");
    await seedSource(sourceAds, "ads", "meta", "snap-other-ads-meta");
    await seedSource(sourceSite, "site", "web", "snap-other-site-web");
    await seedWatch(watchAds, entityMine, sourceAds);
    await seedWatch(watchSite, entityMine, sourceSite);
    await seedSignal("snap-other-sig-change", wsMine, entityMine, sourceSite, {
      kind: "change",
      aspect: "home",
      observedAt: "2026-09-20T10:00:00.000Z",
    });
    await seedVerdict("snap-other-jev", wsMine, "noteworthy_change", "snap-other-sig-change", 0.95);
    await seedStanding("snap-other-standing", wsMine, entityMine, "2026-09-21T00:00:00.000Z", 2, 0);

    const snapshot = await readCompetitorSnapshot(wsOther, entityMine, NOW);

    expect(snapshot.standing).toBeNull();
    expect(snapshot.counts).toEqual({
      newCreatives: 0,
      copyChanges: 0,
      noteworthyChanges: 0,
      mentionsThatMatter: 0,
      newRoles: 0,
    });
    expect(snapshot.sources).toEqual([]);
  });
});
