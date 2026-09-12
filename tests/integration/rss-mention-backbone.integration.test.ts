import { describe, expect, it, vi } from "vitest";

import { rssConnector } from "~/lib/presence-connectors/rss.server";
import { pollPresenceTarget } from "~/lib/presence-connector-registry.server";
import {
  createTrackedEntity,
  listPresenceItems,
  upsertPresenceItems,
  upsertSourceTarget,
} from "~/lib/presence-data.server";
import { evaluatePresenceSourceCoverage, presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext } from "~/lib/presence-types";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * RSS mention backbone — Phase 1 / MVP source 1 of the mention-monitoring
 * epic (Nishfleet/0509#3170, #3171). The end-to-end contract: a tracked
 * entity registers feed source targets against the existing `rss`
 * connector, polls produce `presence_item` rows that carry mention-match
 * metadata, and the coverage table still reports `rss` as gated while
 * `PRESENCE_RSS_ROLLOUT` is unset.
 *
 * Two feed shapes:
 * - **Publication feed** (publisher RSS / Substack / Medium / YouTube
 *   channel feeds). The connector emits raw items; `upsertPresenceItems`
 *   runs `mentionMatch` against the entity phrases and filters out items
 *   that do not name the entity — they never become `presence_item` rows.
 *   Items that match carry `raw.mention.matched_phrase` truthy.
 * - **Query feed** (Google News `/rss/search?q=...`). The surface has
 *   already pre-filtered to the query — every item is, by construction,
 *   a mention of the query phrase. `upsertPresenceItems` stamps every
 *   item with the query phrase as `matched_phrase` and `matchField:
 *   "query"`. Google News article links are `news.google.com` redirects;
 *   the connector resolves them through `presenceSafeFetch` and uses the
 *   publisher URL as `canonical_url`.
 *
 * The suite runs on real workerd via the `workers` vitest project — D1 is
 * the real binding with the repo's real migrations applied
 * (`source_target.connector_id` accepts 'rss' since migration 0093, so the
 * upsert path can write `connector_id = 'rss'` rows). Network hops go
 * through a mock `fetchImpl`; SSRF hardening is verified by feeding a
 * private-IP redirect target and asserting the connector never reaches
 * the fetch layer for it.
 */

const PUBLIC_HOST = "https://1.1.1.1";

const PUBLISHER_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Brand Blog</title>
  <link>${PUBLIC_HOST}</link>
  <item>
    <title>Why Acme launched its new line</title>
    <link>${PUBLIC_HOST}/posts/acme-line-1</link>
    <guid>${PUBLIC_HOST}/posts/acme-line-1</guid>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <description>A short Acme-focused post naming the brand and the domain acme.test in the body.</description>
  </item>
  <item>
    <title>Unrelated industry news</title>
    <link>${PUBLIC_HOST}/posts/unrelated</link>
    <guid>${PUBLIC_HOST}/posts/unrelated</guid>
    <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    <description>This post is purely about industry trends and never names the tracked brand anywhere.</description>
  </item>
  <item>
    <title>Domain-only mention in byline</title>
    <link>${PUBLIC_HOST}/posts/byline-mention</link>
    <guid>${PUBLIC_HOST}/posts/byline-mention</guid>
    <pubDate>Wed, 03 Jan 2024 00:00:00 GMT</pubDate>
    <author>newsroom@acme.test (Editor)</author>
    <description>No entity phrase in the body — only the byline domain.</description>
  </item>
  <item>
    <title>A new piece by Acme Co</title>
    <link>${PUBLIC_HOST}/posts/alias-mention</link>
    <guid>${PUBLIC_HOST}/posts/alias-mention</guid>
    <pubDate>Thu, 04 Jan 2024 00:00:00 GMT</pubDate>
    <description>An alias-only mention: the label "Acme" never appears, only the alias.</description>
  </item>
</channel></rss>`;

const EMPTY_PUBLISHER_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Empty Brand Blog</title><link>${PUBLIC_HOST}</link></channel></rss>`;

const NO_MATCH_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Unrelated News</title>
  <link>${PUBLIC_HOST}</link>
  <item>
    <title>Industry trend piece</title>
    <link>${PUBLIC_HOST}/posts/industry-1</link>
    <guid>${PUBLIC_HOST}/posts/industry-1</guid>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <description>Generic industry coverage with no brand mention.</description>
  </item>
  <item>
    <title>Another generic post</title>
    <link>${PUBLIC_HOST}/posts/industry-2</link>
    <guid>${PUBLIC_HOST}/posts/industry-2</guid>
    <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    <description>More industry coverage.</description>
  </item>
</channel></rss>`;

const QUERY_FEED_URL = `https://news.google.com/rss/search?q=Acme&hl=en-US&gl=US&ceid=US:en`;

const QUERY_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Google News — Acme</title>
  <link>${QUERY_FEED_URL}</link>
  <item>
    <title>Acme releases new product</title>
    <link>https://news.google.com/rss/articles/CBMiNewsAcme1</link>
    <guid>https://news.google.com/rss/articles/CBMiNewsAcme1</guid>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <description>Acme is in the news.</description>
  </item>
  <item>
    <title>Industry mentions Acme in passing</title>
    <link>https://news.google.com/rss/articles/CBMiNewsAcme2</link>
    <guid>https://news.google.com/rss/articles/CBMiNewsAcme2</guid>
    <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    <description>Industry coverage.</description>
  </item>
</channel></rss>`;

function makeEnv(rollout?: string): AppEnv {
  return { ...appEnv, PRESENCE_RSS_ROLLOUT: rollout } as AppEnv;
}

function makeCtx(
  fetchImpl: typeof fetch,
  rollout = "internal",
  trackingMode: "self" | "competitor" = "self",
): PresenceConnectorContext {
  return {
    env: makeEnv(rollout),
    userId: "user-rss-mention-1",
    trackingMode,
    connection: null,
    fetchImpl,
  };
}

/**
 * Build a mock fetcher that maps route path → response. Routes can be keyed
 * by either `${hostname}${pathname}` (most common) or by full URL string. The
 * matcher checks hostname+path first, then full URL, so a single map can mix
 * the two shapes without ambiguity.
 */
function feedFetcher(routes: Record<string, { body: string; contentType?: string; etag?: string }>) {
  // Build a normalized lookup table once so callers can pass URLs the way
  // they read naturally (`https://1.1.1.1/feed.xml`) and we still match the
  // hostname+path key the connector will actually hit.
  const normalizedRoutes = new Map<string, { body: string; contentType?: string; etag?: string }>();
  for (const [key, value] of Object.entries(routes)) {
    normalizedRoutes.set(key, value);
    try {
      const parsed = new URL(key);
      normalizedRoutes.set(`${parsed.hostname}${parsed.pathname}`, value);
    } catch {
      // key is not a URL (already a hostname+path); keep as-is
    }
  }

  return vi.fn(async (url: string | URL) => {
    const u = new URL(url.toString());
    const hostPath = `${u.hostname}${u.pathname}`;
    const fullUrl = u.toString();
    const route = normalizedRoutes.get(fullUrl) ?? normalizedRoutes.get(hostPath);
    if (!route) {
      return new Response("not found", { status: 404 });
    }
    const headers: Record<string, string> = { "content-type": route.contentType ?? "application/rss+xml" };
    if (route.etag) headers.etag = route.etag;
    return new Response(route.body, { status: 200, headers });
  }) as unknown as typeof fetch;
}

