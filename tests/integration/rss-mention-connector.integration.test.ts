import { describe, expect, it, vi } from "vitest";

import { rssConnector } from "~/lib/presence-connectors/rss.server";
import { getPresenceConnector } from "~/lib/presence-connector-registry.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext } from "~/lib/presence-types";

import { db, ISO_T0, uid } from "./fixtures";

/**
 * RSS / Atom / JSON Feed mention connector — Phase 1 of the mention-monitoring
 * epic (Nishfleet/0509#1368). This is the zero-spend backbone: every network
 * hop goes through the SSRF-hardened `presenceSafeFetch` path, mentions
 * normalize into the same `presence_item` shape every other source uses, and
 * an empty feed is an honest empty result — never a fabricated mention.
 *
 * The suite runs on real workerd against the repo's real migrations so the
 * presence substrate (`tracked_entity`, `source_target`, `presence_item`) is
 * the real schema. The connector methods themselves are network-shape
 * contracts, so a mock `fetchImpl` serves fixture feeds from a public-IP host
 * (`1.1.1.1`) — `resolvePublicHttpUrl` returns IP literals without a DNS hop,
 * so no real network is touched. SSRF rejection is asserted against a private
 * IP and a non-HTTP scheme, both of which `resolvePublicHttpUrl` rejects
 * before any fetch.
 *
 * `source_target.connector_id` carries a CHECK constraint that does not yet
 * allow `"rss"` (migration 0055). Per the issue's UNKNOWNS, this PR must not
 * touch migrations; the connector is exercised through its in-memory
 * validate/poll/health surface, and no `connector_id = 'rss'` row is written
 * here. Relaxing the constraint is a separate expand/contract migration.
 */

const FEED_HOST = "https://1.1.1.1";

const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Brand Blog</title>
  <link>${FEED_HOST}</link>
  <item>
    <title>Tom &amp; Jerry &lt;3</title>
    <link>https://1.1.1.1/posts/tom-and-jerry</link>
    <guid>https://1.1.1.1/posts/tom-and-jerry</guid>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <author>editor@brand.test (Editor)</author>
    <description>A &amp; b &quot;quoted&quot; — the real story.</description>
  </item>
  <item>
    <title>Second post</title>
    <link>https://1.1.1.1/posts/second</link>
    <guid>https://1.1.1.1/posts/second</guid>
    <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    <description>Short body.</description>
  </item>
</channel></rss>`;

const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Brand Atom Feed</title>
  <entry>
    <title>An Atom entry</title>
    <link href="https://1.1.1.1/entries/atom-1"/>
    <id>https://1.1.1.1/entries/atom-1</id>
    <published>2024-03-01T12:00:00Z</published>
    <author><name>Atom Author</name></author>
    <summary>Atom summary text.</summary>
  </entry>
</feed>`;

const JSON_FEED = JSON.stringify({
  version: "https://jsonfeed.org/version/1.1",
  title: "Brand JSON Feed",
  items: [
    {
      id: "https://1.1.1.1/json/1",
      url: "https://1.1.1.1/json/1",
      title: "JSON Feed item",
      date_published: "2024-04-01T00:00:00Z",
      content_text: "JSON feed body text.",
      authors: [{ name: "JSON Author" }],
    },
  ],
});

const EMPTY_RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Empty</title><link>${FEED_HOST}</link></channel></rss>`;

const SITE_PAGE_WITH_FEED_LINK = `<!doctype html><html><head>
  <title>Brand Site</title>
  <link rel="alternate" type="application/rss+xml" href="/feed.xml" title="RSS"/>
