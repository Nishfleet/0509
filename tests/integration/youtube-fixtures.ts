import { vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext, SourceTargetRecord } from "~/lib/presence-types";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Shared fixtures for the YouTube mention connector suites
 * (Nishfleet/0509#3203): the tracked-phrase constants, the captured
 * search.list response pages, the hermetic `youtubeFetcher` for
 * www.googleapis.com, the env/ctx builders, and the source_target seeding +
 * presence_poll_cursor helpers every youtube suite needs.
 *
 * The publishedAt instants are fixed-date BY DESIGN: the connector carries
 * `snippet.publishedAt` VERBATIM (the no-clock-math contract — it becomes the
 * inclusive `publishedAfter` watermark and the stored mention instant), so
 * these strings are compared as VALUES, never aged against the wall clock.
 * Only the usage-window `windowStart` instants are now-relative — the
 * documented allocation resets "at midnight Pacific Time (PT)"
 * (developers.google.com/youtube/v3/determine_quota_cost), and the
 * connector deliberately overcounts that boundary with a rolling window.
 */

export const PHRASE = "Acme Robotics";

export const VIDEO_A_ID = "aB3dEf7hI9k";
// fixed-date: captured snippet.publishedAt value — carried verbatim, compared as a string, never aged
export const VIDEO_A_PUBLISHED_AT = "2026-09-10T05:42:03Z";
export const VIDEO_A_TITLE = "Acme Robotics launches its warehouse robot";

export const VIDEO_B_ID = "mN2pQr5sT8v";
// fixed-date: the boundary instant the inclusive publishedAfter re-read exercises
export const VIDEO_B_PUBLISHED_AT = "2026-09-10T07:15:00Z";
export const VIDEO_B_TITLE = "Inside Acme Robotics' new assembly plant";

// The boundary re-read: because documented publishedAfter semantics are
// INCLUSIVE ("at or after"), the next poll legitimately returns the boundary
// video again — the mention table's (source_target_id, url_hash) uniqueness
// must absorb it.
export const VIDEO_C_ID = "zY1xW2v3U4t";
// fixed-date: one genuinely-new instant after the boundary
export const VIDEO_C_PUBLISHED_AT = "2026-09-10T09:30:00Z";
export const VIDEO_C_TITLE = "Acme Robotics ships its first autonomy stack";

export const SEARCH_PAGE = JSON.stringify({
  kind: "youtube#searchListResponse",
  items: [
    {
      // order=date: newest first.
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

export const SEARCH_PAGE_WITH_UNUSABLE = JSON.stringify({
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
        // fixed-date: newest of the page — the watermark must advance past a skipped result
        publishedAt: "2026-09-10T09:00:00Z",
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
export const SEARCH_PAGE_BOUNDARY_REREAD = JSON.stringify({
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

export const EMPTY_PAGE = JSON.stringify({ kind: "youtube#searchListResponse", items: [] });

// Data API v3 snippet fields are HTML-escaped: a search for a phrase with
// an ampersand comes back as `&amp;`, quotes as `&quot;`/`&#39;`. The
// connector decodes before trim/store/hash (rss.server.ts's decodeXml
// precedent) so the stored mention reads like the page, not the wire.
export const SEARCH_PAGE_ESCAPED = JSON.stringify({
  kind: "youtube#searchListResponse",
  items: [
    {
      id: { kind: "youtube#video", videoId: VIDEO_A_ID },
      snippet: {
        publishedAt: VIDEO_A_PUBLISHED_AT,
        channelId: "UCfixture0002",
        title: "Acme Robotics &amp; the &quot;warehouse&quot; bet",
        description: "Tom &amp; Dana walk the floor &#8212; Acme Robotics inside.",
        channelTitle: "Fixture &amp; Co",
      },
    },
  ],
});

export function makeYoutubeEnv(
  rollout: string | undefined,
  apiKey: string | undefined = "fixture-youtube-key-1",
): AppEnv {
  return {
    ...appEnv,
    PRESENCE_YOUTUBE_ROLLOUT: rollout,
    YOUTUBE_API_KEY: apiKey,
  } as AppEnv;
}

export function makeYoutubeCtx(
  fetchImpl: typeof fetch,
  rollout: string | undefined,
  trackingMode: "self" | "competitor" = "competitor",
): PresenceConnectorContext {
  return {
    env: makeYoutubeEnv(rollout),
    userId: "user-yt-1",
    trackingMode,
    connection: null,
    fetchImpl,
  };
}

/** Fixture fetcher for the www.googleapis.com Data API v3 shape. */
export function youtubeFetcher(
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

export async function seedYoutubeTarget(
  options: { userId?: string; phrase?: string } = {},
): Promise<SourceTargetRecord> {
  const userId = options.userId ?? (await seedUser());
  const entityId = uid("entity");
  const targetId = uid("target");
  const phrase = options.phrase ?? PHRASE;
  // The tracked_entity parent must precede the source_target child: the real
  // D1 FK (source_target.tracked_entity_id -> tracked_entity.id, 0055) rejects
  // the orphan — the same seeding order the x-mention suite (issue #3198) uses.
  await db().prepare(
    `INSERT INTO tracked_entity (
       id, user_id, tracking_mode, label, canonical_url, notes,
       is_active, created_at, updated_at
     ) VALUES (?, ?, 'competitor', ?, NULL, NULL, 1, ?, ?)`,
  )
    .bind(entityId, userId, phrase, ISO_T0, ISO_T0)
    .run();
  // WRITE path against the real, CHECK-widened source_target table: a
  // connector_id = 'youtube' row only inserts when 0103's CHECK accepts it.
  await db().prepare(
    `INSERT INTO source_target (
       id, tracked_entity_id, user_id, connector_id, target_key, target_url,
       target_handle, metadata_json, coverage_label, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, 'youtube', ?, NULL, ?, ?, 'OFFICIAL_PUBLIC_API', 1, ?, ?)`,
  )
    .bind(
      targetId,
      entityId,
      userId,
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
    connectorId: "youtube",
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

export async function readYoutubeCursorJson(targetId: string): Promise<Record<string, unknown>> {
  const row = await db().prepare(
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
 * itself is now-relative BY DESIGN — the documented midnight-Pacific reset
 * is deliberately overcounted by the connector's rolling window. The
 * fixture's publishedAt instants stay fixed-date.)
 */
export async function sumOpenYoutubeUsage(): Promise<number> {
  const rows = await db().prepare(
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
export async function closeOtherYoutubeWindows(exceptTargetId: string): Promise<void> {
  const rows = await db().prepare(
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
    await db().prepare(`UPDATE presence_poll_cursor SET cursor_json = ? WHERE source_target_id = ?`)
      .bind(JSON.stringify(parsed), row.target_id)
      .run();
  }
}
