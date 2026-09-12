import { describe, expect, it, vi } from "vitest";

import {
  buildKeywordSearchUrl,
  THREADS_DAILY_QUERY_CAP,
  threadsConnector,
} from "~/lib/presence-connectors/threads.server";
import { getPresenceConnector } from "~/lib/presence-connector-registry.server";
import { upsertPollCursor } from "~/lib/presence-data.server";
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
