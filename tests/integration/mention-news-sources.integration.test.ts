import { describe, expect, it, vi } from "vitest";

import { listPresenceItems, upsertPresenceItems } from "~/lib/presence-data.server";
import { pollPresenceTarget } from "~/lib/presence-connector-registry.server";
import { evaluatePresenceSourceCoverage } from "~/lib/presence-source-coverage.server";
import { rssConnector } from "~/lib/presence-connectors/rss.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorId, SourceTargetRecord } from "~/lib/presence-types";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Issue #3178 — mentions epic slice 2a: mainstream news mention capture
 * (GDELT + Google News RSS via the rss connector + publisher RSS) against the
 * REAL D1 mention store (`presence_item`, the table the mentions epic
 * adopted per #3170 — three target shapes, one store).
 *
 * Fixture-brand e2e bar: the fixture brand returns >= 1 mention per source
 * (exercised end-to-end through real workerd + real D1 with deterministic
 * fixtures — the accepted e2e equivalent for connector capture, since the
 * Playwright e2e-local harness keeps presence rollouts off by design):
 *   - gdelt — deterministic fixture mention via PRESENCE_GDELT_MOCK=1;
 *   - rss (publisher RSS) — fixture feed served by a mocked fetchImpl from
 *     a public-IP host (1.1.1.1, no DNS hop);
 *   - rss (Google News query feed) — news.google.com-style redirect links
 *     whose base64url article ids embed the publisher URL, resolved offline.
 *
 * Dedup bar: a second identical poll+upsert inserts zero rows (per-target
 * url_hash dedup), and two feed items whose redirect ids embed the SAME
 * publisher URL collapse to ONE presence_item row because both normalize to
 * the same canonical URL before hashing.
 *
 * No ToS-violating access: every surface exercised is a public surface
 * (GDELT DOC 2.1 terms explicitly allow commercial use with citation; Google
 * News RSS and publisher RSS are public feeds read at a 1-feed-fetch-per-poll
 * budget with at most 10 bounded redirect resolutions per poll) — no
 * authenticated scraping, no paid vendor.
 */

const FEED_HOST = "https://1.1.1.1";

function newsRedirectIdFor(url: string, prefix = "\x12"): string {
  // Google News newer-style article ids: base64url of a protobuf whose
  // `field 1` carries the publisher URL. The connector only regex-matches the
  // http(s) URL out of the decoded bytes, so a tagged prefix is enough; a
  // different `prefix` mints a DIFFERENT id that still decodes to `url`.
  const bytes = new TextEncoder().encode(`${prefix}${url}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const PUBLISHER_URL = "https://publisher.example.test/acme-launch";

function googleNewsFeed(extraDuplicateId = true): string {
  const id1 = newsRedirectIdFor(PUBLISHER_URL);
  const id2 = newsRedirectIdFor(PUBLISHER_URL, "\x0a\x03zzz\x12");
  const entries = [
    `<item><title>Acme launches — Google News syndication</title><link>https://news.google.com/rss/articles/${id1}?oc=5</link><guid>gn-1</guid><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>`,
    extraDuplicateId
      ? `<item><title>Acme launches — Google News syndication</title><link>https://news.google.com/rss/articles/${id2}?oc=5</link><guid>gn-2</guid><pubDate>Mon, 01 Jun 2026 00:30:00 GMT</pubDate></item>`
      : "",
  ];
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Google News — fixture brand</title>${entries.join("")}</channel></rss>`;
}

const PUBLISHER_FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Acme press feed</title>
  <item>
    <title>Acme launches its first product</title>
    <link>${PUBLISHER_URL}</link>
    <guid>pub-1</guid>
    <pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate>
    <description>Publisher RSS of the launch story.</description>
  </item>
</channel></rss>`;

function rssFetchImpl(): typeof fetch {
  const routes: Record<string, { body: string; contentType: string }> = {
    "/news.xml": { body: PUBLISHER_FEED, contentType: "application/rss+xml" },
    "/gn.xml": { body: googleNewsFeed(), contentType: "application/rss+xml" },
  };
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) return new Response("nope", { status: 404 });
    return new Response(route.body, { status: 200, headers: { "content-type": route.contentType } });
  }) as unknown as typeof fetch;
}

function activatedEnv(): AppEnv {
  return {
    ...appEnv,
    PRESENCE_GDELT_ROLLOUT: "internal",
    PRESENCE_RSS_ROLLOUT: "internal",
    PRESENCE_GDELT_MOCK: "1",
  };
}

