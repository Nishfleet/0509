import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readScoredSignals } from "../../../app/lib/data/signal.server";

/**
 * The biggest-move week slice against the real D1 the deploy ships: one
 * competitor's signals in one window, each with the bucket the nightly score
 * would count it under, its source's platform and reliability, newest first.
 */

const SINCE = "2026-09-15T00:00:00.000Z";
const UNTIL = "2026-09-22T00:00:00.000Z";
const SEEDED_AT = "2026-09-21T00:00:00.000Z";

interface Seeded {
  workspaceId: string;
  entityA: string;
  ids: Record<
    | "changeHigh"
    | "changeMid"
    | "mentionHigh"
    | "mentionMid"
    | "mentionLow"
    | "hiring"
    | "tombstoned"
    | "before"
    | "atUntil"
    | "otherEntity",
    string
  >;
}

let seededRuns = 0;

async function seed(): Promise<Seeded> {
  seededRuns += 1;
  const run = String(seededRuns);
  const workspaceId = `biggest-move-t-ws-${run}`;
  const userId = `biggest-move-t-user-${run}`;
  const entityA = `biggest-move-t-ent-a-${run}`;
  const entityB = `biggest-move-t-ent-b-${run}`;
  const srcMentions = `biggest-move-t-src-mentions-${run}`;
  const srcSite = `biggest-move-t-src-site-${run}`;
  const srcHiring = `biggest-move-t-src-hiring-${run}`;
  const ids: Seeded["ids"] = {
    changeHigh: `biggest-move-t-sig-change-high-${run}`,
    changeMid: `biggest-move-t-sig-change-mid-${run}`,
    mentionHigh: `biggest-move-t-sig-mention-high-${run}`,
    mentionMid: `biggest-move-t-sig-mention-mid-${run}`,
    mentionLow: `biggest-move-t-sig-mention-low-${run}`,
    hiring: `biggest-move-t-sig-hiring-${run}`,
    tombstoned: `biggest-move-t-sig-tombstoned-${run}`,
    before: `biggest-move-t-sig-before-${run}`,
    atUntil: `biggest-move-t-sig-at-until-${run}`,
    otherEntity: `biggest-move-t-sig-b-${run}`,
  };

  const mention = (
    id: string,
    dedupKey: string,
    observedAt: string,
  ): D1PreparedStatement =>
    env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, dedup_key, observed_at)
       VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?6, ?7, ?8, ?9)`,
    ).bind(
      id,
      workspaceId,
      entityA,
      srcMentions,
      `Mention ${id}`,
      `https://example.test/${dedupKey}`,
      `biggest-move-t-hash-${dedupKey}`,
      dedupKey,
      observedAt,
    );

  const change = (id: string, dedupKey: string, observedAt: string): D1PreparedStatement =>
    env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, aspect, dedup_key, observed_at)
       VALUES (?1, ?2, ?3, ?4, 'change', ?5, ?6, 'copy', ?7, ?8)`,
    ).bind(
      id,
      workspaceId,
      entityA,
      srcSite,
      `Change ${id}`,
      `https://a-${run}.example/pricing`,
      dedupKey,
      observedAt,
    );

  const hiring = (
    id: string,
    entityId: string,
    dedupKey: string,
    observedAt: string,
    tombstoned = 0,
  ): D1PreparedStatement =>
    env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, dedup_key, observed_at, is_tombstoned)
       VALUES (?1, ?2, ?3, ?4, 'hiring', ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      id,
      workspaceId,
      entityId,
      srcHiring,
      `Role ${id}`,
      `https://jobs.example.test/${dedupKey}`,
      dedupKey,
      observedAt,
      tombstoned,
    );

  const verdict = (
    id: string,
    questionId: string,
    inputHash: string,
    signalId: string,
    p: number,
  ): D1PreparedStatement =>
    env.DB.prepare(
      `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(id, workspaceId, questionId, inputHash, signalId, p, SEEDED_AT);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?1, 'Biggest Move Test', ?2, 1, ?3, ?3)`,
    ).bind(userId, `biggest-move-t-${run}@example.test`, SEEDED_AT),
    env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at)
       VALUES (?1, 'Biggest Move Test', ?2, 'UTC', ?3)`,
    ).bind(workspaceId, userId, SEEDED_AT),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
       VALUES (?1, ?2, 'competitor', ?3, 'Brand A', 'on', ?4)`,
    ).bind(entityA, workspaceId, `a-${run}.example`, SEEDED_AT),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
       VALUES (?1, ?2, 'competitor', ?3, 'Brand B', 'on', ?4)`,
    ).bind(entityB, workspaceId, `b-${run}.example`, SEEDED_AT),
    env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
       VALUES (?1, ?2, 'mentions', 'reddit', ?3, 'official_api')`,
    ).bind(srcMentions, `key-${srcMentions}`, `plugin-${srcMentions}`),
    env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
       VALUES (?1, ?2, 'site', 'web', ?3, 'scraped_page')`,
    ).bind(srcSite, `key-${srcSite}`, `plugin-${srcSite}`),
    env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
       VALUES (?1, ?2, 'hiring', 'greenhouse', ?3, 'rss')`,
    ).bind(srcHiring, `key-${srcHiring}`, `plugin-${srcHiring}`),
    change(ids.changeHigh, `dedup-change-high-${run}`, "2026-09-16T10:00:00.000Z"),
    change(ids.changeMid, `dedup-change-mid-${run}`, "2026-09-16T11:00:00.000Z"),
    mention(ids.mentionHigh, `dedup-mention-high-${run}`, "2026-09-17T10:00:00.000Z"),
    mention(ids.mentionMid, `dedup-mention-mid-${run}`, "2026-09-17T11:00:00.000Z"),
    mention(ids.mentionLow, `dedup-mention-low-${run}`, "2026-09-17T12:00:00.000Z"),
    hiring(ids.hiring, entityA, `dedup-hiring-${run}`, "2026-09-18T10:00:00.000Z"),
    hiring(ids.tombstoned, entityA, `dedup-tombstoned-${run}`, "2026-09-18T11:00:00.000Z", 1),
    hiring(ids.before, entityA, `dedup-before-${run}`, "2026-09-10T10:00:00.000Z"),
    hiring(ids.atUntil, entityA, `dedup-at-until-${run}`, UNTIL),
    hiring(ids.otherEntity, entityB, `dedup-b-${run}`, "2026-09-18T12:00:00.000Z"),
    verdict(`biggest-move-t-jev-change-high-${run}`, "noteworthy_change", `ih-change-high-${run}`, ids.changeHigh, 0.95),
    verdict(`biggest-move-t-jev-change-mid-${run}`, "noteworthy_change", `ih-change-mid-${run}`, ids.changeMid, 0.5),
    verdict(`biggest-move-t-jev-mention-high-${run}`, "mention_matters", `ih-mention-high-${run}`, ids.mentionHigh, 0.95),
    verdict(`biggest-move-t-jev-mention-mid-${run}`, "mention_matters", `ih-mention-mid-${run}`, ids.mentionMid, 0.5),
    verdict(`biggest-move-t-jev-mention-low-${run}`, "mention_matters", `ih-mention-low-${run}`, ids.mentionLow, 0.05),
  ]);

  return { workspaceId, entityA, ids };
}

