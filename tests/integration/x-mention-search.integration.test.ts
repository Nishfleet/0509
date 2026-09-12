import { describe, expect, it, vi } from "vitest";

import {
  X_PAID_PENDING_REASON_CODE,
  xConnector,
} from "~/lib/presence-connectors/x.server";
import {
  getPresenceConnector,
  pollPresenceTarget,
} from "~/lib/presence-connector-registry.server";
import {
  getPollCursor,
  listPresenceItems,
  listSourceTargetsForEntity,
  upsertPollCursor,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import {
  evaluatePresenceSourceCoverage,
  presenceSourceCoverageForDocs,
} from "~/lib/presence-source-coverage.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  PresenceConnectorContext,
  SourceTargetRecord,
} from "~/lib/presence-types";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * X mention search — issue #3255 (parked under the MONEY flag).
 *
 * The `x` presence connector activates for mention search: a tracked entity's
 * match phrase becomes a query-type `source_target`
 * (`metadata_json.targetType === "query"`), `poll` issues a
 * `GET /2/tweets/search/recent` call, and posts land as `presence_item` rows.
 * The suite runs on real workerd against the repo's real migrations — the
 * `source_target.connector_id` CHECK already allows 'x' (migration 0055), so
 * no schema change is needed.
 *
 * The network is hermetic: `X_API_BASE_URL` points at the IP literal
 * `1.1.1.1`, so `resolvePublicHttpUrl` inside `presenceSafeFetch` returns
 * without a DNS hop, and a mock `fetchImpl` serves the search payload — while
 * still proving the request went through the SSRF-hardened fetch path with
 * the bearer token injected.
 *
 * MONEY flag: `X_PAID_ACCESS=approved` is the spend-decision clearance. Until
 * it is set, poll/healthCheck/coverage all report `paid_source_pending_nish`
 * and no paid request is ever issued — asserted below by checking the mock
 * fetch was never called.
 */

const X_TEST_BASE_URL = "https://1.1.1.1";

const SEARCH_PAYLOAD = {
  data: [
    {
      id: "1900000000000000001",
      text: "Trying the MamaEarth vitamin C serum this week — glow is real",
      created_at: "2026-09-12T08:00:00.000Z",
      author_id: "u_1",
      lang: "en",
    },
    {
      id: "1900000000000000002",
      text: "MamaEarth vs Dot & Key — an honest review",
      created_at: "2026-09-12T09:30:00.000Z",
      author_id: "u_2",
      lang: "en",
    },
  ],
  includes: {
    users: [
      { id: "u_1", username: "skinfan", name: "Skin Fan" },
      { id: "u_2", username: "reviewrani", name: "Review Rani" },
    ],
  },
  meta: {
    newest_id: "1900000000000000002",
    oldest_id: "1900000000000000001",
    result_count: 2,
  },
};

const EMPTY_SEARCH_PAYLOAD = { meta: { result_count: 0 } };

/** Fully cleared env: rollout + bearer token + spend approval + test base URL. */
function activatedEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    ...appEnv,
    PRESENCE_X_ROLLOUT: "internal",
    X_API_BEARER_TOKEN: "x-test-token",
    X_PAID_ACCESS: "approved",
    X_API_BASE_URL: X_TEST_BASE_URL,
    ...overrides,
  };
}

function ctxFor(env: AppEnv, fetchImpl?: typeof fetch): PresenceConnectorContext {
  return {
    env,
    userId: "user-x-1",
    trackingMode: "competitor",
    connection: null,
    fetchImpl,
  };
}

interface FetchCall {
  url: string;
  headers: Headers;
}

