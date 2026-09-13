import { describe, expect, it, vi } from "vitest";

import {
  MAX_TRANSCRIPTS_PER_POLL,
  normalizeEpisodeUrl,
  podcastConnector,
} from "~/lib/presence-connectors/podcast.server";
import { pollPresenceTarget } from "~/lib/presence-connector-registry.server";
import {
  listPresenceItems,
  listSourceTargetsForEntity,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import { getPresenceConnector } from "~/lib/presence-connector-registry.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import { PRESENCE_USER_AGENT } from "~/lib/presence-robots.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext } from "~/lib/presence-types";

import migrationSql from "../../migrations/0101_widen_source_target_connector_podcast.sql?raw";

import { appEnv, db, ISO_T0, uid } from "./fixtures";

/**
 * Podcast show-mention connector (Nishfleet/0509#3208) — the free, no-key,
 * no-auth feed-target source in the mentions epic (#3171).
 *
 * Runs on real workerd against the repo's real migrations, including the
 * CHECK-widening migration for 'podcast' — the write path (a
 * connector_id = 'podcast' row in source_target) and the read path are both
 * asserted against the real D1 engine, and the migration file itself is
 * re-applied in place to prove child-row preservation.
 *
 * Fixture hosts are IP-literals (1.1.1.1) so the suite touches no DNS; the
 * transcripts ride the same SSRF-hardened presenceSafeFetch path their
 * feed does (manual redirects, the presence User-Agent).
 *
 * Rate budget: ONE feed fetch per poll — conditional-GET, so a 304
 * short-circuit costs zero items and no transcript hops — plus at most
 * MAX_TRANSCRIPTS_PER_POLL (5) bounded transcript fetches, spent newest-first
 * on episodes exposing a JSON podcast:transcript. Other transcript formats
 * (text/vtt, application/x-subrip, text/html, text/plain) are recorded, not
 * fetched — the honest documented limit.
 *
 * Mentions: the connector emits every episode as a candidate; the
 * publication-feed mention-match step (presence-data, which knows 'podcast'
 * targets) stamps which phrase each episode names and filters the rest. The
 * tracked brand's capture lands through the FULL path — pollPresenceTarget →
 * upsertPresenceItems → listPresenceItems — deduped by canonical URL.
 */

const PHRASE = "Acme Robotics";
const SHOW_FEED_URL = "https://1.1.1.1/show.xml";
const EPISODE_42_URL = "https://1.1.1.1/episodes/42";
const EPISODE_41_ENCLOSURE = "https://1.1.1.1/audio/41.mp3";

const SHOW_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
  <title>Acme Robotics Radio</title>
  <link>https://1.1.1.1</link>
  <itunes:author>Acme Robotics Radio</itunes:author>
  <item>
    <title>Episode 42 — Inside the show</title>
    <link>https://1.1.1.1/episodes/42?utm_source=feed</link>
    <guid>https://1.1.1.1/episodes/42</guid>
    <pubDate>Thu, 10 Sep 2026 05:42:03 GMT</pubDate>
    <description>The week in Manufacturing.</description>
    <podcast:transcript url="https://1.1.1.1/transcripts/42.json" type="application/json" />
  </item>
  <item>
    <title>Acme Robotics ships Model 9</title>
    <guid>tag:show,2026:41</guid>
    <enclosure url="https://1.1.1.1/audio/41.mp3" type="audio/mpeg" length="1"/>
    <itunes:summary>Model 9 day.</itunes:summary>
    <podcast:transcript url="https://1.1.1.1/transcripts/41.vtt" type="text/vtt" />
    <pubDate>Wed, 09 Sep 2026 06:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Industry roundup</title>
    <link>https://1.1.1.1/episodes/40</link>
    <guid>https://1.1.1.1/episodes/40</guid>
    <pubDate>Tue, 08 Sep 2026 05:00:00 GMT</pubDate>
    <description>All about other companies, never the tracked one.</description>
  </item>
  <item>
    <title>Headless</title>
    <itunes:summary>No links here.</itunes:summary>
  </item>
