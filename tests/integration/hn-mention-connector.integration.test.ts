import { describe, expect, it, vi } from "vitest";

import {
  buildSearchByDateUrl,
  HN_MAX_HITS_PER_PAGE,
  hnConnector,
} from "~/lib/presence-connectors/hn.server";
import {
  getPresenceConnector,
  pollPresenceTarget,
} from "~/lib/presence-connector-registry.server";
import {
  listPresenceItems,
  listSourceTargetsForEntity,
  reconcilePresenceItemsAfterPoll,
  upsertPollCursor,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import { presenceUrlHash } from "~/lib/presence-hash";
import {
  evaluatePresenceSourceCoverage,
  presenceSourceCoverageForDocs,
} from "~/lib/presence-source-coverage.server";
import { PRESENCE_USER_AGENT } from "~/lib/presence-robots.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  PresenceConnectorContext,
  SourceTargetRecord,
} from "~/lib/presence-types";

import migrationSql from "../../migrations/0100_widen_source_target_connector_hn.sql?raw";

import { appEnv, db, ISO_T0, uid } from "./fixtures";

/**
 * Hacker News mention connector (Nishfleet/0509#3253) — the free, no-key,
 * no-auth fast-follow source in the mentions epic (#3171).
 *
 * Runs on real workerd against the repo's real migrations, including the
 * CHECK-widening migration for 'hn' — the write path (a connector_id = 'hn'
 * row in source_target) and the read path are both asserted against the real
 * D1 engine, and the migration file itself is re-applied in place to prove
 * child-row preservation.
 *
 * Connector methods are network-shape contracts: a mock `fetchImpl` serves
 * fixture Algolia responses for `hn.algolia.com` — the only real network
 * touched is the public-IP check inside `presenceSafeFetch`
 * (resolvePublicHttpUrl DNS), matching the gdelt/threads suites.
 *
 * Courtesy budget: the commonly cited ~10,000 requests/hour/IP for the HN
 * Search API is a community-observed courtesy figure, not an SLA. The suite
 * pins the connector's frugality contract: ONE serialized request per poll,
 * page 0 only (never deep paging past Algolia's ~1,000-result ceiling), and
 * the next poll resumes through time-window slicing
 * (numericFilters=created_at_i>watermark) — the documented pattern.
 */

const PHRASE = "Acme Robotics";
// fixed-date: 2026-09-10T05:42:03Z as epoch seconds — fixture-internal, never a wall-clock read.
const STORY_CREATED_AT_I = 1789018923;
// fixed-date: 2026-09-10T06:00:00Z as epoch seconds — the comment ran later, so this is the watermark.
const COMMENT_CREATED_AT_I = 1789020000;

const STORY_OBJECT_ID = "42632691";
const COMMENT_OBJECT_ID = "42632700";
const STORY_ITEM_URL = `https://news.ycombinator.com/item?id=${STORY_OBJECT_ID}`;
const COMMENT_ITEM_URL = `https://news.ycombinator.com/item?id=${COMMENT_OBJECT_ID}`;

const SEARCH_PAGE = JSON.stringify({
  hits: [
    {
      // fixed-date: fixture mirrors a captured Algolia search_by_date story hit; the connector only parses the instant, it is never compared against a live clock
      objectID: STORY_OBJECT_ID,
      created_at: "2026-09-10T05:42:03Z", // fixed-date: the captured fixture instant, parsed only, never compared to the wall clock
      created_at_i: STORY_CREATED_AT_I,
      title: "Acme Robotics ships its first assembly plant",
      story_text: null,
      comment_text: null,
      story_id: null,
      url: "https://acmerobotics.example/press-release",
      author: "pg",
      points: 42,
      num_comments: 7,
    },
    {
      // fixed-date: fixture mirrors a captured Algolia search_by_date comment hit — a comment hit ranks 0/0 and references its story
      objectID: COMMENT_OBJECT_ID,
      created_at: "2026-09-10T06:00:00Z", // fixed-date: the captured fixture instant, parsed only, never compared to the wall clock
      created_at_i: COMMENT_CREATED_AT_I,
      title: null,
      story_text: null,
      comment_text: "We use Acme Robotics arms on our line — the precision is unreal.",
      story_title: "Acme Robotics ships its first assembly plant",
      story_id: 42632691,
      url: null,
      author: "pg",
      points: null,
      num_comments: 0,
    },
  ],
  nbHits: 2,
  page: 0,
  nbPages: 1,
  hitsPerPage: 50,
  exhaustiveNbHits: true,
});