async function seedAcmeEntity(label = "Acme", notes: string | null = "Aliases:\n- Acme Co") {
  const userId = await seedUser();
  const entity = await createTrackedEntity(makeEnv(), {
    userId,
    trackingMode: "self",
    label,
    canonicalUrl: "https://acme.test",
    notes,
  });
  return { userId, entityId: entity.id, entity };
}

async function seedFeedTarget({
  userId,
  entityId,
  connectorId,
  targetKey,
  feedUrl,
  metadata,
}: {
  userId: string;
  entityId: string;
  connectorId: "rss";
  targetKey: string;
  feedUrl: string;
  metadata: Record<string, unknown>;
}) {
  return upsertSourceTarget(makeEnv(), {
    userId,
    trackedEntityId: entityId,
    connectorId,
    targetKey,
    targetUrl: feedUrl,
    coverageLabel: "VERIFIED_PUBLIC_FEED",
    metadata,
  });
}

async function readMentionRow(sourceTargetId: string, canonicalUrl: string) {
  const row = await db()
    .prepare(
      `SELECT raw_json FROM presence_item
       WHERE source_target_id = ? AND canonical_url = ? AND is_tombstone = 0`,
    )
    .bind(sourceTargetId, canonicalUrl)
    .first<{ raw_json: string | null }>();
  if (!row) return null;
  if (!row.raw_json) return null;
  return JSON.parse(row.raw_json) as Record<string, unknown>;
}

