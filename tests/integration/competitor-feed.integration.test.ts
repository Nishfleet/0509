import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import {
  insertMention,
  readEntityDevelopments,
  readUnjudgedMentions,
  resolveUnjudgedMention,
} from "../../app/lib/data/signal.server";
import { insertVerdict, linkVerdictsStatement } from "../../app/lib/data/jev_verdict.server";
import { isAboutBrand } from "../../app/lib/jev/thresholds";

const SINCE = "2026-09-01T00:00:00.000Z";

interface Fixture {
  workspaceId: string;
  otherWorkspaceId: string;
  entityId: string;
  domain: string;
  priced: string;
  copy: string;
  hired: string;
  ad: string;
  mentioned: string;
  tombstoned: string;
  stale: string;
  foreign: string;
}

const created: { workspaces: string[] }[] = [];

async function seed(): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const userId = `user-feed-${suffix}`;
  const workspaceId = `ws-feed-${suffix}`;
  const otherWorkspaceId = `ws-feed-b-${suffix}`;
  const entityId = `ent-rival-${suffix}`;
  const otherEntityId = `ent-rival-b-${suffix}`;
  const domain = `rival-${suffix}.example`;
  const priced = `sig-fed-price-${suffix}`;
  const copy = `sig-fed-copy-${suffix}`;
  const hired = `sig-fed-hire-${suffix}`;
  const ad = `sig-fed-ad-${suffix}`;
  const mentioned = `sig-fed-mention-${suffix}`;
  const tombstoned = `sig-fed-tomb-${suffix}`;
  const stale = `sig-fed-stale-${suffix}`;
  const foreign = `sig-fed-far-${suffix}`;
  created.push({ workspaces: [workspaceId, otherWorkspaceId] });

  const signal =
    "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, title, summary, url, canonical_url, url_hash, dedup_key, observed_at, is_tombstoned) " +
    "VALUES (?1, ?2, ?3, 'src_site_web', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)";
  const row = (
    id: string,
    workspace: string,
    entity: string,
    kind: string,
    aspect: string | null,
    title: string | null,
    summary: string | null,
    url: string | null,
    observedAt: string,
    isTombstoned = false,
  ) =>
    env.DB.prepare(signal).bind(
      id,
      workspace,
      entity,
      kind,
      aspect,
      title,
      summary,
      url,
      kind === "mention" ? url : null,
      kind === "mention" ? url : null,
      `${id}:dedup`,
      observedAt,
      isTombstoned ? 1 : 0,
    );

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(userId, "Feed Reader", `${userId}@example.com`, SINCE),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, ?2, ?3, 'UTC', 1, 8, ?4)",
    ).bind(workspaceId, "Feed", userId, SINCE),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, ?2, ?3, 'UTC', 1, 8, ?4)",
    ).bind(otherWorkspaceId, "Feed other", userId, SINCE),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5)",
    ).bind(entityId, workspaceId, `rival-${suffix}.example`, "Rival", SINCE),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5)",
    ).bind(otherEntityId, otherWorkspaceId, `rival-b-${suffix}.example`, "Rival B", SINCE),
    row(
      priced,
      workspaceId,
      entityId,
      "change",
      "home",
      "Rebuilt the pricing page",
      "Wordier headline",
      `https://rival-${suffix}.example/pricing`,
      "2026-09-06T01:00:00.000Z",
    ),
    row(
      copy,
      workspaceId,
      entityId,
      "change",
      "theme",
      "New homepage hero",
      null,
      `https://rival-${suffix}.example/`,
      "2026-09-05T02:00:00.000Z",
    ),
    row(
      hired,
      workspaceId,
      entityId,
      "hiring",
      null,
      "Staff engineer",
      "Remote · Infrastructure",
      `https://rival-${suffix}.example/careers`,
      "2026-09-04T03:00:00.000Z",
    ),
    row(
      ad,
      workspaceId,
      entityId,
      "ad",
      null,
      "Launch week cut",
      "Meta ad library",
      `https://rival-${suffix}.example/`,
      "2026-09-03T04:00:00.000Z",
    ),
    row(
      mentioned,
      workspaceId,
      entityId,
      "mention",
      null,
      "HN thread about the launch",
      "110 points",
      "https://news.ycombinator.com/item?id=1",
      "2026-09-02T05:00:00.000Z",
    ),
    row(
      tombstoned,
      workspaceId,
      entityId,
      "hiring",
      null,
      "Dismissed role",
      null,
      `https://rival-${suffix}.example/careers`,
      "2026-09-02T06:00:00.000Z",
      true,
    ),
    row(
      stale,
      workspaceId,
      entityId,
      "ad",
      null,
      "Quarter-old flyer",
      null,
      `https://rival-${suffix}.example/`,
      "2026-08-25T04:00:00.000Z",
    ),
    row(
      foreign,
      otherWorkspaceId,
      otherEntityId,
      "change",
      "home",
      "Other tenant change",
      null,
      `https://rival-b-${suffix}.example/`,
      "2026-09-06T09:00:00.000Z",
    ),
  ]);
  return {
    workspaceId,
    otherWorkspaceId,
    entityId,
    domain,
    priced,
    copy,
    hired,
    ad,
    mentioned,
    tombstoned,
    stale,
    foreign,
  };
}