function readA(seeded: Seeded): ReturnType<typeof readScoredSignals> {
  return readScoredSignals({
    workspaceId: seeded.workspaceId,
    entityId: seeded.entityA,
    since: SINCE,
    until: UNTIL,
  });
}

describe("readScoredSignals against real D1", () => {
  it("returns each scored signal with its bucket, platform and reliability, newest first", async () => {
    const seeded = await seed();
    const rows = await readA(seeded);

    expect(rows.map((row) => row.id)).toEqual([
      seeded.ids.hiring,
      seeded.ids.mentionMid,
      seeded.ids.mentionHigh,
      seeded.ids.changeHigh,
    ]);

    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(seeded.ids.changeHigh)).toMatchObject({
      kind: "change",
      bucket: "site_change_noteworthy",
      platform: "web",
      reliability: "scraped_page",
      observedAt: "2026-09-16T10:00:00.000Z",
    });
    expect(byId.get(seeded.ids.mentionHigh)).toMatchObject({
      kind: "mention",
      bucket: "mention_matters",
      platform: "reddit",
      reliability: "official_api",
    });
    expect(byId.get(seeded.ids.mentionMid)).toMatchObject({
      kind: "mention",
      bucket: "mention_normal",
    });
    expect(byId.get(seeded.ids.hiring)).toMatchObject({
      kind: "hiring",
      bucket: "hiring_new_role",
      platform: "greenhouse",
      reliability: "rss",
    });
  });

  it("drops a sub-threshold verdict, a tombstone, out-of-window rows and the other brand's rows", async () => {
    const seeded = await seed();
    const ids = (await readA(seeded)).map((row) => row.id);

    expect(ids).not.toContain(seeded.ids.changeMid);
    expect(ids).not.toContain(seeded.ids.mentionLow);
    expect(ids).not.toContain(seeded.ids.tombstoned);
    expect(ids).not.toContain(seeded.ids.before);
    expect(ids).not.toContain(seeded.ids.atUntil);
    expect(ids).not.toContain(seeded.ids.otherEntity);
  });
});