async function countLiveItems(sourceTargetId: string) {
  const row = await db()
    .prepare(
      `SELECT count(*) AS n FROM presence_item
       WHERE source_target_id = ? AND is_tombstone = 0`,
    )
    .bind(sourceTargetId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("rss mention backbone — publication feed match stamping (workerd/D1)", () => {
  it("stamps match metadata on items that name the entity, filters items that do not", async () => {
    const { userId, entityId } = await seedAcmeEntity();
    const target = await seedFeedTarget({
      userId,
      entityId,
      connectorId: "rss",
      targetKey: "acme-publisher-feed",
      feedUrl: `${PUBLIC_HOST}/feed.xml`,
      metadata: { feedUrl: `${PUBLIC_HOST}/feed.xml`, feedDiscovery: "direct" },
    });

    const fetchImpl = feedFetcher({
      [`${PUBLIC_HOST}/feed.xml`]: { body: PUBLISHER_FEED, contentType: "application/rss+xml" },
    });
    const env = makeEnv("internal");
    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.items).toHaveLength(4);

    const upsert = await upsertPresenceItems(env, { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(3);

    // The unrelated item must not have become a presence_item row.
    expect(await countLiveItems(target.id)).toBe(3);
    const listed = await listPresenceItems(env, userId, { trackedEntityId: entityId });
    const titles = listed.map((row) => row.title);
    expect(titles).not.toContain("Unrelated industry news");
    expect(titles).toContain("Why Acme launched its new line");
    expect(titles).toContain("Domain-only mention in byline");
    expect(titles).toContain("A new piece by Acme Co");

    // The title hit ("Acme") — field is "title", phrase is "Acme".
    const titleHit = await readMentionRow(target.id, `${PUBLIC_HOST}/posts/acme-line-1`);
    expect(titleHit).not.toBeNull();
    const titleMention = titleHit?.mention as Record<string, unknown>;
    expect(titleMention?.matched).toBe(true);
    expect(titleMention?.matchedPhrase).toBe("Acme");
    expect(titleMention?.matchField).toBe("title");

    // The byline hit ("acme.test" from the @author domain) — field is "author".
    const bylineHit = await readMentionRow(target.id, `${PUBLIC_HOST}/posts/byline-mention`);
    expect(bylineHit).not.toBeNull();
    const bylineMention = bylineHit?.mention as Record<string, unknown>;
    expect(bylineMention?.matched).toBe(true);
    expect(bylineMention?.matchField).toBe("author");

    // The alias hit ("Acme Co") — field is "title" (it appears in the title).
    const aliasHit = await readMentionRow(target.id, `${PUBLIC_HOST}/posts/alias-mention`);
    expect(aliasHit).not.toBeNull();
    const aliasMention = aliasHit?.mention as Record<string, unknown>;
    expect(aliasMention?.matched).toBe(true);
    expect(aliasMention?.matchedPhrase).toBe("Acme Co");
    expect(aliasMention?.matchField).toBe("title");
  });

  it("produces an honest empty mention set when no item names the entity", async () => {
    const { userId, entityId } = await seedAcmeEntity();
    const target = await seedFeedTarget({
      userId,
      entityId,
      connectorId: "rss",
      targetKey: "acme-no-match-feed",
      feedUrl: `${PUBLIC_HOST}/nomatch.xml`,
      metadata: { feedUrl: `${PUBLIC_HOST}/nomatch.xml`, feedDiscovery: "direct" },
    });

    const fetchImpl = feedFetcher({
      [`${PUBLIC_HOST}/nomatch.xml`]: { body: NO_MATCH_FEED, contentType: "application/rss+xml" },
    });
    const env = makeEnv("internal");
    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.items).toHaveLength(2);

    const upsert = await upsertPresenceItems(env, { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(0);
    expect(await countLiveItems(target.id)).toBe(0);
  });

  it("produces an honest empty mention set when the feed itself is empty", async () => {
    const { userId, entityId } = await seedAcmeEntity();
    const target = await seedFeedTarget({
      userId,
      entityId,
      connectorId: "rss",
      targetKey: "acme-empty-feed",
      feedUrl: `${PUBLIC_HOST}/empty.xml`,
      metadata: { feedUrl: `${PUBLIC_HOST}/empty.xml`, feedDiscovery: "direct" },
    });

    const fetchImpl = feedFetcher({
      [`${PUBLIC_HOST}/empty.xml`]: { body: EMPTY_PUBLISHER_FEED, contentType: "application/rss+xml" },
    });
    const env = makeEnv("internal");
    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.items).toEqual([]);

    const upsert = await upsertPresenceItems(env, { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(0);
    expect(await countLiveItems(target.id)).toBe(0);
  });
});

describe("rss mention backbone — query feed (Google News) match stamping", () => {
  it("treats every item as a mention of the query phrase and resolves the publisher URL", async () => {
    const { userId, entityId } = await seedAcmeEntity();
    const target = await seedFeedTarget({
      userId,
      entityId,
      connectorId: "rss",
      targetKey: QUERY_FEED_URL,
      feedUrl: QUERY_FEED_URL,
      metadata: { feedUrl: QUERY_FEED_URL, feedDiscovery: "direct" },
    });

    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(url.toString());
      const path = `${u.hostname}${u.pathname}`;

      // The connector resolves news.google.com article links via a manual-
      // redirect fetch — return a 302 with Location pointing at the
      // publisher URL so the connector follows it through `presenceSafeFetch`.
      if (u.hostname === "news.google.com" && u.pathname.startsWith("/rss/articles")) {
        return new Response(null, {
          status: 302,
          headers: { location: `${PUBLIC_HOST}${u.pathname.replace("/rss/articles", "/publisher")}` },
        });
      }

      if (path === `${PUBLIC_HOST}/publisher/CBMiNewsAcme1`) {
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (path === `${PUBLIC_HOST}/publisher/CBMiNewsAcme2`) {
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
      }

      if (path === `news.google.com/rss/search`) {
        return new Response(QUERY_FEED_XML, {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const env = makeEnv("internal");
    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.items).toHaveLength(2);

    // Every item's canonicalUrl is the publisher URL, never the news.google.com redirect.
    expect(poll.items[0]?.canonicalUrl).toBe(`${PUBLIC_HOST}/publisher/CBMiNewsAcme1`);
    expect(poll.items[1]?.canonicalUrl).toBe(`${PUBLIC_HOST}/publisher/CBMiNewsAcme2`);
    expect(poll.items[0]?.canonicalUrl).not.toContain("news.google.com");
    expect(poll.items[1]?.canonicalUrl).not.toContain("news.google.com");

    // The original news.google.com URL is preserved under raw.googleNewsRedirect.
    const firstRaw = poll.items[0]?.raw ?? {};
    expect(firstRaw.googleNewsRedirect).toBe("https://news.google.com/rss/articles/CBMiNewsAcme1");
    expect(firstRaw.googleNewsResolved).toBe(`${PUBLIC_HOST}/publisher/CBMiNewsAcme1`);

    const upsert = await upsertPresenceItems(env, { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(2);

    // Every persisted item has mention.matchedPhrase = "Acme" (the query) and matchField = "query".
    for (const item of poll.items) {
      const row = await readMentionRow(target.id, item.canonicalUrl);
      const mention = row?.mention as Record<string, unknown> | undefined;
      expect(mention?.matched).toBe(true);
      expect(mention?.matchedPhrase).toBe("Acme");
      expect(mention?.matchField).toBe("query");
    }
  });

  it("falls back to the news.google.com URL and records the redirect when resolution fails", async () => {
    const { userId, entityId } = await seedAcmeEntity();
    const target = await seedFeedTarget({
      userId,
      entityId,
      connectorId: "rss",
      targetKey: QUERY_FEED_URL,
      feedUrl: QUERY_FEED_URL,
      metadata: { feedUrl: QUERY_FEED_URL, feedDiscovery: "direct" },
    });

    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(url.toString());
      const path = `${u.hostname}${u.pathname}`;

      // Google News article links resolve to a private IP — the SSRF layer
      // rejects the hop, so the connector must keep the original URL.
      if (u.hostname === "news.google.com" && u.pathname.startsWith("/rss/articles")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://192.168.1.1/publisher/private" },
        });
      }
      if (path === `news.google.com/rss/search`) {
        return new Response(QUERY_FEED_XML, {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const env = makeEnv("internal");
    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.items).toHaveLength(2);

    // canonicalUrl stays the news.google.com URL (no fabricated publisher).
    expect(poll.items[0]?.canonicalUrl).toBe("https://news.google.com/rss/articles/CBMiNewsAcme1");
    const firstRaw = poll.items[0]?.raw ?? {};
    expect(firstRaw.googleNewsRedirect).toBe("https://news.google.com/rss/articles/CBMiNewsAcme1");
    expect(firstRaw.googleNewsResolved).toBeNull();

    const upsert = await upsertPresenceItems(env, { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(2);

    // The match metadata still stamps "Acme" (query) on every persisted row.
    const row = await readMentionRow(target.id, "https://news.google.com/rss/articles/CBMiNewsAcme1");
    const mention = row?.mention as Record<string, unknown> | undefined;
    expect(mention?.matched).toBe(true);
    expect(mention?.matchedPhrase).toBe("Acme");
    expect(mention?.matchField).toBe("query");
  });
});

describe("rss mention backbone — SSRF hardening", () => {
  it("rejects a private-IP query feed at the validateTarget boundary", async () => {
    const fetchImpl = feedFetcher({});
    const result = await rssConnector.validateTarget(
      { trackingMode: "self", targetUrl: `https://192.168.1.1/rss/search?q=Acme` },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(false);
    expect(result.coverageLabel).toBe("UNAVAILABLE");
    expect(result.errorCode).toBe("ssrf_blocked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-HTTP scheme for the feed URL with ssrf_blocked", async () => {
    const fetchImpl = feedFetcher({});
    const result = await rssConnector.validateTarget(
      { trackingMode: "self", targetUrl: `ftp://example.test/feed.xml` },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(false);
    expect(result.coverageLabel).toBe("UNAVAILABLE");
    expect(result.errorCode).toBe("ssrf_blocked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolves a Google News redirect through presenceSafeFetch — every hop is SSRF-checked", async () => {
    const { userId, entityId } = await seedAcmeEntity();
    const target = await seedFeedTarget({
      userId,
      entityId,
      connectorId: "rss",
      targetKey: QUERY_FEED_URL,
      feedUrl: QUERY_FEED_URL,
      metadata: { feedUrl: QUERY_FEED_URL, feedDiscovery: "direct" },
    });

    // The fetcher refuses ALL non-news.google.com hops — anything past the
    // initial 302 is a private-IP attempt and must be SSRF-blocked before
    // reaching the network. The spy also asserts every URL the connector
    // passes through is reachable through the SSRF layer.
    const seenUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(url.toString());
      seenUrls.push(u.toString());

      if (u.hostname === "news.google.com" && u.pathname.startsWith("/rss/articles")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://10.0.0.1/private" },
        });
      }
      if (u.hostname === "news.google.com" && u.pathname.startsWith("/rss/search")) {
        return new Response(QUERY_FEED_XML, {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        });
      }
      // Anything else is a private-IP hop that must NEVER be fetched.
      throw new Error(`unexpected SSRF hop: ${u.toString()}`);
    }) as unknown as typeof fetch;

    const env = makeEnv("internal");
    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);

    // Every URL the connector fetched went through the SSRF-checked layer —
    // no raw fetch to a private IP is reachable.
    for (const url of seenUrls) {
      const parsed = new URL(url);
      expect(parsed.protocol).toMatch(/^https?:$/);
      // The article URL is the only news.google.com host that resolves
      // through presenceSafeFetch; the SSRF layer MUST refuse any hop to a
      // private-IP redirect target. We asserted above via the throw, so we
      // also sanity-check that no URL in the seen list is a private IP.
      expect(parsed.hostname).not.toMatch(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/);
    }
  });
});

describe("rss mention backbone — coverage gating", () => {
  it("reports gated in presenceSourceCoverageForDocs even after the backbone is wired", () => {
    const docs = presenceSourceCoverageForDocs();
    const rss = docs.find((entry) => entry.sourceId === "rss");
    expect(rss).toBeDefined();
    expect(rss?.productionStatus).toBe("gated");
  });

  it("reports UNAVAILABLE coverage when PRESENCE_RSS_ROLLOUT is unset", async () => {
    const env = makeEnv(undefined);
    const entry = await evaluatePresenceSourceCoverage(env, "rss", "self");
    expect(entry.coverageLabel).toBe("UNAVAILABLE");
    expect(entry.reasonCode).toBe("connector_disabled");
  });

  it("reports UNAVAILABLE coverage when PRESENCE_RSS_ROLLOUT is 'disabled'", async () => {
    const env = makeEnv("disabled");
    const entry = await evaluatePresenceSourceCoverage(env, "rss", "self");
    expect(entry.coverageLabel).toBe("UNAVAILABLE");
    expect(entry.reasonCode).toBe("connector_disabled");
  });
});

describe("mention-match.server.ts — pure matcher unit checks (no DB)", () => {
  it("matches case-insensitively with word-boundary safety", async () => {
    const { mentionMatch, entityPhrasesFromRecord } = await import("~/lib/mention-match.server");
    const entity = entityPhrasesFromRecord({
      label: "Acme",
      canonicalUrl: "https://acme.test",
      notes: null,
    });
    expect(mentionMatch({ title: "Acme news", bodyExcerpt: null, author: null }, entity)).toMatchObject({
      matched: true,
      matchedPhrase: "Acme",
      matchField: "title",
    });
    expect(mentionMatch({ title: "AcmeApp launches", bodyExcerpt: null, author: null }, entity)).toMatchObject({
      matched: false,
    });
    expect(mentionMatch({ title: "By ACME co", bodyExcerpt: null, author: null }, entity)).toMatchObject({
      matched: true,
      matchedPhrase: "Acme",
    });
  });

  it("matches the canonical domain in the author field", async () => {
    const { mentionMatch, entityPhrasesFromRecord } = await import("~/lib/mention-match.server");
    const entity = entityPhrasesFromRecord({
      label: "Acme",
      canonicalUrl: "https://www.acme.test",
      notes: null,
    });
    expect(
      mentionMatch({ title: "Generic title", bodyExcerpt: "Generic body", author: "press@acme.test" }, entity),
    ).toMatchObject({ matched: true, matchField: "author" });
  });

  it("recognises Google News query-feed URLs and extracts the query phrase", async () => {
    const { isQueryFeedUrl, queryPhraseForFeed } = await import("~/lib/mention-match.server");
    expect(isQueryFeedUrl("https://news.google.com/rss/search?q=Acme&hl=en-US")).toBe(true);
    expect(isQueryFeedUrl("https://news.google.com/rss/articles/CBMiFoo")).toBe(false);
    expect(isQueryFeedUrl("https://example.test/feed.xml")).toBe(false);
    expect(isQueryFeedUrl("")).toBe(false);
    expect(queryPhraseForFeed("https://news.google.com/rss/search?q=Acme&hl=en-US")).toBe("Acme");
    expect(queryPhraseForFeed("https://news.google.com/rss/search?q=")).toBeNull();
  });

  it("ignores a separate uid for fixtures isolation", () => {
    // The fixtures helper produces per-test unique ids; assert the helper
    // works so a future reader can trace ids back to the seed call.
    expect(uid("test").startsWith("test_")).toBe(true);
  });
});
