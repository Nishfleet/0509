import { describe, expect, it } from "vitest";

import {
  buildSearchListUrl,
  buildVideosListUrl,
  youtubeConnector,
} from "~/lib/presence-connectors/youtube.server";
import { pollPresenceTarget } from "~/lib/presence-connector-registry.server";
import { getPresenceConnector } from "~/lib/presence-connector-registry.server";
import { upsertPollCursor, upsertPresenceItems } from "~/lib/presence-data.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import { PRESENCE_USER_AGENT } from "~/lib/presence-robots.server";
import type { SourceTargetRecord } from "~/lib/presence-types";

import migrationSql from "../../migrations/0103_widen_source_target_connector_youtube.sql?raw";

import { db, uid } from "./fixtures";
import {
  closeOtherYoutubeWindows,
  EMPTY_PAGE,
  makeYoutubeCtx,
  makeYoutubeEnv,
  PHRASE,
  readYoutubeCursorJson,
  SEARCH_PAGE,
  SEARCH_PAGE_BOUNDARY_REREAD,
  SEARCH_PAGE_WITH_UNUSABLE,
  seedYoutubeTarget,
  VIDEO_A_ID,
  VIDEO_B_ID,
  VIDEO_B_PUBLISHED_AT,
  VIDEO_B_TITLE,
  VIDEO_C_ID,
  youtubeFetcher,
} from "./youtube-fixtures";

/**
 * YouTube mention connector (Nishfleet/0509#3203) — the fast-follow mention
 * source in the mentions epic (#3171), riding the #3178 adapter interface and
 * the 0103 CHECK widen.
 *
 * Runs on real workerd against the repo's real migrations, including the
 * CHECK-widening migration for 'youtube' — the write path (a
 * connector_id = 'youtube' row in source_target) and the read path are both
 * asserted against the real D1 engine, and the migration file itself is
 * re-applied in place to prove child-row preservation.
 *
 * Connector methods are network-shape contracts: a mock `fetchImpl` serves
 * fixture Google-Data-API-v3 search.list responses for
 * www.googleapis.com — the only real network touched is the public-IP check
 * inside `presenceSafeFetch` (resolvePublicHttpUrl DNS), matching the
 * gdelt/threads/hn suites.
 *
 * Shared fixtures (the captured search.list pages, the fetcher, the seeders,
 * the cursor helpers) live in ./youtube-fixtures.ts — the rate-budget suite
 * in ./youtube-mention-rate-budget.integration.test.ts rides the same module.
 */

describe("youtube mention connector — registration and docs coverage", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("youtube");
    expect(connector).toBe(youtubeConnector);
    expect(connector.id).toBe("youtube");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated", () => {
    const docs = presenceSourceCoverageForDocs();
    const youtube = docs.find((entry) => entry.sourceId === "youtube");
    expect(youtube).toBeDefined();
    expect(youtube?.productionStatus).toBe("gated");
  });
});

describe("youtube mention connector — validateTarget", () => {
  it("accepts a match phrase and emits target shape + metadata", async () => {
    const fetchImpl = youtubeFetcher(() => new Response("unreachable", { status: 500 }));
    const result = await youtubeConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: PHRASE },
      makeYoutubeCtx(fetchImpl, "ga"),
    );
    expect(result.ok).toBe(true);
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(result.targetKey).toBe(PHRASE.toLowerCase());
    expect(result.targetHandle).toBe(PHRASE);
    expect(result.metadata?.matchPhrase).toBe(PHRASE);
    // validateTarget is offline: no network hop (the documented 100
    // calls/day are never spent on target setup).
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is gated while PRESENCE_YOUTUBE_ROLLOUT is unset", async () => {
    const result = await youtubeConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: PHRASE },
      makeYoutubeCtx(youtubeFetcher(() => ({ body: "{}" })), undefined),
    );
    expect(result.ok).toBe(false);
    expect(result.coverageLabel).toBe("UNAVAILABLE");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("rejects a missing match phrase", async () => {
    const result = await youtubeConnector.validateTarget(
      { trackingMode: "competitor" },
      makeYoutubeCtx(youtubeFetcher(() => ({ body: "" })), "ga"),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_match_phrase");
  });
});

