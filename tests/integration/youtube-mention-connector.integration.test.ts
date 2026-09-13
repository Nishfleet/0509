import { describe, expect, it, vi } from "vitest";

import {
  buildSearchListUrl,
  buildVideosListUrl,
  YOUTUBE_DAILY_SEARCH_CAP,
  youtubeConnector,
} from "~/lib/presence-connectors/youtube.server";
import { pollPresenceTarget } from "~/lib/presence-connector-registry.server";
import { getPresenceConnector } from "~/lib/presence-connector-registry.server";
import { upsertPollCursor, upsertPresenceItems } from "~/lib/presence-data.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import { PRESENCE_USER_AGENT } from "~/lib/presence-robots.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext, SourceTargetRecord } from "~/lib/presence-types";

import migrationSql from "../../migrations/0101_widen_source_target_connector_youtube.sql?raw";

import { appEnv, ISO_T0, uid } from "./fixtures";

/**
 * YouTube mention connector (Nishfleet/0509#3203) — the fast-follow mention
 * source in the mentions epic (#3171), riding the #3178 adapter interface and
 * the 0101 CHECK widen.
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
 * Rate budget: the documented default allocation of 100 search.list
 * calls/day (developers.google.com/youtube/v3/determine_quota_cost) is a
 * COUNT of calls, shared by EVERY tracked brand (one Google project = one
 * key = one principal). The suite pins the connector's duty-to-be-frugal
 * contract: ONE serialized request per poll, no pageToken walking (one page
 * of the documented inclusive maxResults=50, `order=date`), the documented
 * inclusive `publishedAfter` carrying the window forward, every SENT call
 * counted (empty results still count — there is no documented
 * Threads-style exemption; a failed call counts too — whether Google counted
 * it is undocumented, so we err toward fewer real calls) — the window riding
 * presence_poll_cursor.cursor_json as `youtubeUsage`, summed across every
 * youtube target, closed windows no longer counting.
 */

const PHRASE = "Acme Robotics";

// fixed-date: fixture mirrors a captured search.list item; the connector only
// parses the publishedAt instant, it is never compared against a live clock.
const VIDEO_A_ID = "aB3dEf7hI9k";
const VIDEO_A_PUBLISHED_AT = "2026-09-10T05:42:03Z"; // fixed-date
const VIDEO_A_TITLE = "Acme Robotics launches its warehouse robot";

const VIDEO_B_ID = "mN2pQr5sT8v";
const VIDEO_B_PUBLISHED_AT = "2026-09-10T07:15:00Z"; // fixed-date — the boundary instant
const VIDEO_B_TITLE = "Inside Acme Robotics' new assembly plant";

// The boundary re-read: because documented publishedAfter semantics are
// INCLUSIVE ("at or after"), the next poll legitimately returns the boundary
// video again — the mention table's (source_target_id, url_hash) uniqueness
// must absorb it.
const VIDEO_C_ID = "zY1xW2v3U4t";
const VIDEO_C_PUBLISHED_AT = "2026-09-10T09:30:00Z"; // fixed-date — new after the boundary
const VIDEO_C_TITLE = "Acme Robotics ships its first autonomy stack";

const SEARCH_PAGE = JSON.stringify({
  kind: "youtube#searchListResponse",
  items: [
    {
      // order=date: newest first. (fixed-date fixture, see above)
      id: { kind: "youtube#video", videoId: VIDEO_B_ID },
      snippet: {
        publishedAt: VIDEO_B_PUBLISHED_AT,
        channelId: "UCfixture0001",
        title: VIDEO_B_TITLE,
        description: "A walkthrough of the new plant, mentioning Acme Robotics twice.",
        channelTitle: "FixtureFactory",
      },
    },
    {
      id: { kind: "youtube#video", videoId: VIDEO_A_ID },
      snippet: {
        publishedAt: VIDEO_A_PUBLISHED_AT,
        channelId: "UCfixture0001",
        title: VIDEO_A_TITLE,
        description: "",
        channelTitle: "FixtureFactory",
      },
    },
  ],
});

