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
    expect(call[1].idempotencyKey).toMatch(/^presence-digest:user_\d{4}:2026-08-\d{2}$/);
  });
});