const EMPTY_PAGE = JSON.stringify({ hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 50 });

// 25 pages = 1,250 results, well past Algolia's ~1,000-result reachable
// window: the connector must answer from page 0 alone, never walk the pages.
const MANY_PAGES_PAGE = JSON.stringify({
  hits: [
    {
      // fixed-date: same captured-shape story hit, served under an nbPages=25 response — only the pagination envelope differs
      objectID: STORY_OBJECT_ID,
      created_at: "2026-09-10T05:42:03Z", // fixed-date: the captured fixture instant, parsed only, never compared to the wall clock
      created_at_i: STORY_CREATED_AT_I,
      title: "Acme Robotics ships its first assembly plant",
      story_text: null,
      comment_text: null,
      story_id: null,
      url: "https://acmerobotics.example/press-release",
      author: "pg",
      points: 42,
      num_comments: 7,
    },
  ],
  nbHits: 1250,
  page: 0,
  nbPages: 25,
  hitsPerPage: 50,
});

function makeEnv(rollout: string | undefined): AppEnv {
  return {
    ...appEnv,
    PRESENCE_HN_ROLLOUT: rollout,
  } as AppEnv;
}

function makeCtx(
  fetchImpl: typeof fetch,
  rollout: string | undefined,
  trackingMode: "self" | "competitor" = "competitor",
): PresenceConnectorContext {
  return {
    env: makeEnv(rollout),
    userId: "user-hn-1",
    trackingMode,
    connection: null,
    fetchImpl,
  };
}

