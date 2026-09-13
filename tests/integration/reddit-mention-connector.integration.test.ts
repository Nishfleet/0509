import { describe, expect, it, vi } from "vitest";

import {
  REDDIT_RATE_BUDGET_PER_WINDOW,
  redditConnector,
  resetRedditAccessTokenCacheForTests,
} from "~/lib/presence-connectors/reddit.server";
import { getPresenceConnector, pollPresenceTarget } from "~/lib/presence-connector-registry.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import { PRESENCE_USER_AGENT } from "~/lib/presence-robots.server";
import {
  listPresenceItems,
  listSourceTargetsForEntity,
  upsertPollCursor,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  PresenceConnectorContext,
  SourceTargetRecord,
} from "~/lib/presence-types";

import { appEnv, db, ISO_T0, uid } from "./fixtures";

/**
 * Reddit mention connector (Nishfleet/0509#3202 — split of #3171).
 *
 * Runs on real workerd against the repo's real migrations. `reddit` is in the
 * `source_target.connector_id` CHECK since migration 0055, so NO schema change
 * is needed: the write path (a connector_id = 'reddit' row) and the read path
 * (the mention read back out of presence_item) are both asserted against the
 * real D1 engine.
 *
 * Connector methods are network-shape contracts: a mock `fetchImpl` serves
 * fixture responses for the documented www.reddit.com credential grant and
 * the oauth.reddit.com listing read, and every hop is asserted to ride the
 * house paths — the grant via the resolve+bounded-read precedent, the listing
 * via `presenceSafeFetch` (presence User-Agent, redirect: manual) with the
 * granted bearer injected by the wrapping fetcher.
 *
 * Rate budget: the documented 100 requests/minute per OAuth client id,
 * averaged over a 10-minute window (Data API Wiki), enforced as 1,000 reads
 * per 10-minute window in `presence_poll_cursor.cursor_json`, summed across
 * ALL reddit targets (one shared fleet client). Unlike Meta's keyword search,
 * Reddit documents no free-read exemption, so every attempt counts — success,
 * failure, or empty.
 */

const SUBREDDIT = "brandwatch";
const POST_A_ID = "1abcd01";
const POST_A_PERMALINK = `https://www.reddit.com/r/${SUBREDDIT}/comments/1abcd01/allbirds_launch/`;

// fixed-date: static mocked Reddit API payload — asserted verbatim, never compared against the wall clock
const POST_A_CREATED_UTC = 1_767_225_600; // 2026-01-01T00:00:00.000Z
const TOKEN_JSON = JSON.stringify({
  access_token: "test-token-1",
  token_type: "bearer",
  expires_in: 3600,
});
const LISTING_JSON = JSON.stringify({
  kind: "Listing",
  data: {
    children: [
      {
        kind: "t3",
        data: {
          id: POST_A_ID,
          title: "AllBirds opens its first Paris store",
          selftext: "The wool runners are back.",
          author: "sneakerfan",
          permalink: `/r/${SUBREDDIT}/comments/1abcd01/allbirds_launch/`,
          created_utc: POST_A_CREATED_UTC,
          score: 42,
          num_comments: 7,
          subreddit: SUBREDDIT,
        },
      },
      {
        kind: "t3",
        data: { id: "1abcd02", title: "no permalink attached" },
      },
    ],
  },
});
const EMPTY_LISTING_JSON = JSON.stringify({ kind: "Listing", data: { children: [] } });

function activatedEnv(): AppEnv {
  return {
    ...appEnv,
    PRESENCE_REDDIT_ROLLOUT: "internal",
    REDDIT_CLIENT_ID: "client-id-1",
    REDDIT_CLIENT_SECRET: "client-secret-1",
    REDDIT_COMMERCIAL_ACCESS: "approved",
  };
}

function makeCtx(
  fetchImpl: typeof fetch,
  env: AppEnv = activatedEnv(),
): PresenceConnectorContext {
  return {
    env,
    userId: "user-reddit-1",
    trackingMode: "self",
    connection: null,
    fetchImpl,
  };
}

interface RecordedCall {
  url: URL;
  init: RequestInit | undefined;
}

/**
 * Fixture fetcher: answers the documented www.reddit.com token grant and the
 * oauth.reddit.com listing, and records every call for the network-shape
 * assertions (the handler receives the call index so stateful fixtures —
 * 401-then-recover — stay declarative).
 */