const SEARCH_PAGE_WITH_UNUSABLE = JSON.stringify({
  kind: "youtube#searchListResponse",
  items: [
    {
      // A channel result (type=video should exclude it, but the documented
      // "may return fewer/different items" caveat means the connector must
      // SKIP what it cannot turn into a watch URL, never fabricate one) —
      // and its publishedAt is the NEWEST of the page, so the watermark must
      // still advance past it.
      id: { kind: "youtube#channel", channelId: "UCq0FixtureChannel" },
      snippet: {
        publishedAt: "2026-09-10T09:00:00Z", // fixed-date — newest of the page
        channelId: "UCq0FixtureChannel",
        title: "Acme Robotics",
        description: "The channel itself, not a video.",
        channelTitle: "Acme Robotics",
      },
    },
    {
      id: { kind: "youtube#video", videoId: VIDEO_B_ID },
      snippet: {
        publishedAt: VIDEO_B_PUBLISHED_AT,
        channelId: "UCfixture0001",
        title: VIDEO_B_TITLE,
        description: "A walkthrough of the new plant, mentioning Acme Robotics twice.",
        channelTitle: "FixtureFactory",
      },
    },
  ],
});

// The boundary re-read page: the inclusive publishedAfter means the SAME
// boundary video returns AGAIN, alongside one genuinely new video.
const SEARCH_PAGE_BOUNDARY_REREAD = JSON.stringify({
  kind: "youtube#searchListResponse",
  items: [
    {
      id: { kind: "youtube#video", videoId: VIDEO_C_ID },
      snippet: {
        publishedAt: VIDEO_C_PUBLISHED_AT,
        channelId: "UCfixture0001",
        title: VIDEO_C_TITLE,
        description: "The autonomy stack, explained.",
        channelTitle: "FixtureFactory",
      },
    },
    {
      // The SAME boundary video, returned once more by the inclusive filter.
      id: { kind: "youtube#video", videoId: VIDEO_B_ID },
      snippet: {
        publishedAt: VIDEO_B_PUBLISHED_AT,
        channelId: "UCfixture0001",
        title: VIDEO_B_TITLE,
        description: "A walkthrough of the new plant, mentioning Acme Robotics twice.",
        channelTitle: "FixtureFactory",
      },
    },
  ],
});

const EMPTY_PAGE = JSON.stringify({ kind: "youtube#searchListResponse", items: [] });

function makeEnv(rollout: string | undefined, apiKey: string | undefined = "fixture-youtube-key-1"): AppEnv {
  return {
    ...appEnv,
    PRESENCE_YOUTUBE_ROLLOUT: rollout,
    YOUTUBE_API_KEY: apiKey,
  } as AppEnv;
}

function makeCtx(
  fetchImpl: typeof fetch,
  rollout: string | undefined,
  trackingMode: "self" | "competitor" = "competitor",
): PresenceConnectorContext {
  return {
    env: makeEnv(rollout),
    userId: "user-yt-1",
    trackingMode,
    connection: null,
    fetchImpl,
  };
}