describe("competitor feed read", () => {
  afterEach(async () => {
    const row = created.pop();
    if (row === undefined) return;
    await env.DB.prepare("DELETE FROM workspace WHERE id IN (?, ?)")
      .bind(...row.workspaces)
      .run();
  });

  it("mixes the four kinds on one entity, newest first, inside the window", async () => {
    const fixture = await seed();
    const feed = await readEntityDevelopments({
      workspaceId: fixture.workspaceId,
      entityId: fixture.entityId,
      since: SINCE,
      limit: 20,
    });
    expect(feed.map((item) => item.id)).toEqual([
      fixture.priced,
      fixture.copy,
      fixture.hired,
      fixture.ad,
      fixture.mentioned,
    ]);
    expect(feed.map((item) => item.kind)).toEqual(["change", "change", "hiring", "ad", "mention"]);
    expect(feed[0]).toEqual({
      id: fixture.priced,
      kind: "change",
      title: "Rebuilt the pricing page",
      summary: "Wordier headline",
      url: `https://${fixture.domain}/pricing`,
      observedAt: "2026-09-06T01:00:00.000Z",
    });
  });

  it("keeps a tombstone, an old row and another workspace's rows out", async () => {
    const fixture = await seed();
    const feed = await readEntityDevelopments({
      workspaceId: fixture.workspaceId,
      entityId: fixture.entityId,
      since: SINCE,
      limit: 20,
    });
    expect(feed.map((item) => item.id)).not.toContain(fixture.tombstoned);
    expect(feed.map((item) => item.id)).not.toContain(fixture.stale);
    expect(feed.map((item) => item.id)).not.toContain(fixture.foreign);
  });

  it("hides Hacker News titles nobody has judged yet, then shows only the one judged about the brand", async () => {
    const fixture = await seed();
    const titles = ["Flock: A Flock of Birds in your Browser", "Libron E-Reader Font", "List of April Fools RFCs"];
    const ids = titles.map((_, index) => `sig-fed-hn-${fixture.entityId}-${index}`);
    const watchId = `watch-fed-hn-${fixture.entityId}`;
    const snapshotId = `snap-fed-hn-${fixture.entityId}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?1, ?2, 'src_site_web', 'brand name')",
      ).bind(watchId, fixture.entityId),
      env.DB.prepare(
        "INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash) VALUES (?1, ?2, '2026-10-13T10:00:00.000Z', 'h')",
      ).bind(snapshotId, watchId),
    ]);
    await env.DB.batch(
      titles.map((title, index) =>
        insertMention({
          id: ids[index] ?? "",
          workspaceId: fixture.workspaceId,
          entityId: fixture.entityId,
          sourceId: "src_site_web",
          watchId,
          snapshotId,
          title,
          url: `https://news.ycombinator.com/item?id=${String(4100 + index)}`,
          urlHash: `hash-${ids[index] ?? ""}`,
          titleHash: `th-${ids[index] ?? ""}`,
          normUrlHash: `nh-${ids[index] ?? ""}`,
          author: null,
          engagementJson: null,
          payloadJson: "{}",
          dedupKey: `${ids[index] ?? ""}:dedup`,
          publishedAt: "2026-10-05T10:00:00.000Z",
          observedAt: "2026-10-13T10:00:00.000Z",
          isNotAboutBrand: false,
          state: "unjudged",
        }),
      ),
    );
    const read = async () =>
      (
        await readEntityDevelopments({
          workspaceId: fixture.workspaceId,
          entityId: fixture.entityId,
          since: SINCE,
          limit: 20,
        })
      ).map((item) => item.title);
    const before = await read();
    for (const title of titles) expect(before).not.toContain(title);
    const pending = await readUnjudgedMentions(watchId, 10);
    expect(pending.map((row) => row.title).sort()).toEqual([...titles].sort());
    const aboutBrandP = new Map([
      [titles[0] ?? "", 0.93],
      [titles[1] ?? "", 0.1929],
      [titles[2] ?? "", 0.1378],
    ]);
    await env.DB.batch(
      pending.map((row) => resolveUnjudgedMention(row.id, !isAboutBrand(aboutBrandP.get(row.title) ?? 0))),
    );
    const after = await read();
    expect(after).toContain(titles[0]);
    expect(after).not.toContain(titles[1]);
    expect(after).not.toContain(titles[2]);
  });

  it("the database hides a mention judged below 0.5 even when the row was stored visible", async () => {
    const fixture = await seed();
    const watchId = `watch-fed-trg-${fixture.entityId}`;
    const snapshotId = `snap-fed-trg-${fixture.entityId}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?1, ?2, 'src_site_web', 'brand name')",
      ).bind(watchId, fixture.entityId),
      env.DB.prepare(
        "INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash) VALUES (?1, ?2, '2026-10-13T10:00:00.000Z', 'h')",
      ).bind(snapshotId, watchId),
    ]);
    const ids = ["low", "high", "linked"].map((name) => `sig-fed-trg-${name}-${fixture.entityId}`);
    const titles = ["Low score story", "High score story", "Linked later story"];
    await env.DB.batch(
      ids.map((id, index) =>
        insertMention({
          id,
          workspaceId: fixture.workspaceId,
          entityId: fixture.entityId,
          sourceId: "src_site_web",
          watchId,
          snapshotId,
          title: titles[index] ?? "",
          url: `https://news.example.com/${id}`,
          urlHash: `hash-${id}`,
          titleHash: `th-${id}`,
          normUrlHash: `nh-${id}`,
          author: null,
          engagementJson: null,
          payloadJson: "{}",
          dedupKey: `${id}:dedup`,
          publishedAt: "2026-10-05T10:00:00.000Z",
          observedAt: "2026-10-13T10:00:00.000Z",
          isNotAboutBrand: false,
          state: "judged",
        }),
      ),
    );
    const verdict = (signalId: string | null, p: number, inputHash: string) =>
      insertVerdict({
        workspaceId: fixture.workspaceId,
        questionId: "mention_is_about_brand",
        inputHash,
        signalId,
        entityId: fixture.entityId,
        p,
        choice: null,
        reason: null,
        decidedAt: "2026-10-13T10:00:00.000Z",
      });
    await env.DB.batch([
      verdict(ids[0] ?? "", 0.1429, `${ids[0] ?? ""}:h`),
      verdict(ids[1] ?? "", 0.93, `${ids[1] ?? ""}:h`),
    ]);
    await env.DB.batch([verdict(null, 0.1957, `${ids[2] ?? ""}:h`)]);
    const unlinked = await env.DB.prepare("SELECT id FROM jev_verdict WHERE input_hash = ?1")
      .bind(`${ids[2] ?? ""}:h`)
      .first<{ id: string }>();
    await env.DB.batch([
      linkVerdictsStatement({
        signalId: ids[2] ?? "",
        workspaceId: fixture.workspaceId,
        verdictIds: [unlinked?.id ?? ""],
      }),
    ]);
    const shown = (
      await readEntityDevelopments({
        workspaceId: fixture.workspaceId,
        entityId: fixture.entityId,
        since: SINCE,
        limit: 20,
      })
    ).map((item) => item.title);
    expect(shown).toContain(titles[1]);
    expect(shown).not.toContain(titles[0]);
    expect(shown).not.toContain(titles[2]);
  });

  it("honours limit with the two newest", async () => {
    const fixture = await seed();
    const feed = await readEntityDevelopments({
      workspaceId: fixture.workspaceId,
      entityId: fixture.entityId,
      since: SINCE,
      limit: 2,
    });
    expect(feed.map((item) => item.id)).toEqual([fixture.priced, fixture.copy]);
  });
});
