import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";

import type { AppEnv } from "~/lib/env.server";
import { presenceUrlHash } from "~/lib/presence-hash";

import { db, ISO_T0, uid } from "./fixtures";

const mocks = vi.hoisted(() => ({
  sendPresenceDigestEmail: vi.fn(),
}));

const FEED_HOST = "https://1.1.1.1";

const SITE_PAGE_WITH_FEED = `<!doctype html><html><head>
  <title>Brand</title>
  <link rel="alternate" type="application/rss+xml" href="/feed.xml" title="RSS"/>
</head><body><h1>Brand</h1></body></html>`;

const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Brand Blog</title>
  <link>${FEED_HOST}</link>
  <item>
    <title>New mention post</title>
    <link>https://1.1.1.1/posts/new-mention</link>
    <guid>https://1.1.1.1/posts/new-mention</guid>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <description>New mention body.</description>
  </item>
  <item>
    <title>Old mention post</title>
    <link>https://1.1.1.1/posts/old-mention</link>
    <guid>https://1.1.1.1/posts/old-mention</guid>
    <pubDate>Sun, 31 Dec 2023 00:00:00 GMT</pubDate>
    <description>Old mention body.</description>
  </item>
</channel></rss>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Empty</title>
  <link>${FEED_HOST}</link>
</channel></rss>`;

function feedFetcher(routes: Record<string, { body: string; contentType?: string; etag?: string }>) {
  return vi.fn(async (url: string | URL) => {
    const u = new URL(url.toString());
    const route = routes[u.pathname];
    if (!route) {
      return new Response("not found", { status: 404 });
    }
    const headers: Record<string, string> = {
      "content-type": route.contentType ?? "application/rss+xml",
    };
    if (route.etag) headers.etag = route.etag;
    return new Response(route.body, { status: 200, headers });
  }) as unknown as typeof fetch;
}

function makeEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    DB: env.DB,
    PRESENCE_WEBSITE_ROLLOUT: "generally_available",
    PRESENCE_RSS_ROLLOUT: "internal",
    PRESENCE_DIGEST_ROLLOUT: "enabled",
    MONITORING_FANOUT_MODE: "fanout",
    MONITORING_FANOUT_GLOBAL: "1",
    ...overrides,
  } as AppEnv;
}

async function seedUserAndEntity(plan: "free" | "scout" | "starter" | "agency" = "agency") {
  const userId = uid("user");
  const email = `${userId}@example.test`;
  await db()
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(userId, `Fixture ${userId}`, email, ISO_T0, ISO_T0)
    .run();

  await db()
    .prepare(
      `INSERT INTO user_plan (user_id, plan, plan_updated_at)
       VALUES (?, ?, ?)`,
    )
    .bind(userId, plan, ISO_T0)
    .run();

  const entityId = uid("entity");
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'competitor', ?, ?, NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, "Acme", FEED_HOST, ISO_T0, ISO_T0)
    .run();

  const sourceId = uid("st");
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, target_url,
         target_handle, metadata_json, coverage_label, is_active, deleted_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'website', ?, ?, NULL, '{}', 'PUBLIC_WEB_BEST_EFFORT', 1, NULL, ?, ?)`,
    )
    .bind(sourceId, entityId, userId, "1.1.1.1", FEED_HOST, ISO_T0, ISO_T0)
    .run();

  return { userId, email, entityId, sourceId };
}

async function seedPreExistingMention(sourceId: string, entityId: string, userId: string) {
  const canonicalUrl = "https://1.1.1.1/posts/old-mention";
  const urlHash = await presenceUrlHash(canonicalUrl);
  const itemId = uid("pi");
  await db()
    .prepare(
      `INSERT INTO presence_item (
         id, source_target_id, tracked_entity_id, user_id, connector_id,
         external_id, canonical_url, url_hash, title, body_excerpt, author,
         published_at, observed_at, content_hash, raw_json, is_tombstone,
         created_at
       ) VALUES (?, ?, ?, ?, 'website', NULL, ?, ?, 'Pre-existing', 'Pre-existing body', NULL, ?, ?, 'prehash', '{}', 0, ?)`,
    )
    .bind(
      itemId,
      sourceId,
      entityId,
      userId,
      canonicalUrl,
      urlHash,
      ISO_T0,
      ISO_T0,
      ISO_T0,
    )
    .run();
  return itemId;
}

/**
 * Epic #3171: extra mention sources ride the SAME presence substrate — one
 * source_target row per connector, one presence_item per captured mention.
 * These helpers mirror the website inserts above but let the caller pick the
 * connector, so gdelt/bluesky/rss rows go through the repo's real migrations
 * (their CHECK-widening migrations are proven by the dedicated gdelt/bluesky
 * specs; this file proves they reach the DIGEST, not just the tables).
 */