</channel>
</rss>`;

const PLAIN_RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Plain</title><link>https://1.1.1.1/plain</link>
<item><title>Plain post</title><link>https://1.1.1.1/plain/1</link></item>
</channel></rss>`;

const HTML_PAGE = "<html><body>Not a feed.</body></html>";

const EMPTY_SHOW_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel><title>Empty Show</title><link>https://1.1.1.1/empty</link></channel>
</rss>`;

// fixed-date: fixture mirrors the documented Podcasting 2.0 JSON transcript
// shape (segments[] with text); the connector only parses the instant, it is
// never compared against a live clock.
const TRANSCRIPT_JSON = JSON.stringify({
  version: "1.0.0",
  segments: [
    { text: "Welcome to the show." },
    { text: "Today: how Acme Robotics builds the Model 9." },
    { text: "More after the break." },
  ],
});

const CAP_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel><title>Cap Show</title><link>https://1.1.1.1/cap</link>
${Array.from(
  { length: 7 },
  (_, i) => `  <item>
    <title>Cap episode ${i + 1}</title>
    <link>https://1.1.1.1/cap/${i + 1}</link>
    <guid>https://1.1.1.1/cap/${i + 1}</guid>
    <podcast:transcript url="https://1.1.1.1/cap-t/${i + 1}.json" type="application/podcast+json" />
  </item>`,
).join("\n")}
</channel>
</rss>`;

function makeEnv(rollout?: string): AppEnv {
  return { ...appEnv, PRESENCE_PODCAST_ROLLOUT: rollout } as AppEnv;
}

function makeCtx(
  fetchImpl: typeof fetch,
  rollout = "internal",
  trackingMode: "self" | "competitor" = "self",
): PresenceConnectorContext {
  return {
    env: makeEnv(rollout),
    userId: "user-podcast-1",
    trackingMode,
    connection: null,
    fetchImpl,
  };
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function xmlResponse(body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/rss+xml; charset=UTF-8", ...extraHeaders },
  });
}

/**
 * Fixture fetcher: routes keyed by exact URL. Feed + transcript hops both
 * ride presenceSafeFetch, so init carries redirect: "manual" and the
 * presence User-Agent — asserted once on the first call.
 */
function fixtureFetcher(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL) => {
    const route = routes[input.toString()];
    if (!route) return new Response("not found", { status: 404 });
    return route();
  }) as unknown as typeof fetch;
}

const SHOW_ROUTES: Record<string, () => Response> = {
  [SHOW_FEED_URL]: () => xmlResponse(SHOW_FEED_XML),
  "https://1.1.1.1/transcripts/42.json": () => jsonResponse(TRANSCRIPT_JSON),
};

const CAP_ROUTES: Record<string, () => Response> = (() => {
  const routes: Record<string, () => Response> = {
    "https://1.1.1.1/cap-feed.xml": () => xmlResponse(CAP_FEED_XML),
  };
  for (let i = 1; i <= 7; i += 1) {
    routes[`https://1.1.1.1/cap-t/${i}.json`] = () => jsonResponse(TRANSCRIPT_JSON);
  }
  return routes;
})();

/**
 * Stateful conditional-GET feed: the first poll answers 200 with an ETag, the
 * second answers 304 — and asserts the connector actually sent If-None-Match.
 */