/** Fixture fetcher for the www.googleapis.com Data API v3 shape. */
function youtubeFetcher(
  handler: (url: URL) => { body: string; status?: number } | Response,
) {
  return vi.fn(async (input: string | URL) => {
    const response = handler(new URL(input.toString()));
    if (response instanceof Response) return response;
    return new Response(response.body, {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function seedUser(id = uid("user")) {
  await appEnv.DB.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, `Fixture ${id}`, `${id}@example.test`, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedYoutubeTarget(
  options: { userId?: string; phrase?: string; connectorId?: string } = {},
): Promise<SourceTargetRecord> {
  const userId = options.userId ?? (await seedUser());
  const entityId = uid("entity");
  const targetId = uid("target");
  const phrase = options.phrase ?? PHRASE;
  const connectorId = options.connectorId ?? "youtube";
  // The tracked_entity parent must precede the source_target child: the real
  // D1 FK (source_target.tracked_entity_id -> tracked_entity.id, 0055) rejects
  // the orphan — the same seeding order the x-mention suite (issue #3198) uses.
  await appEnv.DB.prepare(
    `INSERT INTO tracked_entity (
       id, user_id, tracking_mode, label, canonical_url, notes,
       is_active, created_at, updated_at
     ) VALUES (?, ?, 'competitor', ?, NULL, NULL, 1, ?, ?)`,
  )
    .bind(entityId, userId, phrase, ISO_T0, ISO_T0)
    .run();
  // WRITE path against the real, CHECK-widened source_target table: a
  // connector_id = 'youtube' row only inserts when 0101's CHECK accepts it.
  await appEnv.DB.prepare(
    `INSERT INTO source_target (
       id, tracked_entity_id, user_id, connector_id, target_key, target_url,
       target_handle, metadata_json, coverage_label, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'OFFICIAL_PUBLIC_API', 1, ?, ?)`,
  )
    .bind(
      targetId,
      entityId,
      userId,
      connectorId,
      phrase.toLowerCase(),
      phrase,
      JSON.stringify({ matchPhrase: phrase }),
      ISO_T0,
      ISO_T0,
    )
    .run();
  return {
    id: targetId,
    trackedEntityId: entityId,
    userId,
    connectorId: connectorId === "youtube" ? "youtube" : (connectorId as SourceTargetRecord["connectorId"]),
    targetKey: phrase.toLowerCase(),
    targetUrl: null,
    targetHandle: phrase,
    metadata: { matchPhrase: phrase },
    coverageLabel: "OFFICIAL_PUBLIC_API",
    isActive: true,
    deletedAt: null,
    createdAt: ISO_T0,
    updatedAt: ISO_T0,
  };
}

async function readCursorJson(targetId: string): Promise<Record<string, unknown>> {
  const row = await appEnv.DB.prepare(
    `SELECT cursor_json FROM presence_poll_cursor WHERE source_target_id = ?`,
  )
    .bind(targetId)
    .first<{ cursor_json: string }>();
  return row ? (JSON.parse(row.cursor_json) as Record<string, unknown>) : {};
}

/**
 * The shared-Google-project usage SUM, exactly as readYouTubeUsage computes
 * it: every OPEN (now-relative) youtube target's youtubeUsage.count. A
 * window whose windowStart is older than 24h is closed — its calls no longer
 * count. (The 24h arithmetic mirrors the connector's; the windowStart
 * itself is now-relative BY DESIGN — the documented allocation has no
 * documented reset-time guarantee, so the connector overcounts a rolling
 * window. The fixture's publishedAt instants stay fixed-date.)
 */
async function sumOpenYoutubeUsage(): Promise<number> {
  const rows = await appEnv.DB.prepare(
    `SELECT pc.cursor_json AS cursor_json
     FROM source_target st
     JOIN presence_poll_cursor pc ON pc.source_target_id = st.id
     WHERE st.connector_id = 'youtube' AND st.deleted_at IS NULL`,
  ).all<{ cursor_json: string }>();
  const now = Date.now();
  let used = 0;
  for (const row of rows.results ?? []) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(row.cursor_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const usage = parsed.youtubeUsage as { windowStart?: unknown; count?: unknown } | undefined;
    if (!usage || typeof usage.windowStart !== "string" || typeof usage.count !== "number") continue;
    const started = new Date(usage.windowStart).getTime();
    if (Number.isNaN(started) || now - started >= 24 * 60 * 60 * 1000) continue;
    used += usage.count;
  }
  return used;
}

/**
 * Closes every OTHER youtube target's usage window (windowStart → the fixture
 * epoch, ISO_T0 — months past the 24h mark). Earlier its in this file bank
 * counted calls against the SHARED one-Google-project principal, and the
 * documented 100/day cap reads that SUM — so a later its proves the
 * closed-window (or request-shape) contract in isolation by rotating those
 * priors first, the same rotation the connector's own readUsageWindow honors
 * (now - windowStart ≥ 24h ⇒ the calls no longer count).
 */
async function closeOtherYoutubeWindows(exceptTargetId: string): Promise<void> {
  const rows = await appEnv.DB.prepare(
    `SELECT pc.source_target_id AS target_id, pc.cursor_json AS cursor_json
     FROM source_target st
     JOIN presence_poll_cursor pc ON pc.source_target_id = st.id
     WHERE st.connector_id = 'youtube' AND st.deleted_at IS NULL AND st.id != ?`,
  )
    .bind(exceptTargetId)
    .all<{ target_id: string; cursor_json: string }>();
  for (const row of rows.results ?? []) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(row.cursor_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const usage = parsed.youtubeUsage as { count?: unknown } | undefined;
    if (!usage || typeof usage.count !== "number") continue;
    parsed.youtubeUsage = { windowStart: ISO_T0, count: usage.count };
    await appEnv.DB.prepare(`UPDATE presence_poll_cursor SET cursor_json = ? WHERE source_target_id = ?`)
      .bind(JSON.stringify(parsed), row.target_id)
      .run();
  }
}

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
      makeCtx(fetchImpl, "ga"),
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
      makeCtx(youtubeFetcher(() => ({ body: "{}" })), undefined),
    );
    expect(result.ok).toBe(false);
    expect(result.coverageLabel).toBe("UNAVAILABLE");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("rejects a missing match phrase", async () => {
    const result = await youtubeConnector.validateTarget(
      { trackingMode: "competitor" },
      makeCtx(youtubeFetcher(() => ({ body: "" })), "ga"),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_match_phrase");
  });
});

describe("youtube mention connector — poll", () => {
  it("fixture returns >=1 mention: watch-URL items with publishedAt/author/contentHash, ONE network call", async () => {
    const target = await seedYoutubeTarget();
    let requestedUrl: URL | null = null;
    const fetchImpl = youtubeFetcher((url) => {
      requestedUrl = url;
      return { body: SEARCH_PAGE };
    });

    // Through the REAL orchestrator — the production poll path.
    const poll = await pollPresenceTarget(makeEnv("ga"), target, { trackingMode: "competitor" }, { fetchImpl });
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
    expect(first?.publishedAt).toBe(VIDEO_B_PUBLISHED_AT); // fixed-date, carried verbatim
    expect(first?.author).toBe("FixtureFactory"); // the channel DISPLAY name, plainly
    expect(second?.author).toBe("FixtureFactory");
    expect(first?.contentHash).not.toBe("");
    expect(second?.contentHash).not.toBe("");

    // Frugality: ONE serialized search.list request, no parallel fan-out.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
    expect(poll.cursor?.youtubeUsage).toEqual({ windowStart: expect.any(String), count: 1 });
  });

  it("capture-validity: a result without id.videoId is skipped, never fabricated, and the watermark still advances past it", async () => {
    const target = await seedYoutubeTarget();
    const fetchImpl = youtubeFetcher(() => ({ body: SEARCH_PAGE_WITH_UNUSABLE }));

    const poll = await youtubeConnector.poll(makeCtx(fetchImpl, "ga"), target);
    expect(poll.ok).toBe(true);
    // Exactly the two? no — exactly ONE usable result survives.
    expect(poll.items).toHaveLength(1);
    expect(poll.items[0]?.canonicalUrl).toBe(`https://www.youtube.com/watch?v=${VIDEO_B_ID}`);

    // The skipped result does not stall the window: the watermark is the
    // NEWEST publishedAt the page returned, the unusable result's included.
    expect(poll.cursor?.lastItemPublishedAt).toBe("2026-09-10T09:00:00Z");
    // And the skipped page still counted as a SENT call (empty results
    // count; so does a page whose results are all unusable).
    expect(poll.cursor?.youtubeUsage).toEqual({ windowStart: expect.any(String), count: 1 });
  });

  it("answers an honest empty page — and the call still counted", async () => {
    const target = await seedYoutubeTarget();
    const fetchImpl = youtubeFetcher(() => ({ body: EMPTY_PAGE }));

    const poll = await youtubeConnector.poll(makeCtx(fetchImpl, "ga"), target);
    expect(poll.ok).toBe(true);
    expect(poll.items).toEqual([]);
    // No documented Threads-style empty-results-are-free exemption: the SENT
    // call costs 1 of the documented 100/day, so the window counted it.
    expect(poll.costUnits).toBe(1);
    expect(poll.cursor?.youtubeUsage).toEqual({ windowStart: expect.any(String), count: 1 });
    // An empty page yields NO watermark: the next poll retries the full
    // window rather than silently skipping it.
    expect(poll.cursor?.lastItemPublishedAt).toBeUndefined();
  });

  it("maps an HTTP error to an honest failure — and the failed call still counted the window", async () => {
    const target = await seedYoutubeTarget();
    const fetchImpl = youtubeFetcher(() => ({ body: "upstream 503", status: 500 }));

    const poll = await youtubeConnector.poll(makeCtx(fetchImpl, "ga"), target);
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("youtube_api_error");
    expect(poll.items).toEqual([]);
    // The request was attempted; whether Google counted it is undocumented,
    // so the connector counts it — erring toward fewer real calls.
    expect(poll.cursor?.youtubeUsage).toEqual({ windowStart: expect.any(String), count: 1 });
    // No watermark from a failed poll: the service keeps the prior window
    // and the next poll retries it — a failure never silently skips mentions.
    expect(poll.cursor?.lastItemPublishedAt).toBeUndefined();
  });

  it("refuses the poll without fetching while the rollout is off", async () => {
    const target = await seedYoutubeTarget();
    const fetchImpl = youtubeFetcher(() => ({ body: SEARCH_PAGE }));

    const poll = await youtubeConnector.poll(makeCtx(fetchImpl, undefined), target);
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("connector_disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a target with no match phrase without calling the API", async () => {
    const target = await seedYoutubeTarget();
    const bare: SourceTargetRecord = { ...target, metadata: {}, targetHandle: null, targetKey: "" };
    const fetchImpl = youtubeFetcher(() => ({ body: SEARCH_PAGE }));

    const poll = await youtubeConnector.poll(makeCtx(fetchImpl, "ga"), bare);
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("missing_match_phrase");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("youtube mention connector — watermark round-trip through presence_poll_cursor", () => {
  it("persists the watermark the way the poll orchestrator does; the next poll sends it VERBATIM as the inclusive publishedAfter", async () => {
    const target = await seedYoutubeTarget();

    const first = await youtubeConnector.poll(makeCtx(youtubeFetcher(() => ({ body: SEARCH_PAGE })), "ga"), target);
    expect(first.ok).toBe(true);
    // Persist the connector's returned cursor the way pollPresenceSourceTarget
    // does (cursor lands in presence_poll_cursor.cursor_json).
    await upsertPollCursor(makeEnv("ga"), target.id, {
      cursor: first.cursor,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });

    const stored = await readCursorJson(target.id);
    expect(stored.lastItemPublishedAt).toBe(VIDEO_B_PUBLISHED_AT);

    // The service passes the stored record back as cursor.record — the next
    // poll must resume from exactly that watermark, carried VERBATIM (no
    // clock math): the documented publishedAfter is INCLUSIVE, so the
    // boundary video may legitimately be read once more.
    let sawPublishedAfter: string | null = null;
    const second = await youtubeConnector.poll(
      makeCtx(
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
    const first = await youtubeConnector.poll(makeCtx(youtubeFetcher(() => ({ body: SEARCH_PAGE })), "ga"), target);
    expect(first.ok).toBe(true);
    const firstUpsert = await upsertPresenceItems(makeEnv("ga"), { sourceTarget: target, items: first.items });
    expect(firstUpsert.inserted).toBe(2);

    // Persist the cursor the way the service does, then poll again through
    // the INCLUSIVE publishedAfter window — the documented semantics return
    // the boundary video ONE MORE TIME, alongside a genuinely new video.
    await upsertPollCursor(makeEnv("ga"), target.id, {
      cursor: first.cursor,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });
    const stored = await readCursorJson(target.id);
    const second = await youtubeConnector.poll(
      makeCtx(youtubeFetcher(() => ({ body: SEARCH_PAGE_BOUNDARY_REREAD })), "ga"),
      target,
      { record: stored },
    );
    expect(second.ok).toBe(true);
    expect(second.items).toHaveLength(2); // VIDEO_C + the re-read VIDEO_B

    const secondUpsert = await upsertPresenceItems(makeEnv("ga"), { sourceTarget: target, items: second.items });
    expect(secondUpsert.inserted).toBe(1); // only VIDEO_C was genuinely new
    expect(secondUpsert.updated).toBe(0); // the re-read VIDEO_B was absorbed, not revised

    // Dedup by canonical URL, exactly as the issue words it: three UNIQUE
    // watch URLs, the re-read boundary video present EXACTLY once.
    const rows = await appEnv.DB.prepare(
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

describe("youtube mention connector — rate budget (the documented 100 search.list calls/day, shared by every tracked brand)", () => {
  it("opens the window on one poll, enforces the cap from the SUM across targets, and counts the refused nothing", async () => {
    // Two targets, one per user — the connector treats them as ONE principal
    // (one Google project = one key), because the documented 100 calls/day
    // allocation is per Google project, not per workspace.
    const targetA = await seedYoutubeTarget();
    const otherUserId = await seedUser();
    const targetB = await seedYoutubeTarget({ userId: otherUserId, phrase: "Fixture Dynamics" });

    // Everything this FILE persisted so far counts against the shared key:
    // the watermark test and the dedup test each banked one counted call.
    const priorUsage = await sumOpenYoutubeUsage();
    expect(priorUsage).toBeGreaterThanOrEqual(0);

    // Bank target A's window so the SUM sits at exactly the cap-1: this
    // poll is the last one the documented allocation can afford.
    const banked = YOUTUBE_DAILY_SEARCH_CAP - 1 - priorUsage;
    await upsertPollCursor(makeEnv("ga"), targetA.id, {
      cursor: { youtubeUsage: { windowStart: new Date().toISOString(), count: banked } },
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });

    // (windowStart above is now-relative BY DESIGN — see sumOpenYoutubeUsage.)
    let calls = 0;
    const fetchImpl = youtubeFetcher(() => {
      calls += 1;
      return { body: SEARCH_PAGE };
    });

    // Poll 1: the SUM (banked + prior) = 99 < 100, so the call goes out —
    // and the READ enforces the shared total, not this target's own count
    // (this target's own banked window alone is below the cap whenever
    // priorUsage > 0; the OTHER targets' calls are what pushes it to 99).
    const first = await youtubeConnector.poll(makeCtx(fetchImpl, "ga"), targetA);
    expect(first.ok).toBe(true);
    expect(calls).toBe(1);
    expect(first.cursor?.youtubeUsage?.count).toBe(banked + 1);

    // Persist exactly the way the service does, then poll again: the SUM now
    // reads 100 — the connector must refuse WITHOUT a network call.
    await upsertPollCursor(makeEnv("ga"), targetA.id, {
      cursor: first.cursor,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });
    const second = await youtubeConnector.poll(makeCtx(fetchImpl, "ga"), targetA);
    expect(second.ok).toBe(false);
    expect(second.errorCode).toBe("youtube_daily_search_cap");
    expect(second.errorMessage).toContain("100");
    expect(calls).toBe(1); // the refused poll sent NOTHING

    // The shared principal: even a DIFFERENT workspace's target (different
    // user, its own row, its own prior usage of zero) is capped — one
    // Google project = one principal, exactly as documented.
    const third = await youtubeConnector.poll(makeCtx(fetchImpl, "ga"), targetB);
    expect(third.ok).toBe(false);
    expect(third.errorCode).toBe("youtube_daily_search_cap");
    expect(calls).toBe(1); // nothing further was spent
  });

  it("a closed window's calls no longer count — the rolling 24h window rotates", async () => {
    const target = await seedYoutubeTarget();
    // The priors: earlier its' counted calls ride the SAME one-principal
    // window — rotate them closed first, so this its proves exactly the
    // closed-window math (its own banked-100 window vs a fresh poll).
    await closeOtherYoutubeWindows(target.id);
    // Seed a window whose windowStart is the fixture epoch (2026-01-01 —
    // months before this run): readUsageWindow finds it closed, its 100
    // counted calls no longer count, so the poll proceeds and the returned
    // window opens FRESH.
    await upsertPollCursor(makeEnv("ga"), target.id, {
      cursor: { lastItemPublishedAt: VIDEO_B_PUBLISHED_AT, youtubeUsage: { windowStart: ISO_T0, count: YOUTUBE_DAILY_SEARCH_CAP } },
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });

    let calls = 0;
    let sawPublishedAfter: string | null = null;
    const fetchImpl = youtubeFetcher((url) => {
      calls += 1;
      sawPublishedAfter = url.searchParams.get("publishedAfter");
      return { body: EMPTY_PAGE };
    });

    const poll = await youtubeConnector.poll(makeCtx(fetchImpl, "ga"), target, {
      record: await readCursorJson(target.id),
    });
    expect(poll.ok).toBe(true);
    expect(calls).toBe(1); // the closed window did not block the poll
    // The prior watermark survived the rotation, and the fresh window
    // started counting THIS poll from one.
    expect(sawPublishedAfter).toBe(VIDEO_B_PUBLISHED_AT);
    expect(poll.cursor?.youtubeUsage).toEqual({ windowStart: expect.any(String), count: 1 });
  });
});

describe("youtube mention connector — healthCheck", () => {
  it("reports pending while PRESENCE_YOUTUBE_ROLLOUT is unset", async () => {
    const target = await seedYoutubeTarget();
    const fetchImpl = youtubeFetcher(() => ({ body: "{}" }));
    const result = await youtubeConnector.healthCheck(makeCtx(fetchImpl, undefined));
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("probes the documented videos.list read — NOT one of the 100 dedicated search.list calls — and reports healthy", async () => {
    const target = await seedYoutubeTarget();
    const requested: URL[] = [];
    const fetchImpl = youtubeFetcher((url) => {
      requested.push(url);
      return { body: JSON.stringify({ kind: "youtube#videoListResponse", items: [{ id: "probe" }] }) };
    });
    const result = await youtubeConnector.healthCheck(makeCtx(fetchImpl, "ga"));
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
    const target = await seedYoutubeTarget();
    const fetchImpl = youtubeFetcher(() => ({ body: "unreachable", status: 500 }));
    const result = await youtubeConnector.healthCheck(makeCtx(fetchImpl, "ga"));
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
    await youtubeConnector.poll(makeCtx(fetchImpl, "ga"), target);
    const init = (fetchImpl as unknown as { mock: { calls: Array<Array<unknown>> } }).mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    expect((init?.headers as Record<string, string> | undefined)?.["User-Agent"] ?? (init?.headers as Record<string, string> | undefined)?.["user-agent"]).toBe(PRESENCE_USER_AGENT);
  });
});

describe("youtube mention connector — presence substrate (real migrations)", () => {
  it("writes connector_id = 'youtube' via the CHECK-widened migration and reads it back", async () => {
    // The real migrations — including
    // 0101_widen_source_target_connector_youtube — ran in the test setup, so
    // this write only succeeds when the CHECK genuinely accepts 'youtube'.
    const target = await seedYoutubeTarget();
    const row = await appEnv.DB.prepare(
      `SELECT connector_id, target_key, user_id FROM source_target WHERE id = ?`,
    )
      .bind(target.id)
      .first<{ connector_id: string; target_key: string; user_id: string }>();
    // READ path: the widened row reads back through the real engine.
    expect(row?.connector_id).toBe("youtube");
    expect(row?.target_key).toBe(PHRASE.toLowerCase());
    expect(row?.user_id).toBe(target.userId);
  });

  it("re-applies the 0101 migration cleanly and preserves child rows and every predecessor connector's rows", async () => {
    // Seed a full target + child rows, then re-run the real migration
    // statements in place — the rebuild must copy the youtube row through
    // and restore every cascaded child row set (0100/0099/0093 convention).
    const target = await seedYoutubeTarget();
    const itemId = uid("item");
    const revisionId = uid("rev");
    await appEnv.DB.batch([
      appEnv.DB.prepare(
        `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, canonical_url, url_hash, title, content_hash, revision, observed_at, created_at)
         VALUES (?, ?, ?, ?, 'youtube', ?, 'h', 't', 'ch', 1, 'o', 'c')`,
      ).bind(itemId, target.id, target.trackedEntityId, target.userId, `https://www.youtube.com/watch?v=${VIDEO_A_ID}`),
      appEnv.DB.prepare(
        `INSERT INTO presence_poll_cursor (source_target_id, cursor_json, updated_at) VALUES (?, '{}', 'u')`,
      ).bind(target.id),
      appEnv.DB.prepare(
        `INSERT INTO presence_item_revision (id, presence_item_id, revision, content_hash, title, observed_at, created_at)
         VALUES (?, ?, 1, 'ch', 't', 'o', 'c')`,
      ).bind(revisionId, itemId),
    ]);

    // Predecessor rows must survive the copy too: 0101's CHECK is a superset
    // of 0100's (which carried 0099's, 0098's, and 0093's unions), so these
    // writes — one per non-youtube value the 0100 CHECK accepted — are the
    // order-proof, and they must predate the re-application to prove the
    // COPY keeps them through the rebuild.
    const predecessorIds: Record<string, string> = {};
    for (const connectorId of ["website", "x", "reddit", "linkedin", "rss", "gdelt", "bluesky", "threads", "hn"]) {
      const predecessorTargetId = uid("target");
      predecessorIds[connectorId] = predecessorTargetId;
      await appEnv.DB.prepare(
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
    await appEnv.DB.batch(statements.map((sql) => appEnv.DB.prepare(sql)));

    const kept = await appEnv.DB.prepare(`SELECT connector_id FROM source_target WHERE id = ?`)
      .bind(target.id)
      .first<{ connector_id: string }>();
    expect(kept?.connector_id).toBe("youtube");

    // Every predecessor row (nine connectors) survives the copy — the CHECK
    // union is order-proof whichever of 0100/0101 applied when.
    for (const [connectorId, predecessorTargetId] of Object.entries(predecessorIds)) {
      const healed = await appEnv.DB.prepare(`SELECT connector_id, target_key FROM source_target WHERE id = ?`)
        .bind(predecessorTargetId)
        .first<{ connector_id: string; target_key: string }>();
      expect(healed?.connector_id).toBe(connectorId);
      expect(healed?.target_key).toBe(`${connectorId}-phrase`);
    }

    // Child rows restored: the cascade would have wiped them on the parent
    // DROP, so the backup tables must have carried them through.
    const itemCount = await appEnv.DB.prepare(`SELECT COUNT(*) AS n FROM presence_item WHERE id = ?`)
      .bind(itemId)
      .first<{ n: number }>();
    expect(itemCount?.n).toBe(1);
    const cursorCount = await appEnv.DB.prepare(`SELECT COUNT(*) AS n FROM presence_poll_cursor WHERE source_target_id = ?`)
      .bind(target.id)
      .first<{ n: number }>();
    expect(cursorCount?.n).toBe(1);
    const revisionCount = await appEnv.DB.prepare(`SELECT COUNT(*) AS n FROM presence_item_revision WHERE id = ?`)
      .bind(revisionId)
      .first<{ n: number }>();
    expect(revisionCount?.n).toBe(1);
  });
});