</head><body><h1>Brand</h1></body></html>`;

function makeEnv(rollout?: string): AppEnv {
  return { PRESENCE_RSS_ROLLOUT: rollout } as AppEnv;
}

function makeCtx(
  fetchImpl: typeof fetch,
  rollout = "internal",
  trackingMode: "self" | "competitor" = "competitor",
): PresenceConnectorContext {
  return {
    env: makeEnv(rollout),
    userId: "user-rss-1",
    trackingMode,
    connection: null,
    fetchImpl,
  };
}

function feedFetcher(routes: Record<string, { body: string; contentType?: string; etag?: string }>) {
  return vi.fn(async (url: string | URL) => {
    const path = new URL(url.toString()).pathname || "/";
    const key = path === "/" ? "/" : path;
    const route = routes[key] ?? routes[path];
    if (!route) {
      return new Response("not found", { status: 404 });
    }
    const headers: Record<string, string> = { "content-type": route.contentType ?? "application/rss+xml" };
    if (route.etag) headers.etag = route.etag;
    return new Response(route.body, { status: 200, headers });
  }) as unknown as typeof fetch;
}

async function seedTrackedEntity() {
  const userId = uid("user");
  const entityId = uid("entity");
  await db()
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(userId, `Fixture ${userId}`, `${userId}@example.test`, ISO_T0, ISO_T0)
    .run();
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', ?, ?, NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, "Brand self", FEED_HOST, ISO_T0, ISO_T0)
    .run();
  return { userId, entityId };
}

describe("rss mention connector — registration and docs coverage", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("rss");
    expect(connector).toBe(rssConnector);
    expect(connector.id).toBe("rss");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated", () => {
    const docs = presenceSourceCoverageForDocs();
    const rss = docs.find((entry) => entry.sourceId === "rss");
    expect(rss).toBeDefined();
    expect(rss?.productionStatus).toBe("gated");
  });
});

describe("rss mention connector — validateTarget", () => {
  it("accepts a direct RSS feed URL", async () => {
    const fetchImpl = feedFetcher({
      "/feed.xml": { body: RSS_FEED, contentType: "application/rss+xml" },
    });
    const result = await rssConnector.validateTarget(
      { trackingMode: "competitor", targetUrl: `${FEED_HOST}/feed.xml` },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(true);
    expect(result.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
    expect(result.metadata?.feedDiscovery).toBe("direct");
    expect(result.metadata?.feedUrl).toBe(`${FEED_HOST}/feed.xml`);
  });

  it("auto-discovers a feed from a site URL via <link rel=alternate>", async () => {
    const fetchImpl = feedFetcher({
      "/": { body: SITE_PAGE_WITH_FEED_LINK, contentType: "text/html" },
      "/feed.xml": { body: RSS_FEED, contentType: "application/rss+xml" },
    });
    const result = await rssConnector.validateTarget(
      { trackingMode: "competitor", targetUrl: FEED_HOST },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(true);
    expect(result.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
    expect(result.metadata?.feedDiscovery).toBe("discovered");
    expect(result.metadata?.feedUrl).toBe(`${FEED_HOST}/feed.xml`);
  });

  it("rejects an SSRF-blocked private IP with ssrf_blocked", async () => {
    const fetchImpl = feedFetcher({});
    const result = await rssConnector.validateTarget(
      { trackingMode: "competitor", targetUrl: "http://192.168.1.1/feed.xml" },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(false);
    expect(result.coverageLabel).toBe("UNAVAILABLE");
    expect(result.errorCode).toBe("ssrf_blocked");
    // No fetch should have happened — SSRF rejection is pre-fetch.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-HTTP scheme with ssrf_blocked", async () => {
    const fetchImpl = feedFetcher({});
    const result = await rssConnector.validateTarget(
      { trackingMode: "competitor", targetUrl: "ftp://example.test/feed.xml" },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(false);
    expect(result.coverageLabel).toBe("UNAVAILABLE");
    expect(result.errorCode).toBe("ssrf_blocked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a missing URL", async () => {
    const result = await rssConnector.validateTarget(
      { trackingMode: "competitor", targetUrl: "" },
      makeCtx(feedFetcher({})),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_url");
  });
});

describe("rss mention connector — poll", () => {
  it("returns items whose canonicalUrl is the per-item link, not the feed URL", async () => {
    const fetchImpl = feedFetcher({
      "/feed.xml": { body: RSS_FEED, contentType: "application/rss+xml", etag: '"v1"' },
    });
    const target = {
      targetUrl: `${FEED_HOST}/feed.xml`,
      metadata: { feedUrl: `${FEED_HOST}/feed.xml` },
    };
    const result = await rssConnector.poll(makeCtx(fetchImpl), target);

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");

    const first = result.items[0];
    expect(first?.canonicalUrl).toBe("https://1.1.1.1/posts/tom-and-jerry");
    expect(first?.canonicalUrl).not.toBe(`${FEED_HOST}/feed.xml`);
    // Single decode pass: &amp; -> &, &lt; -> <, &quot; -> ".
    expect(first?.title).toBe("Tom & Jerry <3");
    expect(first?.bodyExcerpt).toBe('A & b "quoted" — the real story.');
    // Every item carries a contentHash, publishedAt, and a bounded excerpt.
    expect(first?.contentHash).toBeTruthy();
    expect(first?.publishedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(first?.bodyExcerpt?.length).toBeLessThanOrEqual(280);
    expect(result.items[1]?.canonicalUrl).toBe("https://1.1.1.1/posts/second");
    expect(result.items[1]?.contentHash).toBeTruthy();
    expect(result.etag).toBe('"v1"');
  });

  it("parses Atom feeds with href-style links", async () => {
    const fetchImpl = feedFetcher({
      "/atom.xml": { body: ATOM_FEED, contentType: "application/atom+xml" },
    });
    const result = await rssConnector.poll(
      makeCtx(fetchImpl),
      { targetUrl: `${FEED_HOST}/atom.xml`, metadata: { feedUrl: `${FEED_HOST}/atom.xml` } },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.canonicalUrl).toBe("https://1.1.1.1/entries/atom-1");
    expect(result.items[0]?.author).toBe("Atom Author");
    expect(result.items[0]?.contentHash).toBeTruthy();
    expect(result.items[0]?.publishedAt).toBe("2024-03-01T12:00:00.000Z");
  });

  it("parses JSON Feed items", async () => {
    const fetchImpl = feedFetcher({
      "/feed.json": { body: JSON_FEED, contentType: "application/feed+json" },
    });
    const result = await rssConnector.poll(
      makeCtx(fetchImpl),
      { targetUrl: `${FEED_HOST}/feed.json`, metadata: { feedUrl: `${FEED_HOST}/feed.json` } },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.canonicalUrl).toBe("https://1.1.1.1/json/1");
    expect(result.items[0]?.title).toBe("JSON Feed item");
    expect(result.items[0]?.author).toBe("JSON Author");
    expect(result.items[0]?.contentHash).toBeTruthy();
    expect(result.items[0]?.publishedAt).toBe("2024-04-01T00:00:00.000Z");
  });

  it("returns an honest empty item set for a valid feed with zero items", async () => {
    const fetchImpl = feedFetcher({
      "/empty.xml": { body: EMPTY_RSS_FEED, contentType: "application/rss+xml" },
    });
    const result = await rssConnector.poll(
      makeCtx(fetchImpl),
      { targetUrl: `${FEED_HOST}/empty.xml`, metadata: { feedUrl: `${FEED_HOST}/empty.xml` } },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
  });

  it("reports feed_parse_failed for a non-feed document that yields nothing", async () => {
    const fetchImpl = feedFetcher({
      "/notafeed": { body: "<html><body>just a page</body></html>", contentType: "text/html" },
    });
    const result = await rssConnector.poll(
      makeCtx(fetchImpl),
      { targetUrl: `${FEED_HOST}/notafeed`, metadata: { feedUrl: `${FEED_HOST}/notafeed` } },
    );
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.errorCode).toBe("feed_parse_failed");
  });

  it("honors a 304 Not Modified as an empty, successful poll", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(url.toString());
      if (u.pathname === "/feed.xml") {
        return new Response(null, { status: 304, headers: { etag: '"v1"' } });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const result = await rssConnector.poll(
      makeCtx(fetchImpl),
      { targetUrl: `${FEED_HOST}/feed.xml`, metadata: { feedUrl: `${FEED_HOST}/feed.xml` } },
      { etag: '"v1"', lastModified: null },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.costUnits).toBe(0);
  });
});

describe("rss mention connector — healthCheck", () => {
  it("reports pending when the rollout env is disabled", async () => {
    const result = await rssConnector.healthCheck(makeCtx(feedFetcher({}), "disabled"));
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("reports pending when the rollout env is unset", async () => {
    // An env with no PRESENCE_RSS_ROLLOUT key at all defaults to disabled.
    const result = await rssConnector.healthCheck({
      env: {} as AppEnv,
      userId: "user-rss-1",
      trackingMode: "competitor",
      connection: null,
      fetchImpl: feedFetcher({}),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
  });

  it("reports healthy when the rollout env is enabled", async () => {
    const result = await rssConnector.healthCheck(makeCtx(feedFetcher({}), "internal"));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
  });
});

describe("rss mention connector — presence substrate", () => {
  it("seeds a minimal D1 against the real migrations and tracks the entity", async () => {
    // The substrate (migration 0055) is the real schema. The connector does
    // not write `connector_id = 'rss'` rows here — the CHECK constraint on
    // source_target does not yet allow 'rss' (a separate migration issue).
    // This proves the substrate exists and the connector's in-memory target
    // can be built from a real tracked_entity.
    const { entityId, userId } = await seedTrackedEntity();
    const row = await db()
      .prepare(
        `SELECT id, user_id, tracking_mode, label, canonical_url
         FROM tracked_entity WHERE id = ?`,
      )
      .bind(entityId)
      .first();
    expect(row?.user_id).toBe(userId);
    expect(row?.tracking_mode).toBe("self");
    expect(row?.canonical_url).toBe(FEED_HOST);

    const target = {
      targetUrl: row?.canonical_url as string,
      metadata: { feedUrl: `${FEED_HOST}/feed.xml` },
    };
    const fetchImpl = feedFetcher({
      "/feed.xml": { body: RSS_FEED, contentType: "application/rss+xml" },
    });
    const result = await rssConnector.poll(makeCtx(fetchImpl), target);
    expect(result.ok).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });
});
