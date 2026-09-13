import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { pollPresenceTarget } from "~/lib/presence-connector-registry.server";
import { createTrackedEntity, listPresenceItems, upsertPresenceItems, upsertSourceTarget } from "~/lib/presence-data.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import type { AppEnv } from "~/lib/env.server";

import { appEnv, db, seedUser } from "./fixtures";

/**
 * Medium mention slice (Nishfleet/0509#3200, epic #3171, split of #3178).
 *
 * Medium rides the #3250 rss publication-feed path — the PLAN.md feasibility
 * column says exactly that ("today — rides `rss` connector") — so this suite
 * adds NO connector, NO registry branch, NO migration and NO new flag. What it
 * pins, on real workerd against the repo's real migrations, is the #3200
 * acceptance for the MEDIUM surface specifically:
 *
 * - the e2e fixture returns >=1 mention: a Medium-shaped publication feed
 *   (channel = the publication, items bylined, the tracked brand named in the
 *   story) dispatched through the REAL `pollPresenceTarget` path becomes a
 *   `presence_item` mention; the item that does not name the entity never does;
 * - deduped by canonical URL: a second identical dispatched poll + upsert
 *   inserts 0 (the UNIQUE (source_target_id, url_hash) key, where urlHash is
 *   `presenceUrlHash(item.canonicalUrl)` and canonicalUrl is the story's own
 *   link, never the feed URL);
 * - the documented rate budget: exactly ONE bounded fetch per feed per poll
 *   (metadata.feedUrl stored + feedDiscovery "direct" — no discovery hop, and
 *   the publication-feed branch of `resolveQueryFeedItemUrls` is a no-op), and
 *   the MAX_FEED_ITEMS=25 poll bound: a 30-item feed yields 25 items from that
 *   same single fetch — the 26th+ never surface;
 * - the per-source kill flag: `PRESENCE_RSS_ROLLOUT` (the surface's kill flag;
 *   rss needs no credentials) unset stops the FULL dispatched path before any
 *   request — `connector_not_operational`, zero hops, zero rows;
 * - the /status-graded coverage note: the `presenceSourceCoverageForDocs` rss
 *   entry states what the Medium public surface covers, productionStatus
 *   pinned "gated".
 *
 * Fixture host is the IP literal `1.1.1.1` so `resolvePublicHttpUrl` never
 * makes a DNS hop — no real network touched. The mention-match mechanics
 * (phrase derivation from label + canonical domain + notes aliases; the
 * publication-feed filter/stamp at `upsertPresenceItems`) are pinned by
 * rss-mention-backbone.integration.test.ts; this suite re-uses the same
 * derivation and asserts the mention contract, not the matcher.
 */

const PUBLIC_HOST = "https://1.1.1.1";
const FEED_PATH = "/feed/acme-engineering";
const FEED_URL = `${PUBLIC_HOST}${FEED_PATH}`;
const STORY_1 = `${FEED_URL}/designing-the-acme-edge-rollout-1a2b3c4d5e6f`;
const STORY_2 = `${FEED_URL}/weekend-reads-elsewhere-7g8h9i0j1k2l`;

const MEDIUM_PUBLICATION_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Acme Engineering — Medium</title>
  <link>${PUBLIC_HOST}/acme-engineering</link>
  <item>
    <title>Designing the Acme edge rollout</title>
    <link>${STORY_1}</link>
    <guid>${STORY_1}</guid>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <author>writer@acme.test (Acme Engineering)</author>
    <description>How the publication’s rollout team cut TTFB at the edge.</description>
  </item>
  <item>
    <title>Weekend reads: elsewhere on the internet</title>
    <link>${STORY_2}</link>
    <guid>${STORY_2}</guid>
    <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    <author>guest@elsewhere.test (Guest notebook)</author>
    <description>A link roundup with no publication-branded phrase in sight.</description>
  </item>
</channel></rss>`;

/** 30 items, every one naming the tracked brand — the 25-item parse bound does the cutting. */
function thirtyItemMediumFeed(): string {
  const items = Array.from({ length: 30 }, (_, i) => {
    const story = `${FEED_URL}/medium-note-${i + 1}`;
    return `  <item>
    <title>Acme builds in public, part ${i + 1}</title>
    <link>${story}</link>
    <guid>${story}</guid>
    <pubDate>Mon, 0${(i % 9) + 1} Jan 2024 00:00:00 GMT</pubDate>
    <author>writer@acme.test (Acme Engineering)</author>
    <description>Another Acme diary entry from the publication.</description>
  </item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Acme Engineering — Medium</title>
  <link>${PUBLIC_HOST}/acme-engineering</link>