async function seedSourceTarget(
  entityId: string,
  userId: string,
  connector: "gdelt" | "bluesky" | "rss",
) {
  const sourceId = uid("st");
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, target_url,
         target_handle, metadata_json, coverage_label, is_active, deleted_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, '{}', 'PUBLIC_WEB_BEST_EFFORT', 1, NULL, ?, ?)`,
    )
    .bind(
      sourceId,
      entityId,
      userId,
      connector,
      `${connector}.1.1.1`,
      `https://${connector}.1.1.1/`,
      ISO_T0,
      ISO_T0,
    )
    .run();
  return sourceId;
}

async function seedMentionItem(options: {
  sourceTargetId: string;
  entityId: string;
  userId: string;
  connector: "website" | "gdelt" | "bluesky" | "rss";
  url: string;
  title: string;
  /** Defaults to the fixture epoch; the sweep case passes fresher stamps. */
  observedAt?: string;
}) {
  const itemId = uid("pi");
  const observedAt = options.observedAt ?? ISO_T0;
  await db()
    .prepare(
      `INSERT INTO presence_item (
         id, source_target_id, tracked_entity_id, user_id, connector_id,
         external_id, canonical_url, url_hash, title, body_excerpt, author,
         published_at, observed_at, content_hash, raw_json, is_tombstone,
         created_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, '{}', 0, ?)`,
    )
    .bind(
      itemId,
      options.sourceTargetId,
      options.entityId,
      options.userId,
      options.connector,
      options.url,
      await presenceUrlHash(options.url),
      options.title,
      `${options.title} body`,
      observedAt,
      observedAt,
      uid("hash"),
      observedAt,
    )
    .run();
  return itemId;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock("~/lib/delivery.server", () => ({
    sendPresenceDigestEmail: mocks.sendPresenceDigestEmail,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("~/lib/delivery.server");
});

describe("mention resweep + digest", () => {
  it("resweeps website source targets and stores rss mention items", async () => {
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: true });
    const { userId, sourceId } = await seedUserAndEntity("agency");

    const { runMentionResweep } = await import("~/lib/mention-resweep.server");
    const fetchImpl = feedFetcher({
      "/": { body: SITE_PAGE_WITH_FEED, contentType: "text/html" },
      "/feed.xml": { body: RSS_FEED, contentType: "application/rss+xml", etag: '"v1"' },
    });

    const resweep = await runMentionResweep(makeEnv(), {
      userId,
      fetchImpl,
    });

    expect(resweep.polled).toBe(1);
    expect(resweep.inserted).toBe(2);
    expect(resweep.updated).toBe(0);

    const cursor = await db()
      .prepare("SELECT * FROM presence_poll_cursor WHERE source_target_id = ?")
      .bind(sourceId)
      .first();
    expect(cursor).not.toBeNull();
    expect((cursor as unknown as { etag: string }).etag).toBe('"v1"');

    const updatedSource = await db()
      .prepare("SELECT coverage_label FROM source_target WHERE id = ?")
      .bind(sourceId)
      .first<{ coverage_label: string }>();
    expect(updatedSource?.coverage_label).toBe("VERIFIED_PUBLIC_FEED");
  });

  it("marks (new) only for items first observed inside the lookback window", async () => {
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: true });
    const { userId, email, entityId, sourceId } = await seedUserAndEntity("agency");
    await seedPreExistingMention(sourceId, entityId, userId);

    const { runMentionResweep } = await import("~/lib/mention-resweep.server");
    const { deliverPresenceDigestForUser } = await import("~/lib/presence-digest.server");
    const fetchImpl = feedFetcher({
      "/": { body: SITE_PAGE_WITH_FEED, contentType: "text/html" },
      "/feed.xml": { body: RSS_FEED, contentType: "application/rss+xml" },
    });

    await runMentionResweep(makeEnv(), { userId, fetchImpl });
    const result = await deliverPresenceDigestForUser(makeEnv(), userId, email);
    expect(result.delivered).toBe(true);

    const call = mocks.sendPresenceDigestEmail.mock.calls[0] as [AppEnv, { lines: string[] }];
    const lines = call[1].lines;

    const newLine = lines.find((line) => line.includes("New mention post"));
    const oldLine = lines.find((line) => line.includes("Old mention post"));

    expect(newLine).toBeDefined();
    expect(newLine).toContain("(new)");
    expect(oldLine).toBeDefined();
    expect(oldLine).not.toContain("(new)");
    expect(lines.some((line) => line.includes("RSS / Atom / JSON Feed"))).toBe(true);
  });

  it("does not send the digest when PRESENCE_DIGEST_ROLLOUT is disabled", async () => {
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: true });
    const { userId, email } = await seedUserAndEntity("agency");

    const { deliverPresenceDigestForUser } = await import("~/lib/presence-digest.server");
    const result = await deliverPresenceDigestForUser(
      makeEnv({ PRESENCE_DIGEST_ROLLOUT: "disabled" }),
      userId,
      email,
    );

    expect(result).toEqual({ delivered: false, reason: "digest_disabled" });
    expect(mocks.sendPresenceDigestEmail).not.toHaveBeenCalled();
  });

  it("does not send the mention-extended digest for free plan workspaces", async () => {
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: true });
    const { userId, email } = await seedUserAndEntity("free");

    const { deliverPresenceDigestForUser } = await import("~/lib/presence-digest.server");
    const result = await deliverPresenceDigestForUser(makeEnv(), userId, email);
    expect(result.delivered).toBe(false);
    expect(mocks.sendPresenceDigestEmail).not.toHaveBeenCalled();
  });

  it("does not fabricate a new-mentions line when no mention items were polled", async () => {
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: true });
    const { userId, email } = await seedUserAndEntity("agency");

    const { runMentionResweep } = await import("~/lib/mention-resweep.server");
    const { deliverPresenceDigestForUser } = await import("~/lib/presence-digest.server");
    const fetchImpl = feedFetcher({
      "/": { body: SITE_PAGE_WITH_FEED, contentType: "text/html" },
      "/feed.xml": { body: EMPTY_FEED, contentType: "application/rss+xml" },
    });

    await runMentionResweep(makeEnv(), { userId, fetchImpl });
    const result = await deliverPresenceDigestForUser(makeEnv(), userId, email);

    expect(result).toEqual({ delivered: false, reason: "no_items" });
    expect(mocks.sendPresenceDigestEmail).not.toHaveBeenCalled();
  });

  it("does not permanently starve workspaces past the user limit (fair sweep ordering)", async () => {
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: true });

    // 101 fresh paid workspaces, each with one active entity + one website source.
    // Rows seeded by earlier tests in this file are still visible, so every
    // assertion below filters `resweepUsers` down to this test's own ids.
    const seeded = [];
    for (let i = 0; i < 101; i += 1) {
      seeded.push(await seedUserAndEntity("agency"));
    }
    const mine = new Set(seeded.map((row) => row.userId));
    const scoped = (ids: string[]) => ids.filter((id) => mine.has(id));

    const ordered = [...seeded].sort((a, b) => (a.userId < b.userId ? -1 : 1));
    const starvedBefore = ordered[ordered.length - 1];

    const { listResweepUsers } = await import("~/lib/mention-resweep.server");

    // Every one of this test's workspaces is picked at the real cap...
    const fairBatch = scoped(await listResweepUsers(makeEnv(), 100_000));
    expect(fairBatch.length).toBe(101);

    // ...and the documented bound is honoured when the cap is the default.
    // Note this is a whole-database cap, so it is 100 rows total, not 100 of
    // this test's workspaces. Everything asserted below is scoped to `mine`.
    expect((await listResweepUsers(makeEnv(), 100)).length).toBe(100);

    // Mark every workspace polled except the highest-id one. Fair ordering must
    // pick that never-polled workspace even though 100 polled peers exist —
    // under the old `ORDER BY user_id LIMIT 100` the same first 100 were
    // re-picked every tick and the 101st was never swept at all.
    for (const row of ordered.slice(0, 100)) {
      await db()
        .prepare(
          `INSERT INTO presence_poll_cursor (
             source_target_id, cursor_json, etag, last_modified, last_polled_at,
             last_success_at, last_error_code, last_error_message, updated_at
           ) VALUES (?, '{}', NULL, NULL, ?, ?, NULL, NULL, ?)`,
        )
        .bind(row.sourceId, ISO_T0, ISO_T0, ISO_T0)
        .run();
    }

    expect(scoped(await listResweepUsers(makeEnv(), 100))).toContain(starvedBefore.userId);

    // ...and the starved workspace is polled end to end, writing a cursor row.
    const { runMentionResweep } = await import("~/lib/mention-resweep.server");
    const fetchImpl = feedFetcher({
      "/": { body: SITE_PAGE_WITH_FEED, contentType: "text/html" },
      "/feed.xml": { body: EMPTY_FEED, contentType: "application/rss+xml" },
    });
    const resweep = await runMentionResweep(makeEnv(), { fetchImpl, userLimit: 100 });
    expect(resweep.polled).toBeGreaterThanOrEqual(1);

    const starvedCursor = await db()
      .prepare("SELECT * FROM presence_poll_cursor WHERE source_target_id = ?")
      .bind(starvedBefore.sourceId)
      .first();
    expect(starvedCursor).not.toBeNull();
  });

  it("bounds the sweep by users, not entities (userLimit)", async () => {
    // One workspace with more entities than the limit must still be the only
    // user returned: the limit counts users, never entities (the old
    // `entityLimit` name said otherwise).
    const { userId, entityId } = await seedUserAndEntity("agency");
    for (let i = 0; i < 5; i += 1) {
      await db()
        .prepare(
          `INSERT INTO tracked_entity (
             id, user_id, tracking_mode, label, canonical_url, notes,
             is_active, created_at, updated_at
           ) VALUES (?, ?, 'competitor', ?, ?, NULL, 1, ?, ?)`,
        )
        .bind(uid("entity"), userId, `Extra ${i}`, FEED_HOST, ISO_T0, ISO_T0)
        .run();
    }

    const { listResweepUsers } = await import("~/lib/mention-resweep.server");
    // One workspace, six entities: a high user limit returns that workspace
    // exactly once, never once per entity.
    const batch = (await listResweepUsers(makeEnv(), 1_000_000)).filter((id) => id === userId);
    expect(batch).toEqual([userId]);
    expect(entityId).toBeTruthy();
  });

  it("uses the existing idempotency key shape", async () => {
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: true });
    const { userId, email } = await seedUserAndEntity("agency");

    const { runMentionResweep } = await import("~/lib/mention-resweep.server");
    const { deliverPresenceDigestForUser } = await import("~/lib/presence-digest.server");
    const fetchImpl = feedFetcher({
      "/": { body: SITE_PAGE_WITH_FEED, contentType: "text/html" },
      "/feed.xml": { body: RSS_FEED, contentType: "application/rss+xml" },
    });

    await runMentionResweep(makeEnv(), { userId, fetchImpl });
    const result = await deliverPresenceDigestForUser(makeEnv(), userId, email);
    expect(result.delivered).toBe(true);

    const call = mocks.sendPresenceDigestEmail.mock.calls[0] as [AppEnv, { idempotencyKey: string }];
    // The key embeds `since` = now minus the digest lookback (168h), same formula as
    // deliverPresenceDigestForUser. Asserting a fixed calendar month made this test
    // month-locked and it broke on the September rollover; derive the expected date
    // from the same clock expression instead.
    const lookbackMs = 168 * 60 * 60 * 1000;
    const expectedSince = new Date(Date.now() - lookbackMs).toISOString().slice(0, 10);
    expect(call[1].idempotencyKey).toMatch(new RegExp(`^presence-digest:user_\\d{4}:${expectedSince}$`));
  });

  it("digests >50 distinct (entity, url_hash) pairs without blowing the D1 100-bind cap", async () => {
    // M25: firstObservedAtByUrlHash binds 1 + 2*pairs parameters in one OR-chain.
    // 60 pairs = 121 binds > D1's 100-parameter limit; the digest must still build.
    const { userId, entityId, sourceId } = await seedUserAndEntity();

    const statements = [];
    for (let i = 0; i < 60; i++) {
      const canonicalUrl = `https://1.1.1.1/posts/mention-${i}`;
      const urlHash = await presenceUrlHash(canonicalUrl);
      const observedAt = new Date(Date.parse(ISO_T0) + (i + 1) * 60_000).toISOString();
      statements.push(
        db()
          .prepare(
            `INSERT INTO presence_item (
               id, source_target_id, tracked_entity_id, user_id, connector_id,
               external_id, canonical_url, url_hash, title, body_excerpt, author,
               published_at, observed_at, content_hash, raw_json, is_tombstone,
               created_at
             ) VALUES (?, ?, ?, ?, 'website', NULL, ?, ?, ?, 'Body', NULL, ?, ?, ?, '{}', 0, ?)`,
          )
          .bind(
            uid(`pi${i}`),
            sourceId,
            entityId,
            userId,
            canonicalUrl,
            urlHash,
            `Mention ${i}`,
            ISO_T0,
            observedAt,
            `hash${i}`,
            observedAt,
          ),
      );
    }
    await db().batch(statements);

    const { buildMentionDigestLines } = await import("~/lib/mention-digest.server");
    const lines = await buildMentionDigestLines(makeEnv(), userId, {
      since: ISO_T0,
      mentionConnectorIds: ["website"],
      limit: 60,
    });
    expect(lines).toBeInstanceOf(Array);
    expect(lines.length).toBe(60);
    expect(lines.every((line) => line.includes("(new)"))).toBe(true);
    // #3179: digests include the item's canonical link — every one of these
    // captures resolved a canonical URL, so every line carries one.
    expect(lines.every((line) => line.includes(" — https://1.1.1.1/posts/mention-"))).toBe(true);
  });

  it("routes gdelt/bluesky/rss mentions through the default digest connectors with coverage label and link", async () => {
    const { userId, entityId } = await seedUserAndEntity("agency");
    // NO mentionConnectorIds — this exercises DEFAULT_MENTION_CONNECTORS, the
    // epic #3171 coverage list. Before this change gdelt/bluesky captures
    // never reached a digest line even though the connectors stored them.
    const gdeltSource = await seedSourceTarget(entityId, userId, "gdelt");
    const blueskySource = await seedSourceTarget(entityId, userId, "bluesky");
    const rssSource = await seedSourceTarget(entityId, userId, "rss");
    await seedMentionItem({
      sourceTargetId: gdeltSource,
      entityId,
      userId,
      connector: "gdelt",
      url: "https://news.1.1.1.1/gdelt-mention",
      title: "Gdelt coverage",
    });
    await seedMentionItem({
      sourceTargetId: blueskySource,
      entityId,
      userId,
      connector: "bluesky",
      url: "https://1.1.1.1/bluesky-mention",
      title: "Bluesky post",
    });
    await seedMentionItem({
      sourceTargetId: rssSource,
      entityId,
      userId,
      connector: "rss",
      url: "https://1.1.1.1/rss-mention",
      title: "Rss post",
    });

    const { buildMentionDigestLines } = await import("~/lib/mention-digest.server");
    const lines = await buildMentionDigestLines(makeEnv(), userId, {
      since: ISO_T0,
    });

    expect(lines.length).toBe(3);
    // Honest coverage copy: the connector's public label, then the #3179
    // source+link promise — the item's canonical URL when one resolved.
    const gdeltLine = lines.find((line) => line.includes("(GDELT mainstream news)"));
    expect(gdeltLine).toContain("Gdelt coverage");
    expect(gdeltLine).toContain("https://news.1.1.1.1/gdelt-mention");
    const blueskyLine = lines.find((line) => line.includes("(Bluesky)"));
    expect(blueskyLine).toContain("Bluesky post");
    expect(blueskyLine).toContain("https://1.1.1.1/bluesky-mention");
    const rssLine = lines.find((line) => line.includes("(RSS / Atom / JSON Feed)"));
    expect(rssLine).toContain("Rss post");
    expect(rssLine).toContain("https://1.1.1.1/rss-mention");
  });

  it("scheduled presence-digest sweep delivers a digest against real D1 (epic #3171/#3179)", async () => {
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: true });
    const { userId, entityId, sourceId } = await seedUserAndEntity("agency");
    // A mention captured within the digest lookback — the sweep resolves the
    // 168h window itself, so the item must be fresher than the fixture epoch.
    const observedAt = new Date(Date.now() - 60_000).toISOString();
    await seedMentionItem({
      sourceTargetId: sourceId,
      entityId,
      userId,
      connector: "website",
      url: "https://1.1.1.1/posts/brand-new",
      title: "Sweep mention",
      observedAt,
    });

    const { runPresenceDigestSweep } = await import("~/lib/presence-digest.server");
    const result = await runPresenceDigestSweep(makeEnv());

    // Real workerd: listResweepUsers (oldest-work-first SQL), the owner
    // address read (user WHERE id IN (SELECT value FROM json_each(?))) and
    // the full digest assembly all ran against the repo's real migrations.
    expect(result).toEqual({ swept: 1, delivered: 1, skipped: 0, errors: 0 });
    const emailArg = mocks.sendPresenceDigestEmail.mock.calls[0]![1] as {
      userId: string;
      email: string;
      lines: string[];
      idempotencyKey: string;
    };
    expect(emailArg.userId).toBe(userId);
    expect(JSON.stringify(emailArg.lines)).toContain("https://1.1.1.1/posts/brand-new");
    // Per-workspace-per-UTC-day idempotency: the 3-hourly tick collapses to
    // at most one digest per workspace per day because of this key.
    expect(emailArg.idempotencyKey).toBe(
      `presence-digest:${userId}:${emailArg.idempotencyKey.split(":")[2]}`,
    );
  });
});