/** Mock fetch that captures every request it receives. */
function searchFetcher(payload: unknown, status = 200) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string | URL, init?: { headers?: unknown }) => {
    calls.push({
      url: url.toString(),
      headers: new Headers((init?.headers as HeadersInit) ?? {}),
    });
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** Seeds user + tracked_entity + a query-type x source_target, refetched via the data layer. */
async function seedXQueryTarget(
  matchPhrase: string,
  canonicalUrl: string | null = null,
): Promise<{
  userId: string;
  entityId: string;
  target: SourceTargetRecord;
}> {
  const userId = await seedUser();
  const entityId = uid("entity");
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'competitor', ?, ?, NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, matchPhrase, canonicalUrl, ISO_T0, ISO_T0)
    .run();

  const targetId = uid("stgt");
  const metadata: Record<string, unknown> = { targetType: "query", matchPhrase };
  if (canonicalUrl) {
    metadata.canonicalUrl = canonicalUrl;
  }
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key,
         metadata_json, coverage_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'x', ?, ?, 'OFFICIAL_PUBLIC_API', 1, ?, ?)`,
    )
    .bind(
      targetId,
      entityId,
      userId,
      matchPhrase.toLowerCase(),
      JSON.stringify(metadata),
      ISO_T0,
      ISO_T0,
    )
    .run();

  const rows = await listSourceTargetsForEntity(activatedEnv(), userId, entityId);
  const target = rows.find((row) => row.id === targetId);
  if (!target) {
    throw new Error("expected the seeded x query-type source_target row");
  }
  return { userId, entityId, target };
}

describe("x mention search — registration", () => {
  it("registers x in the presence connector registry", () => {
    const connector = getPresenceConnector("x");
    expect(connector).toBe(xConnector);
    expect(connector.id).toBe("x");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });
});

describe("x mention search — validateTarget", () => {
  it("accepts a query-type target carrying the entity match phrase", async () => {
    const result = await xConnector.validateTarget(
      {
        trackingMode: "competitor",
        metadata: { targetType: "query", matchPhrase: "MamaEarth" },
      },
      ctxFor(activatedEnv()),
    );
    expect(result.ok).toBe(true);
    expect(result.targetKey).toBe("mamaearth");
    expect(result.metadata).toMatchObject({ targetType: "query", matchPhrase: "MamaEarth" });
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
  });

  it("rejects a query target with no match phrase", async () => {
    const result = await xConnector.validateTarget(
      { trackingMode: "competitor", metadata: { targetType: "query" } },
      ctxFor(activatedEnv()),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_match_phrase");
  });

  it("still accepts handle targets", async () => {
    const result = await xConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: "@MamaEarth" },
      ctxFor(activatedEnv()),
    );
    expect(result.ok).toBe(true);
    expect(result.targetKey).toBe("mamaearth");
    expect(result.targetHandle).toBe("mamaearth");
  });

  it("refuses new targets while the spend flag is unset", async () => {
    const result = await xConnector.validateTarget(
      {
        trackingMode: "competitor",
        metadata: { targetType: "query", matchPhrase: "MamaEarth" },
      },
      ctxFor(activatedEnv({ X_PAID_ACCESS: undefined })),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(X_PAID_PENDING_REASON_CODE);
  });
});

describe("x mention search — poll on the real D1", () => {
  it("issues a recent-search call with the match phrase and lands presence_item rows", async () => {
    const { userId, entityId, target } = await seedXQueryTarget("MamaEarth", "https://mamaearth.in");
    const { fn, calls } = searchFetcher(SEARCH_PAYLOAD);

    const poll = await pollPresenceTarget(
      activatedEnv(),
      target,
      { trackingMode: "competitor" },
      { fetchImpl: fn },
    );

    expect(poll.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const requestUrl = new URL(calls[0]!.url);
    expect(requestUrl.origin).toBe(X_TEST_BASE_URL);
    expect(requestUrl.pathname).toBe("/2/tweets/search/recent");
    // The entity's match phrase rides the canonical buildMentionQuery builder:
    // quoted label OR quoted canonical domain, retweets excluded.
    const sentQuery = requestUrl.searchParams.get("query") ?? "";
    expect(sentQuery).toContain('"MamaEarth"');
    expect(sentQuery).toContain('"mamaearth.in"');
    expect(sentQuery).toContain("-is:retweet");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer x-test-token");

    expect(poll.items).toHaveLength(2);
    const first = poll.items[0]!;
    expect(first.canonicalUrl).toBe("https://x.com/skinfan/status/1900000000000000001");
    expect(first.author).toBe("@skinfan");
    expect(first.publishedAt).toBe("2026-09-12T08:00:00.000Z");
    expect(first.contentHash).toBeTruthy();
    expect(first.externalId).toBe("1900000000000000001");

    // Items land as real presence_item rows through the real upsert path.
    const upsert = await upsertPresenceItems(activatedEnv(), {
      sourceTarget: target,
      items: poll.items,
    });
    expect(upsert.inserted).toBe(2);

    const items = await listPresenceItems(activatedEnv(), userId, {
      trackedEntityId: entityId,
      connectorId: "x",
    });
    const ours = items.filter((item) => item.sourceTargetId === target.id);
    expect(ours).toHaveLength(2);
    expect(ours.map((item) => item.canonicalUrl).sort()).toEqual([
      "https://x.com/reviewrani/status/1900000000000000002",
      "https://x.com/skinfan/status/1900000000000000001",
    ]);
    expect(ours.every((item) => item.contentHash && item.author?.startsWith("@"))).toBe(true);
  });

  it("returns ok:true with an empty item set when the search finds nothing", async () => {
    const { target } = await seedXQueryTarget("MamaEarth");
    const { fn } = searchFetcher(EMPTY_SEARCH_PAYLOAD);

    const poll = await pollPresenceTarget(
      activatedEnv(),
      target,
      { trackingMode: "competitor" },
      { fetchImpl: fn },
    );

    expect(poll.ok).toBe(true);
    expect(poll.items).toEqual([]);
    expect(poll.costUnits).toBe(0);
  });

  it("records metered reads per day in presence_poll_cursor.cursor_json", async () => {
    const { target } = await seedXQueryTarget("MamaEarth");
    const env = activatedEnv();
    const { fn, calls } = searchFetcher(SEARCH_PAYLOAD);

    const poll = await pollPresenceTarget(env, target, { trackingMode: "competitor" }, { fetchImpl: fn });
    expect(poll.ok).toBe(true);

    // Persist the connector cursor exactly the way pollPresenceSourceTarget
    // does — the connector's cursor object rides cursor_json.
    const now = new Date().toISOString();
    await upsertPollCursor(env, target.id, {
      cursor: { ...(poll.cursor ?? {}), syncCycleCount: 1 },
      lastPolledAt: now,
      lastSuccessAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    const stored = await getPollCursor(env, target.id);
    expect(stored).not.toBeNull();
    const today = now.slice(0, 10);
    const meteredReads = stored?.cursor.meteredReads as
      | Record<string, { requests: number; posts: number }>
      | undefined;
    expect(meteredReads?.[today]?.requests).toBe(1);
    expect(meteredReads?.[today]?.posts).toBe(2);
    expect(stored?.cursor.sinceId).toBe("1900000000000000002");

    // A second poll accumulates the same day and pages forward via since_id.
    const second = await pollPresenceTarget(
      env,
      target,
      { trackingMode: "competitor" },
      { fetchImpl: fn, cursor: { record: stored?.cursor ?? {} } },
    );
    expect(second.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]!.url).searchParams.get("since_id")).toBe("1900000000000000002");

    const secondReads = second.cursor?.meteredReads as Record<
      string,
      { requests: number; posts: number }
    >;
    expect(secondReads[today]?.requests).toBe(2);
    expect(secondReads[today]?.posts).toBe(4);
  });

  it("never issues a paid call while the spend flag is unset", async () => {
    const { target } = await seedXQueryTarget("MamaEarth");
    const { fn, calls } = searchFetcher(SEARCH_PAYLOAD);

    const poll = await pollPresenceTarget(
      activatedEnv({ X_PAID_ACCESS: undefined }),
      target,
      { trackingMode: "competitor" },
      { fetchImpl: fn },
    );

    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe(X_PAID_PENDING_REASON_CODE);
    expect(calls).toHaveLength(0);
  });

  it("stays inert when the rollout flag is off — no paid call", async () => {
    const { target } = await seedXQueryTarget("MamaEarth");
    const { fn, calls } = searchFetcher(SEARCH_PAYLOAD);

    const poll = await pollPresenceTarget(
      activatedEnv({ PRESENCE_X_ROLLOUT: "disabled" }),
      target,
      { trackingMode: "competitor" },
      { fetchImpl: fn },
    );

    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("connector_not_operational");
    expect(calls).toHaveLength(0);
  });
});

describe("x mention search — healthCheck and coverage honesty", () => {
  it("reports gated while PRESENCE_X_ROLLOUT is unset", async () => {
    const result = await xConnector.healthCheck(
      ctxFor({ ...appEnv, X_API_BEARER_TOKEN: "t", X_PAID_ACCESS: "approved" }),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("reports gated while X_API_BEARER_TOKEN is missing", async () => {
    const result = await xConnector.healthCheck(
      ctxFor({ ...appEnv, PRESENCE_X_ROLLOUT: "internal", X_PAID_ACCESS: "approved" }),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("credentials_missing");
  });

  it("reports paid_source_pending_nish until the spend flag is cleared", async () => {
    const result = await xConnector.healthCheck(
      ctxFor(activatedEnv({ X_PAID_ACCESS: undefined })),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe(X_PAID_PENDING_REASON_CODE);
  });

  it("reports healthy once rollout + token + spend approval are all set", async () => {
    const result = await xConnector.healthCheck(ctxFor(activatedEnv()));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
  });

  it("coverage reports the paid/pending state until the spend flag is cleared", async () => {
    const pending = await evaluatePresenceSourceCoverage(
      activatedEnv({ X_PAID_ACCESS: undefined }),
      "x",
      "competitor",
    );
    expect(pending.status).toBe("gated");
    expect(pending.reasonCode).toBe(X_PAID_PENDING_REASON_CODE);
    expect(pending.coverageLabel).toBe("UNAVAILABLE");

    const approved = await evaluatePresenceSourceCoverage(activatedEnv(), "x", "competitor");
    expect(approved.status).toBe("available");
    expect(approved.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
  });

  it("docs coverage keeps X labelled gated with the paid-reads note", () => {
    const docs = presenceSourceCoverageForDocs();
    const x = docs.find((entry) => entry.sourceId === "x");
    expect(x?.productionStatus).toBe("gated");
    expect(x?.notes).toContain("paid");
  });
});
