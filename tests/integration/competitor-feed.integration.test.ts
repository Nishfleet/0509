import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { readEntityDevelopments } from "../../app/lib/data/signal.server";

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
  return { workspaceId, otherWorkspaceId, entityId, domain, priced, copy, hired, ad, mentioned, tombstoned, stale, foreign };
}

describe("competitor feed read", () => {
  afterEach(async () => {
    const row = created.pop();
    if (row === undefined) return;
    await env.DB.prepare("DELETE FROM workspace WHERE id IN (?, ?)").bind(...row.workspaces).run();
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