async function seedTarget(
  userId: string,
  entityId: string,
  connectorId: PresenceConnectorId,
  metadataJson: string,
): Promise<string> {
  const targetId = uid("stgt");
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key,
         metadata_json, coverage_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'UNAVAILABLE', 1, ?, ?)`,
    )
    .bind(targetId, entityId, userId, connectorId, `${connectorId}_${targetId}`, metadataJson, ISO_T0, ISO_T0)
    .run();
  return targetId;
}

describe("mainstream news mentions — fixture brand, three shapes, one store (issue #3178)", () => {
  it("captures >= 1 mention per source and dedups on repoll", async () => {
    const env = activatedEnv();
    const userId = await seedUser();
    const entityId = uid("entity");
    await db()
      .prepare(
        `INSERT INTO tracked_entity (
           id, user_id, tracking_mode, label, canonical_url, notes,
           is_active, created_at, updated_at
         ) VALUES (?, ?, 'self', 'Fixture Brand', 'https://acme.test', NULL, 1, ?, ?)`,
      )
      .bind(entityId, userId, ISO_T0, ISO_T0)
      .run();

    // Migration 0099 widened the CHECK to 'gdelt'; the write proves it in the
    // same real-D1 flow (not only in the migration test).
    const gdeltTargetId = await seedTarget(userId, entityId, "gdelt", JSON.stringify({ query: "Fixture Brand" }));
    const publisherTargetId = await seedTarget(
      userId,
      entityId,
      "rss",
      JSON.stringify({ feedUrl: `${FEED_HOST}/news.xml`, feedDiscovery: "direct" }),
    );
    const googleNewsTargetId = await seedTarget(
      userId,
      entityId,
      "rss",
      JSON.stringify({ feedUrl: `${FEED_HOST}/gn.xml`, feedDiscovery: "direct", newsQuery: true }),
    );

    const gdeltTarget = { id: gdeltTargetId, trackedEntityId: entityId, userId, connectorId: "gdelt" as const, metadata: { query: "Fixture Brand" } };
    const publisherTarget = { id: publisherTargetId, trackedEntityId: entityId, userId, connectorId: "rss" as const, targetUrl: `${FEED_HOST}/news.xml`, metadata: { feedUrl: `${FEED_HOST}/news.xml` } };
    const googleNewsTarget = { id: googleNewsTargetId, trackedEntityId: entityId, userId, connectorId: "rss" as const, targetUrl: `${FEED_HOST}/gn.xml`, metadata: { feedUrl: `${FEED_HOST}/gn.xml`, newsQuery: true } };

    const fetchImpl = rssFetchImpl();

    // --- Source: GDELT (query target) ---
    const gdeltPoll = await pollPresenceTarget(env, { ...gdeltTarget, targetUrl: null } as unknown as SourceTargetRecord, { trackingMode: "self" });
    expect(gdeltPoll.ok).toBe(true);
    expect(gdeltPoll.items).toHaveLength(1);
    const gdeltUpsert = await upsertPresenceItems(env, { sourceTarget: { ...gdeltTarget, id: gdeltTargetId } as unknown as SourceTargetRecord, items: gdeltPoll.items });
    expect(gdeltUpsert.inserted).toBe(1);

    // --- Source: publisher RSS (feed target) ---
    const rssPoll = await rssConnectorPoll(env, publisherTarget, fetchImpl);
    expect(rssPoll.ok).toBe(true);
    expect(rssPoll.items.length).toBeGreaterThanOrEqual(1);
    expect(rssPoll.items.every((item) => item.canonicalUrl.startsWith("https://publisher.example.test"))).toBe(true);
    const rssUpsert = await upsertPresenceItems(env, { sourceTarget: publisherTarget as unknown as SourceTargetRecord, items: rssPoll.items });
    expect(rssUpsert.inserted).toBe(1);

    // --- Source: Google News RSS (query feed target via the rss connector) ---
    const gnPoll = await rssConnectorPoll(env, googleNewsTarget, fetchImpl);
    expect(gnPoll.ok).toBe(true);
    // Both fixtures resolved to the SAME canonical publisher URL before
    // hashing — the redirect ids carry utm variants of one story.
    expect(gnPoll.items).toHaveLength(2);
    for (const item of gnPoll.items) {
      expect(item.canonicalUrl.startsWith("https://publisher.example.test/acme-launch")).toBe(true);
      expect(item.canonicalUrl.includes("news.google.com")).toBe(false);
      expect(item.raw?.googleNewsRedirectUnresolved).toBeUndefined();
    }
    const gnUpsert = await upsertPresenceItems(env, { sourceTarget: googleNewsTarget as unknown as SourceTargetRecord, items: gnPoll.items });
    // Dedup inside one poll: two redirects, one canonical URL, ONE row.
    expect(gnUpsert.inserted).toBe(1);

    // Per-source row counts via the real read path
    const items = await listPresenceItems(env, userId, { trackedEntityId: entityId });
    const byConnector = new Map<PresenceConnectorId, number>();
    for (const item of items) {
      byConnector.set(item.connectorId, (byConnector.get(item.connectorId) ?? 0) + 1);
    }
    expect(byConnector.get("gdelt") ?? 0).toBeGreaterThanOrEqual(1);
    expect(byConnector.get("rss") ?? 0).toBeGreaterThanOrEqual(2); // publisher + google news

    // --- Dedup on repoll: identical polls insert zero new rows ---
    const gdeltRepoll = await pollPresenceTarget(env, { ...gdeltTarget, targetUrl: null } as unknown as SourceTargetRecord, { trackingMode: "self" });
    const gdeltReupsert = await upsertPresenceItems(env, { sourceTarget: { ...gdeltTarget, id: gdeltTargetId } as unknown as SourceTargetRecord, items: gdeltRepoll.items });
    expect(gdeltReupsert.inserted).toBe(0);
    const gnRepoll = await rssConnectorPoll(env, googleNewsTarget, fetchImpl);
    const gnReupsert = await upsertPresenceItems(env, { sourceTarget: googleNewsTarget as unknown as SourceTargetRecord, items: gnRepoll.items });
    expect(gnReupsert.inserted).toBe(0);

    // --- Coverage honesty: a disabled gate renders UNAVAILABLE, never "no data" ---
    const disabledEnv = { ...activatedEnv(), PRESENCE_GDELT_ROLLOUT: "disabled", PRESENCE_RSS_ROLLOUT: "disabled" } as AppEnv;
    expect((await evaluatePresenceSourceCoverage(disabledEnv, "gdelt", "self")).status).toBe("unavailable");
    expect((await evaluatePresenceSourceCoverage(disabledEnv, "rss", "self")).coverageLabel).toBe("UNAVAILABLE");
  });

  it("bounds Google News redirect resolution to the per-poll fetch budget", async () => {
    const env = activatedEnv();
    // Undecodable ids: base64url bytes with no http(s) URL inside, so every
    // link must take the bounded-fetch path or be flagged unresolved.
    const undecodable = (n: number) =>
      btoa(`no-url-${n}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const items = Array.from({ length: 12 }, (_, i) =>
      `<item><title>Undecodable ${i}</title><link>https://news.google.com/rss/articles/${undecodable(i)}?oc=5</link><guid>u-${i}</guid><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>`,
    ).join("");
    const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>GN</title>${items}</channel></rss>`;
    const fetchImpl = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/budget.xml") {
        return new Response(feed, { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
      return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;

    const poll = await rssConnector.poll(
      { env, userId: "u", trackingMode: "self", fetchImpl },
      { targetUrl: `${FEED_HOST}/budget.xml`, metadata: { feedUrl: `${FEED_HOST}/budget.xml`, newsQuery: true } },
    );
    expect(poll.ok).toBe(true);
    // 12 undecodable redirect links; the per-poll resolve budget is 10, so
    // news.google.com/rss/articles fetches must never exceed it.
    const redirectFetches = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]) => String(url).includes("news.google.com/rss/articles/"),
    ).length;
    expect(redirectFetches).toBeLessThanOrEqual(10);
    // Nothing is silently dropped: unresolved redirects keep their link and
    // carry the flag for read-time honesty.
    expect(poll.items).toHaveLength(12);
    expect(
      poll.items.filter((item) => item.raw?.googleNewsRedirectUnresolved === true),
    ).toHaveLength(12);
  });
});

async function rssConnectorPoll(
  env: AppEnv,
  target: { id: string; targetUrl: string | null; metadata: Record<string, unknown> },
  fetchImpl: typeof fetch,
) {
  return rssConnector.poll(
    { env, userId: "u", trackingMode: "self", fetchImpl },
    { targetUrl: target.targetUrl, metadata: target.metadata },
  );
}