function conditionalFeedFetcher() {
  let feedCalls = 0;
  const feedHeaders: Array<Record<string, string>> = [];
  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const path = input.toString();
    if (path === SHOW_FEED_URL) {
      feedCalls += 1;
      feedHeaders.push((init?.headers ?? {}) as Record<string, string>);
      if (feedCalls === 1) return xmlResponse(SHOW_FEED_XML, { etag: '"show-42"' });
      const ifNoneMatch =
        Object.keys(feedHeaders[feedHeaders.length - 1] ?? {})
          .map((key) => [key, (feedHeaders[feedHeaders.length - 1] ?? {})[key]] as const)
          .find(([key]) => key.toLowerCase() === "if-none-match")?.[1];
      expect(ifNoneMatch).toBe('"show-42"');
      return new Response(null, { status: 304, headers: { etag: '"show-42"' } });
    }
    if (path === "https://1.1.1.1/transcripts/42.json") return jsonResponse(TRANSCRIPT_JSON);
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, fetchMock: fetchImpl };
}

async function seedUser(id = uid("user")) {
  await db()
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, `Fixture ${id}`, `${id}@example.test`, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedPodcastTarget(options: { userId?: string; label?: string } = {}) {
  const userId = options.userId ?? (await seedUser());
  const entityId = uid("entity");
  const targetId = uid("target");
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', ?, 'https://www.acmerobotics.example/', NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, options.label ?? PHRASE, ISO_T0, ISO_T0)
    .run();
  // WRITE path against the real, CHECK-widened source_target table.
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, target_url,
         target_handle, metadata_json, coverage_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'podcast', ?, ?, NULL, ?, 'VERIFIED_PUBLIC_FEED', 1, ?, ?)`,
    )
    .bind(
      targetId,
      entityId,
      userId,
      "1.1.1.1/show.xml",
      SHOW_FEED_URL,
      JSON.stringify({ feedUrl: SHOW_FEED_URL, feedFormat: "podcast_rss", showTitle: "Acme Robotics Radio" }),
      ISO_T0,
      ISO_T0,
    )
    .run();
  return { userId, entityId, targetId };
}

async function countLivePresenceItems(sourceTargetId: string): Promise<number> {
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
  if (!row?.raw_json) return null;
  return JSON.parse(row.raw_json) as Record<string, unknown>;
}

describe("podcast mention connector — registration and docs coverage", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("podcast");
    expect(connector).toBe(podcastConnector);
    expect(connector.id).toBe("podcast");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated", () => {
    const docs = presenceSourceCoverageForDocs();
    const podcast = docs.find((entry) => entry.sourceId === "podcast");
    expect(podcast).toBeDefined();
    expect(podcast?.productionStatus).toBe("gated");
    expect(podcast?.label).toBe("Podcasts");
  });
});

describe("podcast mention connector — validateTarget", () => {
  it("accepts a show feed and emits the feed-target shape + metadata", async () => {
    const fetchImpl = fixtureFetcher({ [SHOW_FEED_URL]: () => xmlResponse(SHOW_FEED_XML) });
    const result = await podcastConnector.validateTarget(
      { trackingMode: "self", targetUrl: SHOW_FEED_URL },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(true);
    expect(result.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
    expect(result.targetKey).toBe("1.1.1.1/show.xml");
    expect(result.targetUrl).toBe(SHOW_FEED_URL);
    expect(result.metadata?.feedUrl).toBe(SHOW_FEED_URL);
    expect(result.metadata?.showTitle).toBe("Acme Robotics Radio");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("accepts a bare feed host without a scheme", async () => {
    const fetchImpl = fixtureFetcher({ [SHOW_FEED_URL]: () => xmlResponse(SHOW_FEED_XML) });
    const result = await podcastConnector.validateTarget(
      { trackingMode: "self", targetUrl: "1.1.1.1/show.xml" },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(true);
    expect(result.targetUrl).toBe(SHOW_FEED_URL);
  });

  it("rejects a plain RSS feed with no iTunes/podcast-namespace markers", async () => {
    const fetchImpl = fixtureFetcher({ "https://1.1.1.1/plain.xml": () => xmlResponse(PLAIN_RSS_XML) });
    const result = await podcastConnector.validateTarget(
      { trackingMode: "self", targetUrl: "https://1.1.1.1/plain.xml" },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("not_podcast_feed");
    expect(result.coverageLabel).toBe("UNAVAILABLE");
  });

  it("rejects a non-feed document", async () => {
    const fetchImpl = fixtureFetcher({ "https://1.1.1.1/page": () => new Response(HTML_PAGE, { status: 200, headers: { "content-type": "text/html" } }) });
    const result = await podcastConnector.validateTarget(
      { trackingMode: "self", targetUrl: "https://1.1.1.1/page" },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("not_a_feed");
  });

  it("rejects an unreachable feed honestly (no pending-discovery promise)", async () => {
    const fetchImpl = fixtureFetcher({});
    const result = await podcastConnector.validateTarget(
      { trackingMode: "self", targetUrl: "https://1.1.1.1/gone.xml" },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("feed_unavailable");
  });

  it("rejects a missing URL", async () => {
    const result = await podcastConnector.validateTarget(
      { trackingMode: "self" },
      makeCtx(fixtureFetcher({})),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_url");
  });
});

describe("podcast mention connector — poll", () => {
  it("emits the feed's episodes as candidates, reads the public JSON transcript into the excerpt, and holds the rate budget to 1 feed + 1 transcript fetch", async () => {
    const { targetId } = await seedPodcastTarget();
    const fetchImpl = fixtureFetcher(SHOW_ROUTES);
    const result = await podcastConnector.poll(
      makeCtx(fetchImpl),
      { targetUrl: SHOW_FEED_URL, metadata: { feedUrl: SHOW_FEED_URL } },
    );

    expect(result.ok).toBe(true);
    // Four fixture <item>s: the headless episode (no link, no guid-URL, no
    // enclosure) is skipped, never fabricated.
    expect(result.items).toHaveLength(3);
    expect(result.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
    expect(result.costUnits).toBe(1);

    const episode42 = result.items.find((item) => item.canonicalUrl === EPISODE_42_URL);
    expect(episode42).toBeDefined();
    // The utm-ified feed link is canonicalized: dedupe keys on the stripped URL.
    expect(episode42?.canonicalUrl).toBe(EPISODE_42_URL);
    expect(episode42?.externalId).toBe(EPISODE_42_URL);
    // fixed-date: the fixture's pubDate parsed to ISO — never a wall-clock read
    expect(episode42?.publishedAt).toBe("2026-09-10T05:42:03.000Z");
    // No episode-level itunes:author — the connector records the show's
    // channel author as raw.showAuthor provenance; the episode's own author
    // stays null, so the publication-feed mention-match (title > excerpt >
    // author) cannot match every episode of the show via the channel name.
    expect(episode42?.author).toBeNull();
    expect(episode42?.bodyExcerpt).toContain("The week in Manufacturing.");
    // The public transcript head reached the excerpt — the match surface.
    expect(episode42?.bodyExcerpt).toContain("Today: how Acme Robotics builds the Model 9");
    expect(episode42?.bodyExcerpt?.length).toBeLessThanOrEqual(280);
    expect((episode42?.raw as Record<string, unknown>)?.kind).toBe("podcast_episode");
    expect((episode42?.raw as Record<string, unknown>)?.transcriptFetched).toBe(true);
    expect((episode42?.raw as Record<string, unknown>)?.transcriptUrl).toBe("https://1.1.1.1/transcripts/42.json");
    expect(episode42?.contentHash).toBeTruthy();

    const episode41 = result.items.find((item) => item.canonicalUrl === EPISODE_41_ENCLOSURE);
    expect(episode41).toBeDefined();
    // No <link>: the guid is not a URL, so the enclosure is the canonical URL.
    expect(episode41?.canonicalUrl).toBe(EPISODE_41_ENCLOSURE);
    expect(episode41?.externalId).toBe("tag:show,2026:41");
    // fixed-date: the fixture's pubDate parsed to ISO — never a wall-clock read
    expect(episode41?.publishedAt).toBe("2026-09-09T06:00:00.000Z");
    // VTT transcript: recorded, NOT fetched (the honest documented limit).
    expect((episode41?.raw as Record<string, unknown>)?.transcriptUrl).toBe("https://1.1.1.1/transcripts/41.vtt");
    expect((episode41?.raw as Record<string, unknown>)?.transcriptType).toBe("text/vtt");
    expect((episode41?.raw as Record<string, unknown>)?.transcriptFetched).toBe(false);
    expect(episode41?.bodyExcerpt).toContain("Model 9 day.");

    // The unrelated episode IS emitted (the mention-match step filters later).
    const roundup = result.items.find((item) => item.canonicalUrl === "https://1.1.1.1/episodes/40");
    expect(roundup).toBeDefined();
    expect(roundup?.title).toBe("Industry roundup");

    // Rate budget: 1 feed + 1 JSON transcript = 2 hops. The VTT was never fetched.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Every hop rides the SSRF-hardened presenceSafeFetch contract.
    const firstCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const init = (firstCall[1] ?? {}) as RequestInit;
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(PRESENCE_USER_AGENT);
    expect(targetId).toBeTruthy();
  });

  it("answers 304 from the conditional-GET short-circuit with zero items and no transcript hops", async () => {
    const { fetchImpl } = conditionalFeedFetcher();
    const target = { targetUrl: SHOW_FEED_URL, metadata: { feedUrl: SHOW_FEED_URL } };

    const first = await podcastConnector.poll(makeCtx(fetchImpl), target);
    expect(first.ok).toBe(true);
    expect(first.items).toHaveLength(3);
    expect(first.etag).toBe('"show-42"');

    const second = await podcastConnector.poll(makeCtx(fetchImpl), target, { etag: first.etag });
    expect(second.ok).toBe(true);
    expect(second.items).toEqual([]);
    expect(second.costUnits).toBe(0);
    expect(second.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
    // 1st poll: feed + 1 transcript; 2nd poll: the 304'd feed only.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("caps transcript fetches at the documented politeness budget, newest-first", async () => {
    const fetchImpl = fixtureFetcher(CAP_ROUTES);
    const result = await podcastConnector.poll(
      makeCtx(fetchImpl),
      { targetUrl: "https://1.1.1.1/cap-feed.xml", metadata: { feedUrl: "https://1.1.1.1/cap-feed.xml" } },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(7);
    const transcribed = result.items.map(
      (item) => (item.raw as Record<string, unknown>)?.transcriptFetched === true,
    );
    expect(transcribed.filter(Boolean)).toHaveLength(MAX_TRANSCRIPTS_PER_POLL);
    // Newest-first: the FIRST five episodes got their transcripts read.
    expect(transcribed).toEqual([
      true, true, true, true, true, false, false,
    ]);
    // 1 feed + 5 transcripts = 6. Never 8.
    expect(fetchImpl).toHaveBeenCalledTimes(1 + MAX_TRANSCRIPTS_PER_POLL);
    expect(MAX_TRANSCRIPTS_PER_POLL).toBe(5);
  });

  it("refuses the poll without fetching when the rollout is off (credentials are always true — public show feed)", async () => {
    const fetchImpl = fixtureFetcher(SHOW_ROUTES);
    const result = await podcastConnector.poll(
      makeCtx(fetchImpl, "disabled"),
      { targetUrl: SHOW_FEED_URL, metadata: { feedUrl: SHOW_FEED_URL } },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("connector_disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a target with no URL without fetching", async () => {
    const fetchImpl = fixtureFetcher(SHOW_ROUTES);
    const result = await podcastConnector.poll(
      makeCtx(fetchImpl),
      { targetUrl: null, metadata: {} },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_target_url");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns ok: true, items: [] for an empty show feed (honest empty)", async () => {
    const fetchImpl = fixtureFetcher({ "https://1.1.1.1/empty.xml": () => xmlResponse(EMPTY_SHOW_FEED_XML) });
    const result = await podcastConnector.poll(
      makeCtx(fetchImpl),
      { targetUrl: "https://1.1.1.1/empty.xml", metadata: { feedUrl: "https://1.1.1.1/empty.xml" } },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
    // Not a complete snapshot: the reconcile step must not tombstone on it.
    expect(result.cursor?.completeSnapshot).toBe(false);
  });

  it("maps HTTP errors to honest degraded results, never fabricated items", async () => {
    const fetchImpl = fixtureFetcher({});
    const result = await podcastConnector.poll(
      makeCtx(fetchImpl),
      { targetUrl: "https://1.1.1.1/gone.xml", metadata: { feedUrl: "https://1.1.1.1/gone.xml" } },
    );
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    // A miss answers HTTP 404 — the honest degraded result is the connector's
    // feed_unavailable ("Feed responded with HTTP 404."), the same mapping the
    // validateTarget unreachable-feed test pins. fetch_failed is the no-response
    // (network-layer) code, not an HTTP-error code.
    expect(result.errorCode).toBe("feed_unavailable");
  });
});

describe("podcast mention connector — episode-URL canonicalization", () => {
  it("strips fragment and tracking params, keeps everything else verbatim", () => {
    expect(normalizeEpisodeUrl("https://1.1.1.1/ep/42?utm_source=feed&utm_medium=rss&id=9#top")).toBe(
      "https://1.1.1.1/ep/42?id=9",
    );
    expect(normalizeEpisodeUrl("https://1.1.1.1/ep/42?fbclid=x&gclid=y")).toBe("https://1.1.1.1/ep/42");
    expect(normalizeEpisodeUrl("https://1.1.1.1/ep/42/")).toBe("https://1.1.1.1/ep/42/");
  });

  it("keeps only http(s) episode URLs — anything else is not a canonical episode URL", () => {
    expect(normalizeEpisodeUrl("ftp://1.1.1.1/ep.mp3")).toBeNull();
    expect(normalizeEpisodeUrl("not a url")).toBeNull();
  });
});

describe("podcast mention connector — healthCheck", () => {
  it("reports pending while PRESENCE_PODCAST_ROLLOUT is unset", async () => {
    const result = await podcastConnector.healthCheck(makeCtx(fixtureFetcher({}), "disabled"));
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("reports healthy when the rollout is on (no credentials required)", async () => {
    const result = await podcastConnector.healthCheck(makeCtx(fixtureFetcher({})));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
    expect(result.summary).toContain("no credentials");
  });
});

describe("podcast mention connector — capture into the mention table (issue #3208)", () => {
  it("captures the fixture mentions into presence_item through the full poll -> upsert -> list path (>=1 mention, transcript-only phrase included), and dedupes by canonical URL", async () => {
    const { userId, entityId, targetId } = await seedPodcastTarget();
    const env = makeEnv("internal");

    // Refetch through the data layer so we operate on the real mapped record.
    const targets = await listSourceTargetsForEntity(env, userId, entityId);
    const target = targets.find((t) => t.connectorId === "podcast");
    expect(target).toBeDefined();
    if (!target) throw new Error("expected the seeded podcast source_target");

    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      fetchImpl: fixtureFetcher(SHOW_ROUTES),
    });
    expect(poll.ok, `poll: ${JSON.stringify(poll)}`).toBe(true);
    expect(poll.items).toHaveLength(3);

    // The publication-feed mention-match step stamps which phrase each
    // episode names and filters the rest: 3 candidates -> 2 mention rows.
    const upsert = await upsertPresenceItems(env, { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(2);
    expect(await countLivePresenceItems(target.id)).toBe(2);

    const items = await listPresenceItems(env, userId, {
      trackedEntityId: target.trackedEntityId,
      connectorId: "podcast",
    });
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.connectorId).toBe("podcast");
      expect(item.isTombstone).toBe(false);
      expect(item.urlHash).toBeTruthy();
      expect(item.contentHash).toBeTruthy();
    }
    const titles = items.map((item) => item.title);
    expect(titles).toContain("Episode 42 — Inside the show");
    expect(titles).toContain("Acme Robotics ships Model 9");
    expect(titles).not.toContain("Industry roundup");

    // The mention whose phrase ONLY appears in the public transcript — the
    // excerpt (and therefore the match) carries it, with the stripped
    // episode-URL dedupe key.
    const transcriptMention = await readMentionRow(targetId, EPISODE_42_URL);
    expect(transcriptMention).not.toBeNull();
    const transcriptMatch = transcriptMention?.mention as Record<string, unknown>;
    expect(transcriptMatch?.matched).toBe(true);
    expect(transcriptMatch?.matchedPhrase).toBe(PHRASE);
    expect(transcriptMatch?.matchField).toBe("bodyExcerpt");

    // The title-phrase mention: matchField is title, enclosure as the URL.
    const titleMention = await readMentionRow(targetId, EPISODE_41_ENCLOSURE);
    expect(titleMention).not.toBeNull();
    const titleMatch = titleMention?.mention as Record<string, unknown>;
    expect(titleMatch?.matched).toBe(true);
    expect(titleMatch?.matchedPhrase).toBe(PHRASE);
    expect(titleMatch?.matchField).toBe("title");

    // A second identical poll + upsert must NOT multiply rows — the same
    // canonical URL hashes to the same url_hash and updates the existing row.
    const pollAgain = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      fetchImpl: fixtureFetcher(SHOW_ROUTES),
    });
    expect(pollAgain.ok).toBe(true);
    expect(pollAgain.items).toHaveLength(3);
    await upsertPresenceItems(env, { sourceTarget: target, items: pollAgain.items });
    expect(await countLivePresenceItems(target.id)).toBe(2);

    const after = await listPresenceItems(env, userId, {
      trackedEntityId: target.trackedEntityId,
      connectorId: "podcast",
    });
    expect(after).toHaveLength(2);
    const before42 = items.find((item) => item.canonicalUrl === EPISODE_42_URL);
    const after42 = after.find((item) => item.canonicalUrl === EPISODE_42_URL);
    expect(after42?.id).toBe(before42?.id);
  });

  it("capture-validity gate: with the rollout kill flag off, the full path captures nothing and never fetches", async () => {
    const { userId, entityId, targetId } = await seedPodcastTarget();
    const listed = await listSourceTargetsForEntity(makeEnv("internal"), userId, entityId);
    const target = listed.find((t) => t.connectorId === "podcast");
    expect(target).toBeDefined();
    if (!target) throw new Error("expected the seeded podcast source_target");

    const fetchImpl = fixtureFetcher(SHOW_ROUTES);
    const poll = await pollPresenceTarget(makeEnv(undefined), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("connector_not_operational");
    expect(poll.items).toHaveLength(0);
    // The kill flag stops capture before any network hop.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await countLivePresenceItems(targetId)).toBe(0);
  });
});

describe("podcast mention connector — presence substrate (real migrations)", () => {
  it("writes connector_id = 'podcast' via the CHECK-widened migration and reads it back", async () => {
    // The real migrations — including 0101_widen_source_target_connector_podcast
    // — ran in the test setup, so the seeded write only succeeds when the CHECK
    // genuinely accepts 'podcast'.
    const { userId, entityId, targetId } = await seedPodcastTarget();
    const row = await db()
      .prepare(`SELECT connector_id, target_key, target_url, user_id, coverage_label FROM source_target WHERE id = ?`)
      .bind(targetId)
      .first<{ connector_id: string; target_key: string; target_url: string; user_id: string; coverage_label: string }>();
    // READ path: the widened row reads back through the real engine.
    expect(row?.connector_id).toBe("podcast");
    expect(row?.target_key).toBe("1.1.1.1/show.xml");
    expect(row?.target_url).toBe(SHOW_FEED_URL);
    expect(row?.user_id).toBe(userId);
    expect(row?.coverage_label).toBe("VERIFIED_PUBLIC_FEED");
    expect(entityId).toBeTruthy();
  });

  it("re-applies the 0101 migration cleanly and preserves child rows and every predecessor connector's rows", async () => {
    // Seed a full target + child rows, then re-run the real migration
    // statements in place — the rebuild must copy the podcast row through and
    // restore every cascaded child row set (0093 rebuild convention).
    const { userId, entityId, targetId } = await seedPodcastTarget();
    const itemId = uid("item");
    const revisionId = uid("rev");
    await db().batch([
      db().prepare(
        `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, canonical_url, url_hash, title, content_hash, revision, observed_at, created_at)
         VALUES (?, ?, ?, ?, 'podcast', ?, 'h', 't', 'ch', 1, 'o', 'c')`,
      ).bind(itemId, targetId, entityId, userId, EPISODE_42_URL),
      db().prepare(
        `INSERT INTO presence_poll_cursor (source_target_id, cursor_json, updated_at) VALUES (?, '{}', 'u')`,
      ).bind(targetId),
      db().prepare(
        `INSERT INTO presence_item_revision (id, presence_item_id, revision, content_hash, title, observed_at, created_at)
         VALUES (?, ?, 1, 'ch', 't', 'o', 'c')`,
      ).bind(revisionId, itemId),
    ]);

    // Predecessor rows must survive the copy too: 0101's CHECK is a superset
    // of 0100's (which itself healed every value back through the 0098 pair),
    // so these writes through the chain-final CHECK — one per non-podcast
    // value 0100 accepted — are the order-proof, and they must predate the
    // re-application to prove the COPY keeps them through the rebuild.
    const predecessorIds: Record<string, string> = {};
    for (const connectorId of ["website", "x", "reddit", "linkedin", "rss", "gdelt", "bluesky", "threads", "hn"]) {
      const predecessorTargetId = uid("target");
      predecessorIds[connectorId] = predecessorTargetId;
      await db().prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 'c', 'u')`,
      ).bind(predecessorTargetId, entityId, userId, connectorId, `${connectorId}-phrase`).run();
    }

    const statements = migrationSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    await db().batch(statements.map((sql) => db().prepare(sql)));

    const kept = await db()
      .prepare(`SELECT connector_id FROM source_target WHERE id = ?`)
      .bind(targetId)
      .first<{ connector_id: string }>();
    expect(kept?.connector_id).toBe("podcast");

    // Every predecessor row (nine connectors) survives the copy — the CHECK
    // union is order-proof whichever of 0100/0101 applied when.
    for (const [connectorId, predecessorTargetId] of Object.entries(predecessorIds)) {
      const healed = await db()
        .prepare(`SELECT connector_id, target_key FROM source_target WHERE id = ?`)
        .bind(predecessorTargetId)
        .first<{ connector_id: string; target_key: string }>();
      expect(healed?.connector_id).toBe(connectorId);
      expect(healed?.target_key).toBe(`${connectorId}-phrase`);
    }

    // The podcast row itself survives the rebuild alongside them. Local
    // storage isolates per test FILE, not per test (see fixtures), so earlier
    // suites' podcast rows persist — scope the survival count to this id.
    const podcastRows = await db()
      .prepare(`SELECT count(*) AS c FROM source_target WHERE connector_id = 'podcast' AND id = ?`)
      .bind(targetId)
      .first<{ c: number }>();
    expect(podcastRows?.c).toBe(1);

    for (const [table, where, arg] of [
      ["presence_item", "id = ?", itemId],
      ["presence_poll_cursor", "source_target_id = ?", targetId],
      ["presence_item_revision", "id = ?", revisionId],
    ] as const) {
      const row = await db()
        .prepare(`SELECT count(*) AS c FROM ${table} WHERE ${where}`)
        .bind(arg)
        .first<{ c: number }>();
      expect(row?.c).toBe(1);
    }
  });
});
