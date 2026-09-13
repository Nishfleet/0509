import { describe, expect, it, vi } from "vitest";

import {
  buildKeywordSearchUrl,
  THREADS_DAILY_QUERY_CAP,
  threadsConnector,
} from "~/lib/presence-connectors/threads.server";
import {
  getPresenceConnector,
  pollPresenceTarget,
} from "~/lib/presence-connector-registry.server";
import {
  listPresenceItems,
  listSourceTargetsForEntity,
  upsertPollCursor,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import { PRESENCE_USER_AGENT } from "~/lib/presence-robots.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext } from "~/lib/presence-types";

import migrationSql from "../../migrations/0099_widen_source_target_connector_threads.sql?raw";

import { appEnv, db, ISO_T0, uid } from "./fixtures";

/**
 * Threads keyword-search mention connector (Nishfleet/0509#3254) — the
 * approval-gated fast-follow source in the mentions epic (#3171).
 *
 * Runs on real workerd against the repo's real migrations, including the
 * CHECK-widening migration for 'threads' — the write path (a
 * connector_id = 'threads' row in source_target) and the read path are both
 * asserted against the real D1 engine, and the migration file itself is
 * re-applied in place to prove child-row preservation.
 *
 * Connector methods are network-shape contracts: a mock `fetchImpl` serves
 * fixture Graph API responses for `graph.threads.net` — the only real network
 * touched is the public-IP check inside `presenceSafeFetch`
 * (resolvePublicHttpUrl DNS), matching the gdelt/rss suites.
 *
 * Rate cap: Meta documents 2,200 keyword_search queries per user per rolling
 * 24h, counted across apps, with empty-result queries exempt. The fleet token
 * (`THREADS_ACCESS_TOKEN`) is a single Meta principal shared by every threads
 * target, so the suite asserts the connector refuses to poll once the open
 * usage windows stored in `presence_poll_cursor.cursor_json` total the cap —
 * the cap lives in connector logic, never assumed.
 */

const PHRASE = "Acme Robotics";
const TOKEN = "threads-test-token";

const THREADS_POST_URL = "https://www.threads.net/@acme/post/abcdefg";

const KEYWORD_SEARCH_PAGE = JSON.stringify({
  data: [
    {
      id: "1801234567890",
      text: "Acme Robotics just opened its first assembly plant",
      media_type: "TEXT",
      permalink: THREADS_POST_URL,
      // fixed-date: captured Meta keyword_search payload — parsed verbatim, never compared against the wall clock
      timestamp: "2026-09-10T05:42:03+0000",
      username: "acme",
      has_replies: false,
      is_quote_post: false,
      is_reply: false,
    },
    {
      // fixed-date: fixture data mirrors a captured Meta keyword_search response; the connector only parses the instant, it is not compared against a live clock
      // No permalink — must be skipped, never a fabricated canonicalUrl.
      id: "1801234567891",
      text: "permalink-less post",
      media_type: "TEXT",
      // fixed-date: captured Meta keyword_search payload — only exercised for the permalink-less skip, never aged against the wall clock
      timestamp: "2026-09-10T06:00:00+0000",
      username: "acme",
    },
  ],
});

const EMPTY_PAGE = JSON.stringify({ data: [] });

function makeEnv(rollout: string | undefined, token: string | undefined): AppEnv {
  return {
    ...appEnv,
    PRESENCE_THREADS_ROLLOUT: rollout,
    THREADS_ACCESS_TOKEN: token,
  } as AppEnv;
}

function makeCtx(
  fetchImpl: typeof fetch,
  rollout: string | undefined,
  token: string | undefined,
  trackingMode: "self" | "competitor" = "competitor",
): PresenceConnectorContext {
  return {
    env: makeEnv(rollout, token),
    userId: "user-threads-1",
    trackingMode,
    connection: null,
    fetchImpl,
  };
}

/** Fixture fetcher for the Threads Graph API shape. */
function graphFetcher(
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

async function seedThreadsTarget(
  options: { userId?: string; phrase?: string } = {},
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
       ) VALUES (?, ?, ?, 'threads', ?, NULL, ?, ?, 'OFFICIAL_PUBLIC_API', 1, ?, ?)`,
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
  return { userId, entityId, targetId, phrase };
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

async function readCursorJson(targetId: string): Promise<Record<string, unknown>> {
  const row = await db()
    .prepare(`SELECT cursor_json FROM presence_poll_cursor WHERE source_target_id = ?`)
    .bind(targetId)
    .first<{ cursor_json: string }>();
  return row ? (JSON.parse(row.cursor_json) as Record<string, unknown>) : {};
}

describe("threads mention connector — registration and docs coverage", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("threads");
    expect(connector).toBe(threadsConnector);
    expect(connector.id).toBe("threads");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated", () => {
    const docs = presenceSourceCoverageForDocs();
    const threads = docs.find((entry) => entry.sourceId === "threads");
    expect(threads).toBeDefined();
    expect(threads?.productionStatus).toBe("gated");
  });
});

describe("threads mention connector — validateTarget", () => {
  it("accepts a match phrase and emits target shape + metadata", async () => {
    const fetchImpl = graphFetcher(() => new Response("unreachable", { status: 500 }));
    const result = await threadsConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: PHRASE },
      makeCtx(fetchImpl, "internal", TOKEN),
    );
    expect(result.ok).toBe(true);
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(result.targetKey).toBe(PHRASE.toLowerCase());
    expect(result.targetHandle).toBe(PHRASE);
    expect(result.metadata?.matchPhrase).toBe(PHRASE);
    // validateTarget is offline: no network hop.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is gated while PRESENCE_THREADS_ROLLOUT is unset", async () => {
    const result = await threadsConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: PHRASE },
      makeCtx(graphFetcher(() => ({ body: "{}" })), undefined, TOKEN),
    );
    expect(result.ok).toBe(false);
    expect(result.coverageLabel).toBe("UNAVAILABLE");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("rejects a missing match phrase", async () => {
    const result = await threadsConnector.validateTarget(
      { trackingMode: "competitor" },
      makeCtx(graphFetcher(() => ({ body: "" })), "internal", TOKEN),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_match_phrase");
  });
});

describe("threads mention connector — poll", () => {
  it("returns items whose canonicalUrl is the threads.net permalink, with contentHash/publishedAt/author", async () => {
    const { targetId } = await seedThreadsTarget();
    const fetchImpl = graphFetcher((url) => {
      expect(url.hostname).toBe("graph.threads.net");
      expect(url.pathname).toBe("/v1.0/keyword_search");
      expect(url.searchParams.get("q")).toBe(PHRASE);
      expect(url.searchParams.get("search_mode")).toBe("KEYWORD");
      expect(url.searchParams.get("access_token")).toBe(TOKEN);
      return { body: KEYWORD_SEARCH_PAGE };
    });
    const result = await threadsConnector.poll(makeCtx(fetchImpl, "internal", TOKEN), {
      id: targetId,
      userId: "user-threads-1",
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    });

    expect(result.ok).toBe(true);
    // The permalink-less post is skipped, never fabricated.
    expect(result.items).toHaveLength(1);
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(result.costUnits).toBe(1);

    const first = result.items[0];
    expect(first?.canonicalUrl).toBe(THREADS_POST_URL);
    expect(first?.canonicalUrl).not.toContain("graph.threads.net");
    expect(first?.externalId).toBe("1801234567890");
    expect(first?.contentHash).toBeTruthy();
    // fixed-date: mirrors the fixture's +0000 form through the connector's ISO normalization — no live clock read
    expect(first?.publishedAt).toBe("2026-09-10T05:42:03.000Z");
    expect(first?.author).toBe("@acme");
    expect(first?.title).toContain("Acme Robotics");
    expect(first?.bodyExcerpt?.length).toBeLessThanOrEqual(280);
    expect((first?.raw as Record<string, unknown>)?.kind).toBe("threads_post");
    // Search results are never a complete snapshot — reconcile must not
    // tombstone on absence from a ranked result page.
    expect(result.cursor?.completeSnapshot).toBeUndefined();
    // One serialized request per poll — no parallel fan-out.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Every request rides the presenceSafeFetch path.
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const init = (call[1] ?? {}) as RequestInit;
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(PRESENCE_USER_AGENT);
  });

  it("returns ok: true, items: [] for an empty result set (honest empty)", async () => {
    const { targetId } = await seedThreadsTarget();
    const fetchImpl = graphFetcher(() => ({ body: EMPTY_PAGE }));
    const result = await threadsConnector.poll(makeCtx(fetchImpl, "internal", TOKEN), {
      id: targetId,
      userId: "user-threads-1",
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    });
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
    // Meta: queries returning no results do not count against the cap.
    expect(result.costUnits).toBe(0);
  });

  it("maps HTTP errors to honest degraded results, never fabricated items", async () => {
    const { targetId } = await seedThreadsTarget();
    const target = {
      id: targetId,
      userId: "user-threads-1",
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    };
    const err = await threadsConnector.poll(
      makeCtx(graphFetcher(() => ({ body: '{"error":{"message":"bad token"}}', status: 400 })), "internal", TOKEN),
      target,
    );
    expect(err.ok).toBe(false);
    expect(err.items).toEqual([]);
    expect(err.errorCode).toBe("threads_api_error");

    const rateLimited = await threadsConnector.poll(
      makeCtx(graphFetcher(() => ({ body: "{}", status: 429 })), "internal", TOKEN),
      target,
    );
    expect(rateLimited.ok).toBe(false);
    expect(rateLimited.errorCode).toBe("rate_limited");
  });

  it("refuses the poll without fetching when the rollout or the token is missing", async () => {
    const { targetId } = await seedThreadsTarget();
    const target = {
      id: targetId,
      userId: "user-threads-1",
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    };
    const fetchImpl = graphFetcher(() => ({ body: KEYWORD_SEARCH_PAGE }));

    const gated = await threadsConnector.poll(makeCtx(fetchImpl, undefined, TOKEN), target);
    expect(gated.ok).toBe(false);
    expect(gated.errorCode).toBe("connector_disabled");

    const noToken = await threadsConnector.poll(
      makeCtx(fetchImpl, "internal", undefined),
      target,
    );
    expect(noToken.ok).toBe(false);
    expect(noToken.errorCode).toBe("credentials_missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a target with no match phrase without calling the API", async () => {
    const { targetId } = await seedThreadsTarget({ phrase: "x" });
    const fetchImpl = graphFetcher(() => ({ body: KEYWORD_SEARCH_PAGE }));
    const result = await threadsConnector.poll(makeCtx(fetchImpl, "internal", TOKEN), {
      id: targetId,
      userId: "user-threads-1",
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


/**
 * Issue #3205 — the acceptance this suite closes: the fixture mention must
 * reach the mention TABLE through the real end-to-end path
 * (pollPresenceTarget -> upsertPresenceItems -> listPresenceItems), deduped
 * by canonical URL, behind the per-source kill flag, with the
 * capture-validity gates proven on the full path — not just at the connector.
 *
 * Runs BEFORE the 2,200-cap describe (same storage contract the cap suite's
 * header note records): the cap sums every target's OPEN window, so the
 * capture polls need a principal with no at-cap window seeded yet.
 */
describe("threads mention connector — capture into the mention table (issue #3205)", () => {
  it("captures the fixture mention into presence_item through the full poll -> upsert -> list path (>=1 mention), and dedupes by canonical URL", async () => {
    const { userId, entityId } = await seedThreadsTarget();
    const env = makeEnv("internal", TOKEN);

    // Refetch through the data layer so we operate on the real mapped record.
    const targets = await listSourceTargetsForEntity(env, userId, entityId);
    const target = targets.find((t) => t.connectorId === "threads");
    expect(target).toBeDefined();
    if (!target) throw new Error("expected the seeded threads source_target");

    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      fetchImpl: graphFetcher(() => ({ body: KEYWORD_SEARCH_PAGE })),
    });
    expect(poll.ok, `poll: ${JSON.stringify(poll)}`).toBe(true);
    expect(poll.items).toHaveLength(1);

    const upsert = await upsertPresenceItems(env, { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBeGreaterThanOrEqual(1);

    // Exactly one live presence_item row for this source_target.
    expect(await countLivePresenceItems(target.id)).toBe(1);

    const items = await listPresenceItems(env, userId, {
      trackedEntityId: target.trackedEntityId,
      connectorId: "threads",
    });
    expect(items).toHaveLength(1);
    const mention = items[0];
    expect(mention?.connectorId).toBe("threads");
    // The mention's canonicalUrl IS the dedup key: the threads.net permalink,
    // hashed into a unique-per-target url_hash.
    expect(mention?.canonicalUrl).toBe(THREADS_POST_URL);
    expect(mention?.urlHash).toBeTruthy();
    expect(mention?.contentHash).toBeTruthy();
    expect(mention?.isTombstone).toBe(false);

    // A second identical poll + upsert must NOT multiply rows — the same
    // canonical URL hashes to the same url_hash and updates the existing row.
    const pollAgain = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      fetchImpl: graphFetcher(() => ({ body: KEYWORD_SEARCH_PAGE })),
    });
    expect(pollAgain.ok).toBe(true);
    expect(pollAgain.items).toHaveLength(1);
    await upsertPresenceItems(env, { sourceTarget: target, items: pollAgain.items });
    expect(await countLivePresenceItems(target.id)).toBe(1);

    const after = await listPresenceItems(env, userId, {
      trackedEntityId: target.trackedEntityId,
      connectorId: "threads",
    });
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(mention?.id);
  });

  it("capture-validity gate: with the rollout kill flag off, the full path captures nothing and never fetches", async () => {
    const { userId, entityId } = await seedThreadsTarget();
    // The target is listed through the live gate (data reads are passive); the
    // poll itself runs with PRESENCE_THREADS_ROLLOUT unset -> disabled.
    const listed = await listSourceTargetsForEntity(makeEnv("internal", TOKEN), userId, entityId);
    const target = listed.find((t) => t.connectorId === "threads");
    expect(target).toBeDefined();
    if (!target) throw new Error("expected the seeded threads source_target");

    const fetchImpl = graphFetcher(() => ({ body: KEYWORD_SEARCH_PAGE }));
    const poll = await pollPresenceTarget(makeEnv(undefined, TOKEN), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("connector_not_operational");
    expect(poll.items).toHaveLength(0);
    // The kill flag stops capture before any network hop.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await countLivePresenceItems(target.id)).toBe(0);
  });

  it("capture-validity gate: a missing Meta token stops the poll through the full path, before any fetch", async () => {
    const { userId, entityId } = await seedThreadsTarget();
    const listed = await listSourceTargetsForEntity(makeEnv("internal", TOKEN), userId, entityId);
    const target = listed.find((t) => t.connectorId === "threads");
    expect(target).toBeDefined();
    if (!target) throw new Error("expected the seeded threads source_target");

    const fetchImpl = graphFetcher(() => ({ body: KEYWORD_SEARCH_PAGE }));
    const poll = await pollPresenceTarget(makeEnv("internal", undefined), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("connector_not_operational");
    expect(poll.items).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await countLivePresenceItems(target.id)).toBe(0);
  });
});

describe("threads mention connector — 2,200 queries/user/24h cap in cursor_json", () => {
  // Usage is summed across every threads target's open window (one shared
  // Meta principal) and test storage is per-file, so this closed-window test
  // must run BEFORE any sibling seeds a fresh at-cap window.
  it("ignores a closed usage window older than 24h", async () => {
    const { userId, targetId } = await seedThreadsTarget();
    const staleStart = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await upsertPollCursor(makeEnv("internal", TOKEN), targetId, {
      cursor: { threadsUsage: { windowStart: staleStart, count: THREADS_DAILY_QUERY_CAP } },
      lastPolledAt: new Date().toISOString(),
    });
    const fetchImpl = graphFetcher(() => ({ body: KEYWORD_SEARCH_PAGE }));
    const result = await threadsConnector.poll(makeCtx(fetchImpl, "internal", TOKEN), {
      id: targetId,
      userId,
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    });
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    // The expired window rotated: count restarts at 1 for the new window.
    const usage = (result.cursor as Record<string, unknown>).threadsUsage as {
      windowStart: string;
      count: number;
    };
    expect(usage.count).toBe(1);
    expect(usage.windowStart).not.toBe(staleStart);
  });

  it("records counted usage in presence_poll_cursor.cursor_json and enforces the cap", async () => {
    const { userId, targetId } = await seedThreadsTarget();
    const target = {
      id: targetId,
      userId,
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    };
    const fetchImpl = graphFetcher(() => ({ body: KEYWORD_SEARCH_PAGE }));

    const first = await threadsConnector.poll(makeCtx(fetchImpl, "internal", TOKEN), target);
    expect(first.ok).toBe(true);
    // Persist the connector's returned cursor the way pollPresenceSourceTarget
    // does (cursor lands in presence_poll_cursor.cursor_json).
    await upsertPollCursor(makeEnv("internal", TOKEN), targetId, {
      cursor: first.cursor,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });

    const stored = await readCursorJson(targetId);
    const usage = stored.threadsUsage as { windowStart: string; count: number };
    expect(usage.count).toBe(1);
    expect(Number.isNaN(new Date(usage.windowStart).getTime())).toBe(false);

    const second = await threadsConnector.poll(makeCtx(fetchImpl, "internal", TOKEN), target);
    expect(second.ok).toBe(true);
    const secondUsage = (second.cursor as Record<string, unknown>).threadsUsage as {
      count: number;
    };
    expect(secondUsage.count).toBe(2);
  });

  it("does not count an empty-result query against the cap", async () => {
    const { userId, targetId } = await seedThreadsTarget();
    const target = {
      id: targetId,
      userId,
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    };
    const result = await threadsConnector.poll(
      makeCtx(graphFetcher(() => ({ body: EMPTY_PAGE })), "internal", TOKEN),
      target,
    );
    expect(result.ok).toBe(true);
    const usage = (result.cursor as Record<string, unknown>).threadsUsage as { count: number };
    expect(usage.count).toBe(0);
  });

  it("blocks a poll at the documented cap without sending a query", async () => {
    const { userId, targetId } = await seedThreadsTarget();
    // Seed this target's cursor at the cap inside the open 24h window.
    await upsertPollCursor(makeEnv("internal", TOKEN), targetId, {
      cursor: { threadsUsage: { windowStart: new Date().toISOString(), count: THREADS_DAILY_QUERY_CAP } },
      lastPolledAt: new Date().toISOString(),
    });
    const fetchImpl = graphFetcher(() => ({ body: KEYWORD_SEARCH_PAGE }));
    const result = await threadsConnector.poll(makeCtx(fetchImpl, "internal", TOKEN), {
      id: targetId,
      userId,
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("threads_daily_query_cap");
    expect(result.items).toEqual([]);
    // The cap is enforced in connector logic: no query was ever sent.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces the cap across the token principal — another workspace's threads usage counts", async () => {
    const { userId, targetId } = await seedThreadsTarget();
    // A different workspace user's threads target, already at the cap.
    const other = await seedThreadsTarget({ phrase: "Other Phrase" });
    await upsertPollCursor(makeEnv("internal", TOKEN), other.targetId, {
      cursor: { threadsUsage: { windowStart: new Date().toISOString(), count: THREADS_DAILY_QUERY_CAP } },
      lastPolledAt: new Date().toISOString(),
    });
    const fetchImpl = graphFetcher(() => ({ body: KEYWORD_SEARCH_PAGE }));
    const result = await threadsConnector.poll(makeCtx(fetchImpl, "internal", TOKEN), {
      id: targetId,
      userId,
      targetKey: PHRASE.toLowerCase(),
      targetUrl: null,
      targetHandle: PHRASE,
      metadata: { matchPhrase: PHRASE },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("threads_daily_query_cap");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("threads mention connector — healthCheck", () => {
  it("reports pending while PRESENCE_THREADS_ROLLOUT is unset", async () => {
    const result = await threadsConnector.healthCheck(makeCtx(graphFetcher(() => ({ body: "{}" })), undefined, TOKEN));
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("reports pending while the Meta token is missing", async () => {
    const result = await threadsConnector.healthCheck(
      makeCtx(graphFetcher(() => ({ body: "{}" })), "internal", undefined),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("credentials_missing");
  });

  it("reports healthy when the rollout is on and Graph answers the /me probe", async () => {
    const fetchImpl = graphFetcher((url) => {
      expect(url.hostname).toBe("graph.threads.net");
      expect(url.pathname).toBe("/v1.0/me");
      expect(url.searchParams.get("access_token")).toBe(TOKEN);
      return { body: '{"id":"123"}' };
    });
    const result = await threadsConnector.healthCheck(makeCtx(fetchImpl, "internal", TOKEN));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
  });

  it("reports degraded on a Graph error response", async () => {
    const result = await threadsConnector.healthCheck(
      makeCtx(graphFetcher(() => ({ body: '{"error":{"message":"OAuthException"}}', status: 400 })), "internal", TOKEN),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("degraded");
    expect(result.errorCode).toBe("threads_unreachable");
  });
});

describe("threads mention connector — presence substrate (real migrations)", () => {
  it("writes connector_id = 'threads' via the CHECK-widened migration and reads it back", async () => {
    // The real migrations — including
    // 0099_widen_source_target_connector_threads — ran in the test setup, so
    // this write only succeeds when the CHECK genuinely accepts 'threads'.
    const { targetId, userId } = await seedThreadsTarget();
    const row = await db()
      .prepare(`SELECT connector_id, target_key, user_id FROM source_target WHERE id = ?`)
      .bind(targetId)
      .first<{ connector_id: string; target_key: string; user_id: string }>();
    // READ path: the widened row reads back through the real engine.
    expect(row?.connector_id).toBe("threads");
    expect(row?.target_key).toBe(PHRASE.toLowerCase());
    expect(row?.user_id).toBe(userId);
  });

  it("re-applies the 0099 migration cleanly and preserves child rows", async () => {
    // Seed a full target + child rows, then re-run the real migration
    // statements in place — the rebuild must copy the threads row through and
    // restore every cascaded child row set (0093 rebuild convention).
    const { userId, entityId, targetId } = await seedThreadsTarget();
    const itemId = uid("item");
    const revisionId = uid("rev");
    await db().batch([
      db().prepare(
        `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, canonical_url, url_hash, title, content_hash, revision, observed_at, created_at)
         VALUES (?, ?, ?, ?, 'threads', ?, 'h', 't', 'ch', 1, 'o', 'c')`,
      ).bind(itemId, targetId, entityId, userId, THREADS_POST_URL),
      db().prepare(
        `INSERT INTO presence_poll_cursor (source_target_id, cursor_json, updated_at) VALUES (?, '{}', 'u')`,
      ).bind(targetId),
      db().prepare(
        `INSERT INTO presence_item_revision (id, presence_item_id, revision, content_hash, title, observed_at, created_at)
         VALUES (?, ?, 1, 'ch', 't', 'o', 'c')`,
      ).bind(revisionId, itemId),
    ]);

    // 0099 also carries 'bluesky' (0098_gdelt rebuilt the CHECK without
    // it), so this write through the chain-final CHECK is the proof of the
    // heal — and it must predate the re-application to prove the COPY keeps
    // the healed row through the rebuild.
    const blueskyTargetId = uid("target");
    await db().prepare(
      `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'bluesky', 'bluesky-phrase', 1, 'c', 'u')`,
    ).bind(blueskyTargetId, entityId, userId).run();

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
    expect(kept?.connector_id).toBe("threads");

    // The bluesky row predating the rebuild survives the copy (order-proof
    // CHECK: both 0098 sibling values + 'threads' + the base four).
    const healed = await db()
      .prepare(`SELECT connector_id, target_key FROM source_target WHERE id = ?`)
      .bind(blueskyTargetId)
      .first<{ connector_id: string; target_key: string }>();
    expect(healed?.connector_id).toBe("bluesky");
    expect(healed?.target_key).toBe("bluesky-phrase");

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

describe("threads mention connector — request shape", () => {
  it("builds the documented keyword_search URL", () => {
    const url = new URL(buildKeywordSearchUrl("Acme Robotics", "tok"));
    expect(url.hostname).toBe("graph.threads.net");
    expect(url.pathname).toBe("/v1.0/keyword_search");
    expect(url.searchParams.get("q")).toBe("Acme Robotics");
    expect(url.searchParams.get("search_type")).toBe("RECENT");
    expect(url.searchParams.get("access_token")).toBe("tok");
  });
});