/** Fixture fetcher for the Algolia HN Search API shape. */
function algoliaFetcher(
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
  await db()
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, `Fixture ${id}`, `${id}@example.test`, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedHnTarget(
  options: { userId?: string; phrase?: string; connectorId?: string } = {},
) {
  const userId = options.userId ?? (await seedUser());
  const entityId = uid("entity");
  const targetId = uid("target");
  const phrase = options.phrase ?? PHRASE;
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', ?, NULL, NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, "Acme self", ISO_T0, ISO_T0)
    .run();
  // WRITE path against the real, CHECK-widened source_target table.
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, target_url,
         target_handle, metadata_json, coverage_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'OFFICIAL_PUBLIC_API', 1, ?, ?)`,
    )
    .bind(
      targetId,
      entityId,
      userId,
      options.connectorId ?? "hn",
      phrase.toLowerCase(),
      phrase,
      JSON.stringify({ matchPhrase: phrase }),
      ISO_T0,
      ISO_T0,
    )
    .run();
  return { userId, entityId, targetId, phrase };
}

async function readCursorJson(targetId: string): Promise<Record<string, unknown>> {
  const row = await db()
    .prepare(`SELECT cursor_json FROM presence_poll_cursor WHERE source_target_id = ?`)
    .bind(targetId)
    .first<{ cursor_json: string }>();
  return row ? (JSON.parse(row.cursor_json) as Record<string, unknown>) : {};
}

describe("hn mention connector — registration and docs coverage", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("hn");
    expect(connector).toBe(hnConnector);
    expect(connector.id).toBe("hn");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated", () => {
    const docs = presenceSourceCoverageForDocs();
    const hn = docs.find((entry) => entry.sourceId === "hn");
    expect(hn).toBeDefined();
    expect(hn?.productionStatus).toBe("gated");
  });
});

describe("hn mention connector — validateTarget", () => {
  it("accepts a match phrase and emits target shape + metadata", async () => {
    const fetchImpl = algoliaFetcher(() => new Response("unreachable", { status: 500 }));
    const result = await hnConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: PHRASE },
      makeCtx(fetchImpl, "internal"),
    );
    expect(result.ok).toBe(true);
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(result.targetKey).toBe(PHRASE.toLowerCase());
    expect(result.targetHandle).toBe(PHRASE);
    expect(result.metadata?.matchPhrase).toBe(PHRASE);
    // validateTarget is offline: no network hop.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is gated while PRESENCE_HN_ROLLOUT is unset", async () => {
    const result = await hnConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: PHRASE },
      makeCtx(algoliaFetcher(() => ({ body: "{}" })), undefined),
    );
    expect(result.ok).toBe(false);
    expect(result.coverageLabel).toBe("UNAVAILABLE");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("rejects a missing match phrase", async () => {
    const result = await hnConnector.validateTarget(
      { trackingMode: "competitor" },
      makeCtx(algoliaFetcher(() => ({ body: "" })), "internal"),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_match_phrase");
  });
});

describe("hn mention connector — poll", () => {
  it("returns story + comment items whose canonicalUrl is the public news.ycombinator.com item URL, with contentHash/publishedAt/author and ranking in raw", async () => {
    const { targetId } = await seedHnTarget();
    const fetchImpl = algoliaFetcher((url) => {
      expect(url.hostname).toBe("hn.algolia.com");
      expect(url.pathname).toBe("/api/v1/search_by_date");
      expect(url.searchParams.get("query")).toBe(PHRASE);
      expect(url.searchParams.get("tags")).toBe("(story,comment)");
      expect(url.searchParams.get("hitsPerPage")).toBe(String(HN_MAX_HITS_PER_PAGE));
      // First poll: no prior watermark, so no time-window bound yet.
      expect(url.searchParams.get("numericFilters")).toBe(null);
      // No deep paging: the connector reads page 0 and only page 0.
      expect(url.searchParams.has("page")).toBe(false);
      return { body: SEARCH_PAGE };
    });
    const result = await hnConnector.poll(makeCtx(fetchImpl, "internal"), {
      id: targetId,
      userId: "user-hn-1",
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    // One courtesy request per poll — one serialized Algolia hit, no
    // parallel page fan-out.
    expect(result.costUnits).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const story = result.items[0];
    expect(story?.canonicalUrl).toBe(STORY_ITEM_URL);
    expect(story?.canonicalUrl).not.toContain("hn.algolia.com");
    expect(story?.externalId).toBe(STORY_OBJECT_ID);
    expect(story?.contentHash).toBeTruthy();
    // fixed-date: mirrors the fixture's Z form through the connector's ISO normalization — no live clock read
    expect(story?.publishedAt).toBe("2026-09-10T05:42:03.000Z");
    expect(story?.author).toBe("pg");
    expect(story?.title).toContain("Acme Robotics");
    expect(story?.bodyExcerpt).toBe(null);
    const storyRaw = story?.raw as Record<string, unknown>;
    expect(storyRaw?.kind).toBe("hn_item");
    expect(storyRaw?.itemType).toBe("story");
    // Ranking inputs: points/comment-count as the public API reported them.
    expect(storyRaw?.points).toBe(42);
    expect(storyRaw?.commentCount).toBe(7);
    expect(storyRaw?.externalUrl).toBe("https://acmerobotics.example/press-release");

    const comment = result.items[1];
    // The canonicalUrl of a COMMENT is also the public HN item page — the
    // discussion the comment lives in, not the story's external URL.
    expect(comment?.canonicalUrl).toBe(COMMENT_ITEM_URL);
    expect(comment?.externalId).toBe(COMMENT_OBJECT_ID);
    expect(comment?.contentHash).toBeTruthy();
    // fixed-date: mirrors the fixture's Z form through the connector's ISO normalization — no live clock read
    expect(comment?.publishedAt).toBe("2026-09-10T06:00:00.000Z");
    expect(comment?.author).toBe("pg");
    expect(comment?.bodyExcerpt).toContain("Acme Robotics");
    const commentRaw = comment?.raw as Record<string, unknown>;
    expect(commentRaw?.itemType).toBe("comment");
    expect(commentRaw?.points).toBe(0);
    expect(commentRaw?.commentCount).toBe(0);
    expect(commentRaw?.storyId).toBe(42632691);

    // The watermark folds forward: the newest created_at_i this page returned.
    expect((result.cursor as Record<string, unknown>).lastItemCreatedAtI).toBe(COMMENT_CREATED_AT_I);

    // Search results are never a complete snapshot — reconcile must not
    // tombstone on absence from a ranked result page.
    expect(result.cursor?.completeSnapshot).toBeUndefined();

    // Every request rides the presenceSafeFetch path.
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const init = (call[1] ?? {}) as RequestInit;
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(PRESENCE_USER_AGENT);
  });

  it("keeps the fixture's created_at_i consistent with its created_at (fixed-date, no wall clock)", () => {
    expect(Math.floor(Date.parse("2026-09-10T05:42:03Z") / 1000)).toBe(STORY_CREATED_AT_I); // fixed-date: the 2026-09-10 fixture instant, parsed against Date.parse, never a wall-clock read
    expect(Math.floor(Date.parse("2026-09-10T06:00:00Z") / 1000)).toBe(COMMENT_CREATED_AT_I); // fixed-date: the 2026-09-10 fixture instant, parsed against Date.parse, never a wall-clock read
  });

  it("returns ok: true, items: [] for an empty result set (honest empty)", async () => {
    const { targetId } = await seedHnTarget();
    const fetchImpl = algoliaFetcher(() => ({ body: EMPTY_PAGE }));
    const result = await hnConnector.poll(makeCtx(fetchImpl, "internal"), {
      id: targetId,
      userId: "user-hn-1",
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    });
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
    // One courtesy request was still spent.
    expect(result.costUnits).toBe(1);
    // No watermark yet: the next poll reads the newest page unbounded.
    expect((result.cursor as Record<string, unknown>).lastItemCreatedAtI).toBe(0);
  });

  it("answers from page 0 alone even when Algolia reports 25 result pages — the ~1,000-result ceiling is never walked", async () => {
    const { targetId } = await seedHnTarget();
    const fetchImpl = algoliaFetcher((url) => {
      expect(url.searchParams.has("page")).toBe(false);
      return { body: MANY_PAGES_PAGE };
    });
    const result = await hnConnector.poll(makeCtx(fetchImpl, "internal"), {
      id: targetId,
      userId: "user-hn-1",
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    });
    expect(result.ok).toBe(true);
    // Exactly ONE serialized request — no sequential deep paging, no
    // parallel fan-out; the next poll resumes by time-window slicing.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((result.cursor as Record<string, unknown>).lastItemCreatedAtI).toBe(STORY_CREATED_AT_I);
  });

  it("resumes by time-window slicing: the next poll passes numericFilters=created_at_i>watermark", async () => {
    const { targetId } = await seedHnTarget();
    const prior = { record: { lastItemCreatedAtI: COMMENT_CREATED_AT_I } };
    const fetchImpl = algoliaFetcher((url) => {
      expect(url.searchParams.get("numericFilters")).toBe(`created_at_i>${COMMENT_CREATED_AT_I}`);
      // The watermark bound rides the documentedAlgolia numericFilters
      // parameter — the documented time-window slicing pattern that replaces
      // deep paging. Still page 0 only.
      expect(url.searchParams.has("page")).toBe(false);
      return { body: EMPTY_PAGE };
    });
    const result = await hnConnector.poll(
      makeCtx(fetchImpl, "internal"),
      {
        id: targetId,
        userId: "user-hn-1",
        targetKey: PHRASE.toLowerCase(),
        targetUrl: null,
        targetHandle: PHRASE,
        metadata: { matchPhrase: PHRASE },
      },
      prior,
    );
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
    // The watermark holds: nothing newer was returned.
    expect((result.cursor as Record<string, unknown>).lastItemCreatedAtI).toBe(COMMENT_CREATED_AT_I);
  });

  it("maps HTTP errors to honest degraded results, never fabricated items", async () => {
    const { targetId } = await seedHnTarget();
    const target = {
      id: targetId,
      userId: "user-hn-1",
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    };
    const err = await hnConnector.poll(
      makeCtx(algoliaFetcher(() => ({ body: "gateway timeout", status: 504 })), "internal"),
      target,
    );
    expect(err.ok).toBe(false);
    expect(err.items).toEqual([]);
    expect(err.errorCode).toBe("hn_api_error");

    const rateLimited = await hnConnector.poll(
      makeCtx(algoliaFetcher(() => ({ body: "{}", status: 429 })), "internal"),
      target,
    );
    expect(rateLimited.ok).toBe(false);
    expect(rateLimited.errorCode).toBe("rate_limited");

    // A failed poll returns no cursor, so the service keeps the prior
    // time-window — a failure never silently skips mentions.
    expect(err.cursor).toBeUndefined();
  });

  it("refuses the poll without fetching when the rollout is off (credentials are always true — no key, no auth)", async () => {
    const { targetId } = await seedHnTarget();
    const target = {
      id: targetId,
      userId: "user-hn-1",
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    };
    const fetchImpl = algoliaFetcher(() => ({ body: SEARCH_PAGE }));

    const gated = await hnConnector.poll(makeCtx(fetchImpl, undefined), target);
    expect(gated.ok).toBe(false);
    expect(gated.errorCode).toBe("connector_disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a target with no match phrase without calling the API", async () => {
    const { targetId } = await seedHnTarget({ phrase: "x" });
    const fetchImpl = algoliaFetcher(() => ({ body: SEARCH_PAGE }));
    const result = await hnConnector.poll(makeCtx(fetchImpl, "internal"), {
      id: targetId,
      userId: "user-hn-1",
      targetKey: "",
      targetUrl: null,
      targetHandle: null,
      metadata: {},
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_match_phrase");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("hn mention connector — watermark round-trip through presence_poll_cursor", () => {
  it("persists the watermark the way the poll orchestrator does and reads it back for the next window", async () => {
    const { targetId } = await seedHnTarget();
    const target = {
      id: targetId,
      userId: "user-hn-1",
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    };

    const first = await hnConnector.poll(
      makeCtx(algoliaFetcher(() => ({ body: SEARCH_PAGE })), "internal"),
      target,
    );
    expect(first.ok).toBe(true);
    // Persist the connector's returned cursor the way pollPresenceSourceTarget
    // does (cursor lands in presence_poll_cursor.cursor_json).
    await upsertPollCursor(makeEnv("internal"), targetId, {
      cursor: first.cursor,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });

    const stored = await readCursorJson(targetId);
    expect(stored.lastItemCreatedAtI).toBe(COMMENT_CREATED_AT_I);

    // The service passes the stored record back as cursor.record — the next
    // poll must resume from exactly that watermark.
    let sawNumericFilters: string | null = null;
    const second = await hnConnector.poll(
      makeCtx(
        algoliaFetcher((url) => {
          sawNumericFilters = url.searchParams.get("numericFilters");
          return { body: EMPTY_PAGE };
        }),
        "internal",
      ),
      target,
      { record: stored },
    );
    expect(second.ok).toBe(true);
    expect(sawNumericFilters).toBe(`created_at_i>${COMMENT_CREATED_AT_I}`);
  });
});

describe("hn mention connector — healthCheck", () => {
  it("reports pending while PRESENCE_HN_ROLLOUT is unset", async () => {
    const result = await hnConnector.healthCheck(makeCtx(algoliaFetcher(() => ({ body: "{}" })), undefined));
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("reports healthy when the rollout is on and the public endpoint answers a one-hit probe", async () => {
    const fetchImpl = algoliaFetcher((url) => {
      expect(url.hostname).toBe("hn.algolia.com");
      expect(url.pathname).toBe("/api/v1/search_by_date");
      expect(url.searchParams.get("hitsPerPage")).toBe("1");
      return { body: EMPTY_PAGE };
    });
    const result = await hnConnector.healthCheck(makeCtx(fetchImpl, "internal"));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
  });

  it("reports degraded when the public endpoint fails", async () => {
    const result = await hnConnector.healthCheck(
      makeCtx(algoliaFetcher(() => ({ body: "over budget", status: 503 })), "internal"),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("degraded");
    expect(result.errorCode).toBe("hn_unreachable");
  });
});

describe("hn mention connector — request shape", () => {
  it("builds the documented search_by_date URL", () => {
    const url = new URL(buildSearchByDateUrl("Acme Robotics"));
    expect(url.hostname).toBe("hn.algolia.com");
    expect(url.pathname).toBe("/api/v1/search_by_date");
    expect(url.searchParams.get("query")).toBe("Acme Robotics");
    expect(url.searchParams.get("tags")).toBe("(story,comment)");
    expect(url.searchParams.get("hitsPerPage")).toBe(String(HN_MAX_HITS_PER_PAGE));
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.has("numericFilters")).toBe(false);
  });

  it("carries the time-window watermark as the documented numericFilters parameter", () => {
    const url = new URL(buildSearchByDateUrl("Acme Robotics", STORY_CREATED_AT_I));
    expect(url.searchParams.get("numericFilters")).toBe(`created_at_i>${STORY_CREATED_AT_I}`);
    expect(url.searchParams.has("page")).toBe(false);
  });
});

describe("hn mention connector — presence substrate (real migrations)", () => {
  it("writes connector_id = 'hn' via the CHECK-widened migration and reads it back", async () => {
    // The real migrations — including
    // 0100_widen_source_target_connector_hn — ran in the test setup, so
    // this write only succeeds when the CHECK genuinely accepts 'hn'.
    const { targetId, userId } = await seedHnTarget();
    const row = await db()
      .prepare(`SELECT connector_id, target_key, user_id FROM source_target WHERE id = ?`)
      .bind(targetId)
      .first<{ connector_id: string; target_key: string; user_id: string }>();
    // READ path: the widened row reads back through the real engine.
    expect(row?.connector_id).toBe("hn");
    expect(row?.target_key).toBe(PHRASE.toLowerCase());
    expect(row?.user_id).toBe(userId);
  });

  it("re-applies the 0100 migration cleanly and preserves child rows and every predecessor connector's rows", async () => {
    // Seed a full target + child rows, then re-run the real migration
    // statements in place — the rebuild must copy the hn row through and
    // restore every cascaded child row set (0093 rebuild convention).
    const { userId, entityId, targetId } = await seedHnTarget();
    const itemId = uid("item");
    const revisionId = uid("rev");
    await db().batch([
      db().prepare(
        `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, canonical_url, url_hash, title, content_hash, revision, observed_at, created_at)
         VALUES (?, ?, ?, ?, 'hn', ?, 'h', 't', 'ch', 1, 'o', 'c')`,
      ).bind(itemId, targetId, entityId, userId, STORY_ITEM_URL),
      db().prepare(
        `INSERT INTO presence_poll_cursor (source_target_id, cursor_json, updated_at) VALUES (?, '{}', 'u')`,
      ).bind(targetId),
      db().prepare(
        `INSERT INTO presence_item_revision (id, presence_item_id, revision, content_hash, title, observed_at, created_at)
         VALUES (?, ?, 1, 'ch', 't', 'o', 'c')`,
      ).bind(revisionId, itemId),
    ]);

    // Predecessor rows must survive the copy too: 0100's CHECK is a superset
    // of 0099's (which itself healed 'bluesky' after the 0098 pair), so
    // these writes through the chain-final CHECK — one per non-hn value the
    // 0099 CHECK accepted — are the order-proof, and they must predate the
    // re-application to prove the COPY keeps them through the rebuild.
    const predecessorIds: Record<string, string> = {};
    for (const connectorId of ["website", "x", "reddit", "linkedin", "rss", "gdelt", "bluesky", "threads"]) {
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
    expect(kept?.connector_id).toBe("hn");

    // Every predecessor row (eight connectors) survives the copy — the
    // CHECK union is order-proof whichever of 0099/0100 applied when.
    for (const [connectorId, predecessorTargetId] of Object.entries(predecessorIds)) {
      const healed = await db()
        .prepare(`SELECT connector_id, target_key FROM source_target WHERE id = ?`)
        .bind(predecessorTargetId)
        .first<{ connector_id: string; target_key: string }>();
      expect(healed?.connector_id).toBe(connectorId);
      expect(healed?.target_key).toBe(`${connectorId}-phrase`);
    }

    // The hn row itself survives the rebuild alongside them. Local storage
    // isolates per test FILE, not per test (see fixtures), so earlier suites'
    // hn rows persist — scope the survival count to this target's id.
    const hnRows = await db()
      .prepare(`SELECT count(*) AS c FROM source_target WHERE connector_id = 'hn' AND id = ?`)
      .bind(targetId)
      .first<{ c: number }>();
    expect(hnRows?.c).toBe(1);

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

describe("hn mention source activation — capture, dedup by canonical URL, kill flag, rate budget (#3207)", () => {
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

  function mockCalls(fetchImpl: typeof fetch) {
    return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
  }

  it("captures a tracked brand's hn mentions end-to-end: registry poll -> presence_item, deduped by canonical URL", async () => {
    const seeded = await seedHnTarget();
    const env = makeEnv("internal");

    // The target rides the REAL data layer (a mapped SourceTargetRecord) —
    // the shape the poll orchestrator actually sees, not a hand-built stub.
    const rows = await listSourceTargetsForEntity(env, seeded.userId, seeded.entityId);
    const target = rows.find((row) => row.connectorId === "hn");
    expect(target).toBeDefined();
    const hnTarget = target as SourceTargetRecord;

    const fetchImpl = algoliaFetcher(() => ({ body: SEARCH_PAGE }));

    // FIRST capture: tracked brand -> the public search surface -> the
    // mention substrate. The rollout gate (PRESENCE_HN_ROLLOUT=internal) is
    // the only credential: hn needs no key and no secret. The fixture
    // answers with one story + one comment naming the brand.
    const poll = await pollPresenceTarget(env, hnTarget, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.items.length).toBeGreaterThanOrEqual(1); // acceptance: fixture returns >=1 mention

    // Rate budget THROUGH the orchestration: one poll = exactly ONE courtesy
    // request. No parallel fan-out, no retries, no second fetch.
    expect(mockCalls(fetchImpl)).toHaveLength(1);

    const upsert = await upsertPresenceItems(env, { sourceTarget: hnTarget, items: poll.items });
    expect(upsert.inserted).toBeGreaterThanOrEqual(1);
    expect(await countLivePresenceItems(hnTarget.id)).toBe(poll.items.length);

    // The stored dedup key IS the canonical-URL hash: url_hash =
    // presenceUrlHash(canonicalUrl), unique per (source_target_id, url_hash)
    // — the epic's "deduped by canonical URL", enforced by the substrate.
    const stored = await listPresenceItems(env, seeded.userId, {
      trackedEntityId: seeded.entityId,
      connectorId: "hn",
    });
    const mine = stored.filter((item) => item.sourceTargetId === hnTarget.id);
    expect(mine).toHaveLength(poll.items.length);
    for (const item of mine) {
      expect(item.urlHash).toBe(await presenceUrlHash(item.canonicalUrl));
      expect(item.canonicalUrl).toMatch(/^https:\/\/news\.ycombinator\.com\/item\?id=/);
      expect(item.contentHash).toBeTruthy();
    }

    // A SECOND identical poll + upsert must not multiply rows: the substrate
    // dedups on (source_target_id, url_hash) — one canonical mention, even
    // when the page answers with the same hits again.
    const pollAgain = await pollPresenceTarget(env, hnTarget, { trackingMode: "self" }, { fetchImpl });
    expect(pollAgain.ok).toBe(true);
    const upsertAgain = await upsertPresenceItems(env, { sourceTarget: hnTarget, items: pollAgain.items });
    expect(upsertAgain.inserted).toBe(0);
    expect(await countLivePresenceItems(hnTarget.id)).toBe(poll.items.length);

    // And the courtesy budget stays serialized: exactly one request per
    // poll — two polls, two requests, never more.
    expect(mockCalls(fetchImpl)).toHaveLength(2);

    // search_by_date is a bounded, date-ordered WINDOW, not a complete
    // snapshot: the connector declares no completeSnapshot, so reconcile
    // must never tombstone — absence from a result page is not a deletion.
    const reconcile = await reconcilePresenceItemsAfterPoll(env, {
      sourceTarget: hnTarget,
      observedUrlHashes: mine.map((item) => item.urlHash),
      completeSnapshot: false,
    });
    expect(reconcile.tombstoned).toBe(0);
  });

  it("captures nothing and fabricates nothing while the kill flag (PRESENCE_HN_ROLLOUT) is off — and /status stays honest", async () => {
    const seeded = await seedHnTarget();
    const disabled = makeEnv(undefined);

    const rows = await listSourceTargetsForEntity(disabled, seeded.userId, seeded.entityId);
    const target = rows.find((row) => row.connectorId === "hn");
    expect(target).toBeDefined();
    const hnTarget = target as SourceTargetRecord;

    const fetchImpl = algoliaFetcher(() => ({ body: SEARCH_PAGE }));
    const poll = await pollPresenceTarget(disabled, hnTarget, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(false);
    expect(poll.items).toEqual([]); // the capture-validity gate: no items, never fabricated
    expect(mockCalls(fetchImpl)).toHaveLength(0); // no courtesy spend while gated
    expect(await countLivePresenceItems(hnTarget.id)).toBe(0);

    // A disabled source can never render as "no data": the coverage stays
    // UNAVAILABLE (connector_disabled) — the mention-panel /status honesty
    // the epic's activation contract pins (same clause as #1378's phases).
    const coverage = await evaluatePresenceSourceCoverage(disabled, "hn", "self");
    expect(coverage.coverageLabel).toBe("UNAVAILABLE");
    expect(coverage.reasonCode).toBe("connector_disabled");
  });
});