${items}
</channel></rss>`;
}

function makeEnv(rollout?: string): AppEnv {
  return { ...appEnv, PRESENCE_RSS_ROLLOUT: rollout } as AppEnv;
}

function mediumFeedFetcher(body: string) {
  return vi.fn(async (url: string | URL) => {
    const u = new URL(url.toString());
    if (`${u.hostname}${u.pathname}` !== `1.1.1.1${FEED_PATH}`) {
      return new Response("not found", { status: 404 });
    }
    return new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" } });
  }) as unknown as typeof fetch;
}

async function seedMediumEntityAndTarget() {
  const userId = await seedUser();
  const entity = await createTrackedEntity(makeEnv("internal"), {
    userId,
    trackingMode: "self",
    label: "Acme",
    canonicalUrl: "https://acme.test",
    notes: "Aliases:\n- Acme Co",
  });
  const target = await upsertSourceTarget(makeEnv("internal"), {
    userId,
    trackedEntityId: entity.id,
    connectorId: "rss",
    targetKey: "acme-medium-publication-feed",
    targetUrl: FEED_URL,
    coverageLabel: "VERIFIED_PUBLIC_FEED",
    metadata: { feedUrl: FEED_URL, feedDiscovery: "direct" },
  });
  return { userId, entityId: entity.id, target };
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

describe("Medium mention connector (#3200) — the publication-feed surface, dispatched", () => {
  it("captures >=1 mention from a Medium publication feed through the real dispatched poll; the item that does not name the entity never becomes a row", async () => {
    const { userId, entityId, target } = await seedMediumEntityAndTarget();
    const fetchImpl = mediumFeedFetcher(MEDIUM_PUBLICATION_FEED);

    const poll = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    // The connector returns the raw feed items; the publication-feed mention
    // filter runs at upsertPresenceItems (the #3250 backbone contract).
    expect(poll.items).toHaveLength(2);
    // Every polled item's canonicalUrl is its own story link, never the feed URL.
    expect(poll.items.map((item) => item.canonicalUrl).sort()).toEqual([STORY_1, STORY_2].sort());

    const upsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(1);
    expect(await countLiveItems(target.id)).toBe(1);

    const listed = await listPresenceItems(makeEnv("internal"), userId, { trackedEntityId: entityId });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("Designing the Acme edge rollout");
    expect(listed[0]?.canonicalUrl).toBe(STORY_1);

    const mentionRow = await readMentionRow(target.id, STORY_1);
    expect(mentionRow).not.toBeNull();
    const mention = mentionRow?.mention as Record<string, unknown>;
    expect(mention?.matched).toBe(true);
    expect(mention?.matchedPhrase).toBe("Acme");
    expect(mention?.matchField).toBe("title");

    // The no-match weekend-roundup item: never a presence_item.
    expect(await readMentionRow(target.id, STORY_2)).toBeNull();
  });

  it("dedups by canonical URL: a second identical dispatched poll + upsert inserts 0 and exactly one mention remains", async () => {
    const { target } = await seedMediumEntityAndTarget();
    const fetchImpl = mediumFeedFetcher(MEDIUM_PUBLICATION_FEED);

    const first = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(first.ok).toBe(true);
    const firstUpsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: first.items });
    expect(firstUpsert.inserted).toBe(1);

    const second = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(second.ok).toBe(true);
    expect(second.items).toHaveLength(2);
    const secondUpsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: second.items });
    // Same story URLs -> same presenceUrlHash(url) -> the UNIQUE
    // (source_target_id, url_hash) key; identical content hash -> no revision.
    expect(secondUpsert.inserted).toBe(0);
    expect(await countLiveItems(target.id)).toBe(1);

    const stillThere = await readMentionRow(target.id, STORY_1);
    expect(stillThere).not.toBeNull();
    const mention = stillThere?.mention as Record<string, unknown>;
    expect(mention?.matched).toBe(true);
    expect(mention?.matchedPhrase).toBe("Acme");
  });

  it("keeps the documented rate budget: exactly ONE bounded fetch serves a full dispatched poll of the publication feed", async () => {
    const { target } = await seedMediumEntityAndTarget();
    const fetchImpl = mediumFeedFetcher(MEDIUM_PUBLICATION_FEED);

    const poll = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);

    // One feed, one poll, one hop: the stored metadata.feedUrl, fetched once.
    // No discovery (feedUrl + "direct"), no query-feed redirect resolution.
    const calls = (fetchImpl as Mock).mock.calls;
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toBe(FEED_URL);
  });

  it("never reads past the 25-item poll bound: a 30-item publication feed yields exactly 25 items from the same single fetch", async () => {
    const { target } = await seedMediumEntityAndTarget();
    const fetchImpl = mediumFeedFetcher(thirtyItemMediumFeed());

    const poll = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.items).toHaveLength(25);

    const urls = poll.items.map((item) => item.canonicalUrl);
    expect(urls.some((u) => u.includes("medium-note-26"))).toBe(false);

    // The bound costs nothing extra: still exactly one fetch.
    expect((fetchImpl as Mock).mock.calls).toHaveLength(1);

    const upsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(25);
    expect(await countLiveItems(target.id)).toBe(25);
  });

  it("capture-validity: the PRESENCE_RSS_ROLLOUT kill flag unset stops the dispatched path before any request — gated answer, zero hops, zero rows", async () => {
    const { target } = await seedMediumEntityAndTarget();
    const fetchImpl = mediumFeedFetcher(MEDIUM_PUBLICATION_FEED);

    const poll = await pollPresenceTarget(makeEnv(undefined), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("connector_not_operational");
    expect(poll.items).toEqual([]);

    expect((fetchImpl as Mock).mock.calls).toHaveLength(0);
    const upsert = await upsertPresenceItems(makeEnv(undefined), { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(0);
    expect(await countLiveItems(target.id)).toBe(0);
  });

  it("the /status-graded rss row states what the Medium public surface covers, productionStatus pinned gated", () => {
    const entry = presenceSourceCoverageForDocs().find((row) => row.sourceId === "rss");
    expect(entry).toBeDefined();
    expect(entry?.productionStatus).toBe("gated");
    expect(entry?.notes).toContain("Medium /feed/");
    expect(entry?.notes).toContain("publication-feed mention backbone");
    expect(entry?.notes).toContain("one bounded fetch per feed per poll");
    expect(entry?.notes).toContain("PRESENCE_RSS_ROLLOUT");
  });
});