function redditFetcher(
  handler: (url: URL, callIndex: number) => {
    body: string;
    status?: number;
  },
): typeof fetch & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = vi.fn(async (input: string | URL, init?: Parameters<typeof fetch>[1]) => {
    calls.push({ url: new URL(input.toString()), init });
    const response = handler(new URL(input.toString()), calls.length - 1);
    return new Response(response.body, {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch & { calls: RecordedCall[] };
  impl.calls = calls;
  return impl;
}

function fixtureHandler(url: URL): { body: string; status?: number } {
  if (url.pathname === "/api/v1/access_token") {
    expect(url.hostname).toBe("www.reddit.com");
    return { body: TOKEN_JSON };
  }
  if (url.pathname === `/r/${SUBREDDIT}/new`) {
    expect(url.hostname).toBe("oauth.reddit.com");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("raw_json")).toBe("1");
    return { body: LISTING_JSON };
  }
  return { body: "{}", status: 404 };
}

function pollTarget(
  targetId: string,
  userId: string,
): { id: string; userId: string; targetKey: string; targetUrl: null; targetHandle: string; metadata: Record<string, never> } {
  return {
    id: targetId,
    userId,
    targetKey: SUBREDDIT,
    targetUrl: null,
    targetHandle: SUBREDDIT,
    metadata: {},
  };
}

async function seedRedditTarget(): Promise<{ userId: string; targetId: string }> {
  const userId = uid("user");
  const entityId = uid("entity");
  const targetId = uid("target");
  await db()
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(userId, `Fixture ${userId}`, `${userId}@example.test`, ISO_T0, ISO_T0)
    .run();
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', 'AllBirds', 'https://allbirds.com', NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, ISO_T0, ISO_T0)
    .run();
  // WRITE path against the real 0055 CHECK — 'reddit' needed no widening.
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, target_url,
         target_handle, metadata_json, coverage_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'reddit', ?, NULL, ?, '{}', 'OFFICIAL_PUBLIC_API', 1, ?, ?)`,
    )
    .bind(targetId, entityId, userId, SUBREDDIT, SUBREDDIT, ISO_T0, ISO_T0)
    .run();
  return { userId, targetId };
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
    .first<{ cursor_json: string | null }>();
  try {
    return (JSON.parse(row?.cursor_json ?? "{}") ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe("reddit mention connector — registration and docs coverage", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("reddit");
    expect(connector).toBe(redditConnector);
    expect(connector.id).toBe("reddit");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated and honest coverage notes", () => {
    const docs = presenceSourceCoverageForDocs();
    const reddit = docs.find((entry) => entry.sourceId === "reddit");
    expect(reddit).toBeDefined();
    expect(reddit?.productionStatus).toBe("gated");
    // The coverage note states what the public surface covers.
    expect(reddit?.notes).toContain("new posts of tracked subreddit targets");
    expect(reddit?.notes).toContain("PRESENCE_REDDIT_ROLLOUT");
    expect(reddit?.notes).toContain("REDDIT_COMMERCIAL_ACCESS");
  });
});

describe("reddit mention connector — validateTarget", () => {
  it("accepts a subreddit target, strips the r/ prefix, stays offline", async () => {
    const fetchImpl = redditFetcher(() => ({ body: "{}" }));
    const result = await redditConnector.validateTarget(
      { trackingMode: "self", targetHandle: `r/${SUBREDDIT}` },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(true);
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(result.targetKey).toBe(SUBREDDIT);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a missing subreddit", async () => {
    const result = await redditConnector.validateTarget(
      { trackingMode: "self" },
      makeCtx(redditFetcher(() => ({ body: "{}" }))),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_subreddit");
  });
});

describe("reddit mention connector — poll (real Data API path)", () => {
  it("grants, then reads the tracked subreddit's new posts as presence items", async () => {
    resetRedditAccessTokenCacheForTests();
    const fetchImpl = redditFetcher(fixtureHandler);
    const target = pollTarget(uid("target"), "user-reddit-1");
    const result = await redditConnector.poll(makeCtx(fetchImpl), target);

    expect(result.ok).toBe(true);
    // The fixture returns >=1 mention (acceptance) — and exactly one, because
    // the child with no usable permalink is skipped, never fabricated.
    expect(result.items).toHaveLength(1);

    const first = result.items[0];
    expect(first).toBeDefined();
    expect(first?.externalId).toBe(POST_A_ID);
    expect(first?.canonicalUrl).toBe(POST_A_PERMALINK);
    expect(first?.canonicalUrl).not.toContain("oauth.reddit.com");
    expect(first?.contentHash).toBeTruthy();
    // fixed-date: the capture copies the fixture's created_utc through unchanged —
    // this assertion compares verbatim, never against the wall clock (staleness
    // paths in this file use relative Date.now() offsets).
    expect(first?.publishedAt).toBe("2026-01-01T00:00:00.000Z"); // fixed-date: fixture created_utc, compared verbatim, not against the clock
    expect(first?.author).toBe("u/sneakerfan");
    expect((first?.raw as Record<string, unknown> | null)?.score).toBe(42);
    expect((first?.raw as Record<string, unknown> | null)?.numComments).toBe(7);

    // Two hops exactly: the credential grant, then the listing read.
    expect(fetchImpl.calls).toHaveLength(2);
    const grant = fetchImpl.calls[0];
    const listing = fetchImpl.calls[1];
    expect(grant?.url.pathname).toBe("/api/v1/access_token");
    expect(grant?.init?.method).toBe("POST");
    expect((grant?.init?.headers as Record<string, string>)["authorization"]).toBe(
      `Basic ${btoa("client-id-1:client-secret-1")}`,
    );
    expect(grant?.init?.body).toBe("grant_type=client_credentials");
    expect(listing?.url.hostname).toBe("oauth.reddit.com");
    // The listing read rode the presenceSafeFetch path: presence UA + manual
    // redirects, with the granted bearer injected by the wrapping fetcher.
    expect(listing?.init?.redirect).toBe("manual");
    // The bearer-wrapped fetcher normalizes headers to a Headers instance —
    // read them as such; the presence UA proves the presenceSafeFetch hop.
    const listingHeaders = new Headers(listing?.init?.headers);
    expect(listingHeaders.get("user-agent")).toBe(PRESENCE_USER_AGENT);
    expect(listingHeaders.get("authorization")).toBe("Bearer test-token-1");
  });

  it("grants once and reuses the cached access token across polls", async () => {
    resetRedditAccessTokenCacheForTests();
    const fetchImpl = redditFetcher(fixtureHandler);
    const target = pollTarget(uid("target"), "user-reddit-1");
    await redditConnector.poll(makeCtx(fetchImpl), target);
    await redditConnector.poll(makeCtx(fetchImpl), target);
    const grantCalls = fetchImpl.calls.filter(
      (call) => call.url.pathname === "/api/v1/access_token",
    );
    expect(grantCalls).toHaveLength(1);
  });

  it("drops the cached token on 401 and recovers by re-granting", async () => {
    resetRedditAccessTokenCacheForTests();
    let listingCalls = 0;
    const fetchImpl = redditFetcher((url) => {
      if (url.pathname === "/api/v1/access_token") return { body: TOKEN_JSON };
      listingCalls += 1;
      return listingCalls === 1 ? { body: "{}", status: 401 } : { body: LISTING_JSON };
    });
    const target = pollTarget(uid("target"), "user-reddit-1");
    const first = await redditConnector.poll(makeCtx(fetchImpl), target);
    expect(first.ok).toBe(false);
    expect(first.errorCode).toBe("credentials_invalid");
    expect(first.items).toEqual([]);
    const second = await redditConnector.poll(makeCtx(fetchImpl), target);
    expect(second.ok).toBe(true);
    expect(second.items).toHaveLength(1);
  });

  it("maps HTTP 429 to rate_limited and 5xx to reddit_api_error, never fabricated items", async () => {
    resetRedditAccessTokenCacheForTests();
    const rateLimited = await redditConnector.poll(
      makeCtx(
        redditFetcher((url) =>
          url.pathname === "/api/v1/access_token"
            ? { body: TOKEN_JSON }
            : { body: "{}", status: 429 },
        ),
      ),
      pollTarget(uid("target"), "user-reddit-1"),
    );
    expect(rateLimited.ok).toBe(false);
    expect(rateLimited.errorCode).toBe("rate_limited");
    expect(rateLimited.items).toEqual([]);

    const failing = await redditConnector.poll(
      makeCtx(
        redditFetcher((url) =>
          url.pathname === "/api/v1/access_token"
            ? { body: TOKEN_JSON }
            : { body: "{}", status: 500 },
        ),
      ),
      pollTarget(uid("target"), "user-reddit-1"),
    );
    expect(failing.ok).toBe(false);
    expect(failing.errorCode).toBe("reddit_api_error");
    expect(failing.items).toEqual([]);
  });

  it("refuses the poll without fetching when the rollout is off", async () => {
    resetRedditAccessTokenCacheForTests();
    const fetchImpl = redditFetcher(() => ({ body: LISTING_JSON }));
    const result = await redditConnector.poll(
      makeCtx(fetchImpl, { ...activatedEnv(), PRESENCE_REDDIT_ROLLOUT: "disabled" }),
      pollTarget(uid("target"), "user-reddit-1"),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("connector_disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("reddit mention connector — 1,000 reads/10min budget in cursor_json", () => {
  // Usage is summed across every reddit target's open window (one shared
  // fleet OAuth client) and test storage is per-file, so this closed-window
  // test must run BEFORE any sibling persists a fresh at-cap window.
  it("ignores a closed usage window older than 10 minutes", async () => {
    const { userId, targetId } = await seedRedditTarget();
    const staleStart = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    await upsertPollCursor(activatedEnv(), targetId, {
      cursor: { redditUsage: { windowStart: staleStart, count: REDDIT_RATE_BUDGET_PER_WINDOW } },
      lastPolledAt: new Date().toISOString(),
    });
    const fetchImpl = redditFetcher(fixtureHandler);
    const result = await redditConnector.poll(makeCtx(fetchImpl), pollTarget(targetId, userId));
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    // The expired window rotated: count restarts at 1 for the new window.
    const usage = (result.cursor as Record<string, unknown>).redditUsage as {
      windowStart: string;
      count: number;
    };
    expect(usage.count).toBe(1);
    expect(usage.windowStart).not.toBe(staleStart);
  });

  it("records counted usage in presence_poll_cursor.cursor_json and enforces the budget", async () => {
    const { userId, targetId } = await seedRedditTarget();
    const target = pollTarget(targetId, userId);
    const fetchImpl = redditFetcher(fixtureHandler);

    const first = await redditConnector.poll(makeCtx(fetchImpl), target);
    expect(first.ok).toBe(true);
    // Persist the connector's returned cursor the way pollPresenceSourceTarget
    // does (cursor lands in presence_poll_cursor.cursor_json).
    await upsertPollCursor(activatedEnv(), targetId, {
      cursor: first.cursor,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });

    const stored = await readCursorJson(targetId);
    const usage = stored.redditUsage as { windowStart: string; count: number };
    expect(usage.count).toBe(1);
    expect(Number.isNaN(new Date(usage.windowStart).getTime())).toBe(false);

    const second = await redditConnector.poll(makeCtx(fetchImpl), target);
    expect(second.ok).toBe(true);
    const secondUsage = (second.cursor as Record<string, unknown>).redditUsage as {
      count: number;
    };
    expect(secondUsage.count).toBe(2);
  });

  it("counts even an empty listing — Reddit documents no free-read exemption", async () => {
    const { userId, targetId } = await seedRedditTarget();
    const result = await redditConnector.poll(
      makeCtx(
        redditFetcher((url) =>
          url.pathname === "/api/v1/access_token"
            ? { body: TOKEN_JSON }
            : { body: EMPTY_LISTING_JSON },
        ),
      ),
      pollTarget(targetId, userId),
    );
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
    const usage = (result.cursor as Record<string, unknown>).redditUsage as { count: number };
    expect(usage.count).toBe(1);
  });

  it("blocks a poll at the documented budget without sending a read", async () => {
    const { userId, targetId } = await seedRedditTarget();
    // Seed this target's cursor at the cap inside the open 10-minute window.
    await upsertPollCursor(activatedEnv(), targetId, {
      cursor: {
        redditUsage: { windowStart: new Date().toISOString(), count: REDDIT_RATE_BUDGET_PER_WINDOW },
      },
      lastPolledAt: new Date().toISOString(),
    });
    const fetchImpl = redditFetcher(fixtureHandler);
    const result = await redditConnector.poll(makeCtx(fetchImpl), pollTarget(targetId, userId));
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("reddit_rate_budget");
    expect(result.items).toEqual([]);
    // The budget is enforced in connector logic: no read was ever sent.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces the budget across the fleet client — another workspace's usage counts", async () => {
    const { userId, targetId } = await seedRedditTarget();
    // A different workspace's reddit target, already at the cap.
    const other = await seedRedditTarget();
    await upsertPollCursor(activatedEnv(), other.targetId, {
      cursor: {
        redditUsage: { windowStart: new Date().toISOString(), count: REDDIT_RATE_BUDGET_PER_WINDOW },
      },
      lastPolledAt: new Date().toISOString(),
    });
    const fetchImpl = redditFetcher(fixtureHandler);
    const result = await redditConnector.poll(makeCtx(fetchImpl), pollTarget(targetId, userId));
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("reddit_rate_budget");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("reddit mention connector — healthCheck", () => {
  it("reports pending while PRESENCE_REDDIT_ROLLOUT is unset", async () => {
    resetRedditAccessTokenCacheForTests();
    const result = await redditConnector.healthCheck(
      makeCtx(redditFetcher(fixtureHandler), {
        ...activatedEnv(),
        PRESENCE_REDDIT_ROLLOUT: undefined,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("reports degraded when the rollout is on but the Data API does not answer", async () => {
    resetRedditAccessTokenCacheForTests();
    const result = await redditConnector.healthCheck(
      makeCtx(redditFetcher(() => ({ body: "down", status: 503 }))),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("degraded");
  });
});

describe("reddit mention connector — presence substrate (real migrations)", () => {
  it("captures >=1 mention into presence_item through the real registry dispatch, deduped by canonical URL", async () => {
    resetRedditAccessTokenCacheForTests();
    const { userId, targetId } = await seedRedditTarget();
    // The budget tests earlier in this file persist fleet-wide usage windows
    // (test storage is per-FILE); isolate this test with an empty ledger.
    await db()
      .prepare(
        `DELETE FROM presence_poll_cursor WHERE source_target_id IN
         (SELECT id FROM source_target WHERE connector_id = 'reddit')`,
      )
      .run();
    const entityId = (
      await db()
        .prepare(`SELECT id FROM tracked_entity WHERE user_id = ?`)
        .bind(userId)
        .first<{ id: string }>()
    )?.id;
    expect(entityId).toBeTruthy();
    const targets = await listSourceTargetsForEntity(activatedEnv(), userId, entityId as string);
    const target = targets.find((row) => row.id === targetId);
    expect(target).toBeDefined();
    expect(target?.connectorId).toBe("reddit");

    // The hermetic fixture: the fixture fetch rides the registry's options.
    const substrateFetch = redditFetcher(fixtureHandler);
    const poll = await pollPresenceTarget(activatedEnv(), target as SourceTargetRecord, {
      trackingMode: "self",
    }, { fetchImpl: substrateFetch });
    expect(poll.ok, `poll errorCode=${poll.errorCode} msg=${poll.errorMessage}`).toBe(true);
    expect(poll.items).toHaveLength(1);

    const upsert = await upsertPresenceItems(activatedEnv(), {
      sourceTarget: target as SourceTargetRecord,
      items: poll.items,
    });
    expect(upsert.inserted).toBeGreaterThanOrEqual(1);

    // Exactly one live presence_item row for this source_target.
    expect(await countLivePresenceItems(targetId)).toBe(1);
    const items = await listPresenceItems(activatedEnv(), userId, {
      connectorId: "reddit",
    });
    const only = items.find((item) => item.sourceTargetId === targetId);
    expect(only).toBeDefined();
    expect(only?.connectorId).toBe("reddit");
    expect(only?.externalId).toBe(POST_A_ID);
    expect(only?.urlHash).toBeTruthy();
    expect(only?.contentHash).toBeTruthy();

    // A second identical poll + upsert must NOT multiply rows (urlHash dedup
    // by canonical URL — the acceptance).
    const pollAgain = await pollPresenceTarget(activatedEnv(), target as SourceTargetRecord, {
      trackingMode: "self",
    }, { fetchImpl: substrateFetch });
    expect(pollAgain.ok).toBe(true);
    await upsertPresenceItems(activatedEnv(), {
      sourceTarget: target as SourceTargetRecord,
      items: pollAgain.items,
    });
    expect(await countLivePresenceItems(targetId)).toBe(1);

    // The mention read path: connector_id = 'reddit' persisted with the
    // post's identity.
    const row = await db()
      .prepare(
        `SELECT connector_id, external_id, canonical_url FROM presence_item
         WHERE source_target_id = ?`,
      )
      .bind(targetId)
      .first<{ connector_id: string; external_id: string; canonical_url: string }>();
    expect(row?.connector_id).toBe("reddit");
    expect(row?.external_id).toBe(POST_A_ID);
    expect(row?.canonical_url).toBe(POST_A_PERMALINK);
  });
});