describe("youtube mention connector — poll", () => {
  it("fixture returns >=1 mention: watch-URL items with publishedAt/author/contentHash, ONE network call", async () => {
    const target = await seedYoutubeTarget();
    const requestedUrls: URL[] = [];
    const fetchImpl = youtubeFetcher((url) => {
      requestedUrls.push(url);
      return { body: SEARCH_PAGE };
    });

    // Through the REAL orchestrator — the production poll path.
    const poll = await pollPresenceTarget(makeYoutubeEnv("ga"), target, { trackingMode: "competitor" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.items).toHaveLength(2);
    expect(poll.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(poll.costUnits).toBe(1);

    const [first, second] = poll.items;
    // canonicalUrl is the PUBLIC watch page built from the API's own
    // id.videoId — never a googleapis.com API-hostname URL.
    expect(first?.canonicalUrl).toBe(`https://www.youtube.com/watch?v=${VIDEO_B_ID}`);
    expect(second?.canonicalUrl).toBe(`https://www.youtube.com/watch?v=${VIDEO_A_ID}`);
    expect(first?.externalId).toBe(VIDEO_B_ID);
    expect(first?.title).toBe(VIDEO_B_TITLE);
    expect(first?.publishedAt).toBe(VIDEO_B_PUBLISHED_AT);
    expect(first?.author).toBe("FixtureFactory"); // the channel DISPLAY name, plainly
    expect(second?.author).toBe("FixtureFactory");
    expect(first?.contentHash).not.toBe("");
    expect(second?.contentHash).not.toBe("");

    // Frugality: ONE serialized search.list request, no parallel fan-out.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestedUrl = requestedUrls[0];
    expect(requestedUrl?.host).toBe("www.googleapis.com");
    expect(requestedUrl?.searchParams.get("part")).toBe("snippet");
    expect(requestedUrl?.searchParams.get("type")).toBe("video");
    expect(requestedUrl?.searchParams.get("order")).toBe("date");
    expect(requestedUrl?.searchParams.get("maxResults")).toBe("50");
    expect(requestedUrl?.searchParams.get("key")).toBe("fixture-youtube-key-1");
    // A first poll has no watermark yet: no publishedAfter, and — the
    // no-deep-paging discipline — NO pageToken.
    expect(requestedUrl?.searchParams.has("publishedAfter")).toBe(false);
    expect(requestedUrl?.searchParams.has("pageToken")).toBe(false);

    // The usage window opened: this poll's SENT call is counted.
    expect((poll.cursor as Record<string, unknown>)?.youtubeUsage).toEqual({
      windowStart: expect.any(String),
      count: 1,
    });
  });

  it("capture-validity: a result without id.videoId is skipped, never fabricated, and the watermark still advances past it", async () => {
    const target = await seedYoutubeTarget();
    const fetchImpl = youtubeFetcher(() => ({ body: SEARCH_PAGE_WITH_UNUSABLE }));

    const poll = await youtubeConnector.poll(makeYoutubeCtx(fetchImpl, "ga"), target);
    expect(poll.ok).toBe(true);
    // Exactly the two? no — exactly ONE usable result survives.
    expect(poll.items).toHaveLength(1);
    expect(poll.items[0]?.canonicalUrl).toBe(`https://www.youtube.com/watch?v=${VIDEO_B_ID}`);

    // The skipped result does not stall the window: the watermark is the
    // NEWEST publishedAt the page returned, the unusable result's included.
    // fixed-date: verbatim value the page carried — the connector does no clock math
    expect(poll.cursor?.lastItemPublishedAt).toBe("2026-09-10T09:00:00Z");
    // And the skipped page still counted as a SENT call (empty results
    // count; so does a page whose results are all unusable).
    expect((poll.cursor as Record<string, unknown>)?.youtubeUsage).toEqual({
      windowStart: expect.any(String),
      count: 1,
    });
  });

  it("answers an honest empty page — and the call still counted", async () => {
    const target = await seedYoutubeTarget();
    const fetchImpl = youtubeFetcher(() => ({ body: EMPTY_PAGE }));

    const poll = await youtubeConnector.poll(makeYoutubeCtx(fetchImpl, "ga"), target);
    expect(poll.ok).toBe(true);
    expect(poll.items).toEqual([]);
    // No documented Threads-style empty-results-are-free exemption: the SENT
    // call costs 1 of the documented 100/day, so the window counted it.
    expect(poll.costUnits).toBe(1);
    expect((poll.cursor as Record<string, unknown>)?.youtubeUsage).toEqual({
      windowStart: expect.any(String),
      count: 1,
    });
    // An empty page yields NO watermark: the next poll retries the full
    // window rather than silently skipping it.
    expect(poll.cursor?.lastItemPublishedAt).toBeUndefined();
  });

  it("maps an HTTP error to an honest failure — and the failed call still counted the window", async () => {
    const target = await seedYoutubeTarget();
    const fetchImpl = youtubeFetcher(() => ({ body: "upstream 503", status: 500 }));

    const poll = await youtubeConnector.poll(makeYoutubeCtx(fetchImpl, "ga"), target);
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("youtube_api_error");
    expect(poll.items).toEqual([]);
    // The request was attempted; whether Google counted it is undocumented,
    // so the connector counts it — erring toward fewer real calls.
    expect((poll.cursor as Record<string, unknown>)?.youtubeUsage).toEqual({
      windowStart: expect.any(String),
      count: 1,
    });
    // No watermark from a failed poll: the service keeps the prior window
    // and the next poll retries it — a failure never silently skips mentions.
    expect(poll.cursor?.lastItemPublishedAt).toBeUndefined();
  });

  it("refuses the poll without fetching while the rollout is off", async () => {
    const target = await seedYoutubeTarget();
    const fetchImpl = youtubeFetcher(() => ({ body: SEARCH_PAGE }));

    const poll = await youtubeConnector.poll(makeYoutubeCtx(fetchImpl, undefined), target);
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("connector_disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a target with no match phrase without calling the API", async () => {
    const target = await seedYoutubeTarget();
    const bare: SourceTargetRecord = { ...target, metadata: {}, targetHandle: null, targetKey: "" };
    const fetchImpl = youtubeFetcher(() => ({ body: SEARCH_PAGE }));

    const poll = await youtubeConnector.poll(makeYoutubeCtx(fetchImpl, "ga"), bare);
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("missing_match_phrase");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("youtube mention connector — watermark round-trip through presence_poll_cursor", () => {
  it("persists the watermark the way the poll orchestrator does; the next poll sends it VERBATIM as the inclusive publishedAfter", async () => {
    const target = await seedYoutubeTarget();

    const first = await youtubeConnector.poll(makeYoutubeCtx(youtubeFetcher(() => ({ body: SEARCH_PAGE })), "ga"), target);
    expect(first.ok).toBe(true);
    // Persist the connector's returned cursor the way pollPresenceSourceTarget
    // does (cursor lands in presence_poll_cursor.cursor_json).
    await upsertPollCursor(makeYoutubeEnv("ga"), target.id, {
      cursor: first.cursor,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });

    const stored = await readYoutubeCursorJson(target.id);
    expect(stored.lastItemPublishedAt).toBe(VIDEO_B_PUBLISHED_AT);

    // The service passes the stored record back as cursor.record — the next
    // poll must resume from exactly that watermark, carried VERBATIM (no
    // clock math): the documented publishedAfter is INCLUSIVE, so the
    // boundary video may legitimately be read once more.
    let sawPublishedAfter: string | null = null;
    const second = await youtubeConnector.poll(
      makeYoutubeCtx(
        youtubeFetcher((url) => {
          sawPublishedAfter = url.searchParams.get("publishedAfter");
          return { body: EMPTY_PAGE };
        }),
        "ga",
      ),
      target,
      { record: stored },
    );
    expect(second.ok).toBe(true);
    expect(sawPublishedAfter).toBe(VIDEO_B_PUBLISHED_AT);
  });
});

describe("youtube mention connector — dedup by canonical URL (the inclusive publishedAfter boundary re-read)", () => {
  it("absorbs the re-read boundary video: the mention table never multiplies rows", async () => {
    const target = await seedYoutubeTarget();

    // Poll 1 — the boundary video (VIDEO_B, newest of the page) sets the
    // watermark; both videos become mentions.
    const first = await youtubeConnector.poll(makeYoutubeCtx(youtubeFetcher(() => ({ body: SEARCH_PAGE })), "ga"), target);
    expect(first.ok).toBe(true);
    const firstUpsert = await upsertPresenceItems(makeYoutubeEnv("ga"), { sourceTarget: target, items: first.items });
    expect(firstUpsert.inserted).toBe(2);

    // Persist the cursor the way the service does, then poll again through
    // the INCLUSIVE publishedAfter window — the documented semantics return
    // the boundary video ONE MORE TIME, alongside a genuinely new video.
    await upsertPollCursor(makeYoutubeEnv("ga"), target.id, {
      cursor: first.cursor,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });
    const stored = await readYoutubeCursorJson(target.id);
    const second = await youtubeConnector.poll(
      makeYoutubeCtx(youtubeFetcher(() => ({ body: SEARCH_PAGE_BOUNDARY_REREAD })), "ga"),
      target,
      { record: stored },
    );
    expect(second.ok).toBe(true);
    expect(second.items).toHaveLength(2); // VIDEO_C + the re-read VIDEO_B

    const secondUpsert = await upsertPresenceItems(makeYoutubeEnv("ga"), { sourceTarget: target, items: second.items });
    expect(secondUpsert.inserted).toBe(1); // only VIDEO_C was genuinely new
    expect(secondUpsert.updated).toBe(0); // the re-read VIDEO_B was absorbed, not revised

    // Dedup by canonical URL, exactly as the issue words it: three UNIQUE
    // watch URLs, the re-read boundary video present EXACTLY once.
    const rows = await db().prepare(
      `SELECT canonical_url, COUNT(*) AS n FROM presence_item
       WHERE source_target_id = ? GROUP BY canonical_url`,
    )
      .bind(target.id)
      .all<{ canonical_url: string; n: number }>();
    expect(rows.results).toHaveLength(3);
    for (const row of rows.results ?? []) {
      expect(row.n).toBe(1);
    }
    const urls = (rows.results ?? []).map((row) => row.canonical_url).sort();
    expect(urls).toEqual([
      `https://www.youtube.com/watch?v=${VIDEO_A_ID}`,
      `https://www.youtube.com/watch?v=${VIDEO_B_ID}`,
      `https://www.youtube.com/watch?v=${VIDEO_C_ID}`,
    ]);
  });
});

describe("youtube mention connector — healthCheck", () => {
  it("reports pending while PRESENCE_YOUTUBE_ROLLOUT is unset", async () => {
    const fetchImpl = youtubeFetcher(() => ({ body: "{}" }));
    const result = await youtubeConnector.healthCheck(makeYoutubeCtx(fetchImpl, undefined));
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("probes the documented videos.list read — NOT one of the 100 dedicated search.list calls — and reports healthy", async () => {
    const requested: URL[] = [];
    const fetchImpl = youtubeFetcher((url) => {
      requested.push(url);
      return { body: JSON.stringify({ kind: "youtube#videoListResponse", items: [{ id: "probe" }] }) };
    });
    const result = await youtubeConnector.healthCheck(makeYoutubeCtx(fetchImpl, "ga"));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // The cheapest honest liveness question: ONE row, chart=mostPopular,
    // on /videos — the documented 10,000-units/day combined bucket, not the
    // dedicated 100-call search bucket.
    expect(requested[0]?.pathname).toBe("/youtube/v3/videos");
    expect(requested[0]?.searchParams.get("part")).toBe("id");
    expect(requested[0]?.searchParams.get("chart")).toBe("mostPopular");
    expect(requested[0]?.searchParams.get("maxResults")).toBe("1");
    expect(requested[0]?.searchParams.get("key")).toBe("fixture-youtube-key-1");
  });

  it("reports degraded when the public endpoint fails", async () => {
    const fetchImpl = youtubeFetcher(() => ({ body: "unreachable", status: 500 }));
    const result = await youtubeConnector.healthCheck(makeYoutubeCtx(fetchImpl, "ga"));
    expect(result.ok).toBe(false);
    expect(result.status).toBe("degraded");
    expect(result.errorCode).toBe("youtube_unreachable");
  });
});

describe("youtube mention connector — request shape", () => {
  it("builds the documented search.list URL: part=snippet, type=video, order=date, one page of 50", () => {
    const url = new URL(buildSearchListUrl(PHRASE, "fixture-youtube-key-1", null));
    expect(url.origin).toBe("https://www.googleapis.com");
    expect(url.pathname).toBe("/youtube/v3/search");
    expect(url.searchParams.get("part")).toBe("snippet");
    expect(url.searchParams.get("type")).toBe("video");
    expect(url.searchParams.get("q")).toBe(PHRASE);
    expect(url.searchParams.get("order")).toBe("date");
    expect(url.searchParams.get("maxResults")).toBe("50");
    expect(url.searchParams.get("key")).toBe("fixture-youtube-key-1");
    expect(url.searchParams.has("publishedAfter")).toBe(false);
    expect(url.searchParams.has("pageToken")).toBe(false);
  });

  it("carries the watermark as the documented publishedAfter parameter, VERBATIM (inclusive semantics)", () => {
    const url = new URL(buildSearchListUrl(PHRASE, "fixture-youtube-key-1", VIDEO_B_PUBLISHED_AT));
    expect(url.searchParams.get("publishedAfter")).toBe(VIDEO_B_PUBLISHED_AT);
    expect(url.searchParams.has("pageToken")).toBe(false);
  });

  it("builds the documented one-row videos.list liveness probe", () => {
    const url = new URL(buildVideosListUrl("fixture-youtube-key-1"));
    expect(url.pathname).toBe("/youtube/v3/videos");
    expect(url.searchParams.get("part")).toBe("id");
    expect(url.searchParams.get("chart")).toBe("mostPopular");
    expect(url.searchParams.get("maxResults")).toBe("1");
    expect(url.searchParams.get("key")).toBe("fixture-youtube-key-1");
  });

  it("sends the house PRESENCE_USER_AGENT through presenceSafeFetch", async () => {
    const target = await seedYoutubeTarget();
    // The one-principal usage: earlier its' calls ride the shared window —
    // rotate them closed so THIS its' poll actually reaches the wire.
    await closeOtherYoutubeWindows(target.id);
    const fetchImpl = youtubeFetcher(() => ({ body: EMPTY_PAGE }));
    await youtubeConnector.poll(makeYoutubeCtx(fetchImpl, "ga"), target);
    const init = (fetchImpl as unknown as { mock: { calls: Array<Array<unknown>> } }).mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    expect((init?.headers as Record<string, string> | undefined)?.["User-Agent"] ?? (init?.headers as Record<string, string> | undefined)?.["user-agent"]).toBe(PRESENCE_USER_AGENT);
  });
});

describe("youtube mention connector — presence substrate (real migrations)", () => {
  it("writes connector_id = 'youtube' via the CHECK-widened migration and reads it back", async () => {
    // The real migrations — including
    // 0103_widen_source_target_connector_youtube — ran in the test setup, so
    // this write only succeeds when the CHECK genuinely accepts 'youtube'.
    const target = await seedYoutubeTarget();
    const row = await db().prepare(
      `SELECT connector_id, target_key, user_id FROM source_target WHERE id = ?`,
    )
      .bind(target.id)
      .first<{ connector_id: string; target_key: string; user_id: string }>();
    // READ path: the widened row reads back through the real engine.
    expect(row?.connector_id).toBe("youtube");
    expect(row?.target_key).toBe(PHRASE.toLowerCase());
    expect(row?.user_id).toBe(target.userId);
  });

  it("re-applies the 0103 migration cleanly and preserves child rows and every predecessor connector's rows", async () => {
    // Seed a full target + child rows, then re-run the real migration
    // statements in place — the rebuild must copy the youtube row through
    // and restore every cascaded child row set (0100/0099/0093 convention).
    const target = await seedYoutubeTarget();
    const itemId = uid("item");
    const revisionId = uid("rev");
    await db().batch([
      db().prepare(
        `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, canonical_url, url_hash, title, content_hash, revision, observed_at, created_at)
         VALUES (?, ?, ?, ?, 'youtube', ?, 'h', 't', 'ch', 1, 'o', 'c')`,
      ).bind(itemId, target.id, target.trackedEntityId, target.userId, `https://www.youtube.com/watch?v=${VIDEO_A_ID}`),
      db().prepare(
        `INSERT INTO presence_poll_cursor (source_target_id, cursor_json, updated_at) VALUES (?, '{}', 'u')`,
      ).bind(target.id),
      db().prepare(
        `INSERT INTO presence_item_revision (id, presence_item_id, revision, content_hash, title, observed_at, created_at)
         VALUES (?, ?, 1, 'ch', 't', 'o', 'c')`,
      ).bind(revisionId, itemId),
    ]);

    // Predecessor rows must survive the copy too: 0103's CHECK is a superset
    // of 0102_podcast's (which itself carries 0101's, 0100's, 0099's, 0098's,
    // and 0093's unions), so these writes — one per non-youtube value the
    // 0102_podcast CHECK accepted — are the order-proof, and they must
    // predate the re-application to prove the COPY keeps them through the
    // rebuild. 'pinterest' is the regression proof for the pre-0102 era and
    // 'podcast' is the one for this widen: 0103_youtube applies AFTER
    // 0102_podcast (podcast < youtube, prod already carries podcast rows)
    // and its CHECK must keep podcast rows alive — a CHECK missing
    // 'podcast' would fail the INSERT..SELECT copy outright.
    const predecessorIds: Record<string, string> = {};
    for (const connectorId of ["website", "x", "reddit", "linkedin", "rss", "gdelt", "bluesky", "threads", "hn", "pinterest", "podcast"]) {
      const predecessorTargetId = uid("target");
      predecessorIds[connectorId] = predecessorTargetId;
      await db().prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 'c', 'u')`,
      ).bind(predecessorTargetId, target.trackedEntityId, target.userId, connectorId, `${connectorId}-phrase`).run();
    }

    const statements = migrationSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    await db().batch(statements.map((sql) => db().prepare(sql)));

    const kept = await db().prepare(`SELECT connector_id FROM source_target WHERE id = ?`)
      .bind(target.id)
      .first<{ connector_id: string }>();
    expect(kept?.connector_id).toBe("youtube");

    // Every predecessor row (eleven connectors, pinterest and podcast
    // included) survives the copy — the CHECK union is order-proof whichever
    // of 0102_podcast/0103_youtube applied when.
    for (const [connectorId, predecessorTargetId] of Object.entries(predecessorIds)) {
      const healed = await db().prepare(`SELECT connector_id, target_key FROM source_target WHERE id = ?`)
        .bind(predecessorTargetId)
        .first<{ connector_id: string; target_key: string }>();
      expect(healed?.connector_id).toBe(connectorId);
      expect(healed?.target_key).toBe(`${connectorId}-phrase`);
    }

    // Child rows restored: the cascade would have wiped them on the parent
    // drop; the backup-table restore must put every child back.
    const item = await db().prepare(`SELECT id FROM presence_item WHERE id = ?`)
      .bind(itemId)
      .first<{ id: string }>();
    const cursor = await db().prepare(`SELECT source_target_id FROM presence_poll_cursor WHERE source_target_id = ?`)
      .bind(target.id)
      .first<{ source_target_id: string }>();
    const revision = await db().prepare(`SELECT id FROM presence_item_revision WHERE id = ?`)
      .bind(revisionId)
      .first<{ id: string }>();
    expect(item?.id).toBe(itemId);
    expect(cursor?.source_target_id).toBe(target.id);
    expect(revision?.id).toBe(revisionId);
  });
});
