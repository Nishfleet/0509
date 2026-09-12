import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { env } from "cloudflare:workers";
import migrationSql from "../../migrations/0098_widen_source_target_connector_bluesky.sql?raw";

import { blueskyConnector, pollBlueskyMention } from "~/lib/presence-connectors/bluesky.server";
import { getPresenceConnector } from "~/lib/presence-connector-registry.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import { evaluateConnectorAccessGate, connectorOperationalForPolling } from "~/lib/presence-access-gates.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext } from "~/lib/presence-types";

import { db, ISO_T0, uid } from "./fixtures";

/**
 * Bluesky mention connector — MVP source 3/3 of the mention-monitoring epic
 * (Nishfleet/0509#3171, source ticket Nishfleet/0509#3252).
 *
 * The suite runs on real workerd against the repo's real migrations (the
 * workers project applies the chain in setup; 0098 re-runs idempotently here)
 * so both the 'bluesky' READ and WRITE path through
 * `source_target.connector_id` are asserted against the real schema.
 *
 * Both XRPC endpoints are pinned to an IP-literal fixture host
 * (https://1.1.1.1) so `resolvePublicHttpUrl` never makes a DNS hop —
 * no real network touched. The fetcher serves fixture XRPC responses:
 * `com.atproto.server.createSession` (session create) and
 * `app.bsky.feed.searchPosts`.
 *
 * The app password only ever appears inside the createSession request body —
 * never in a URL, a log, or a persisted field.
 */

const FIXTURE_HOST = "https://1.1.1.1";

const handle = "fleet.bsky.social";
const mockJwt = "eyJhbGciOiJub25lIn0.f.session-fixture.token";

function postFixture(rkey: string, handle: string, text: string) {
  return {
    uri: `at://did:plc:fixture/app.bsky.feed.post/${rkey}`,
    cid: `cid-${rkey}`,
    author: { handle, did: "did:plc:fixture" },
    record: { $type: "app.bsky.feed.post", text, createdAt: "2026-09-01T12:00:00.000Z" },
    indexedAt: "2026-09-01T12:00:01.000Z",
  };
}

function searchPostsFixture(posts: number, cursor?: string) {
  const body: Record<string, unknown> = {
    posts: Array.from({ length: posts }, (_, i) =>
      postFixture(`post${i + 1}`, handle, `Brand X makes a comeback — post ${i + 1}`),
    ),
  };
  if (cursor) body.cursor = cursor;
  return JSON.stringify(body);
}

interface FetchRoute {
  status: number;
  body: string;
}

function xrpcFetcher(routes: Record<string, FetchRoute>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? new URL(input.toString()) : new URL(input.url);
    const cursor = url.searchParams.get("cursor");
    const route = routes[url.pathname + (cursor ? `?cursor=${cursor}` : "")] ?? routes[url.pathname];
    if (!route) return new Response("not found", { status: 404 });
    return new Response(route.body, { status: route.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

function makeCtx(
  fetchImpl: typeof fetch,
  overrides: Partial<Record<string, string>> = {},
): PresenceConnectorContext {
  return {
    env: {
      PRESENCE_BLUESKY_ROLLOUT: "internal",
      PRESENCE_BSKY_PDS_URL: FIXTURE_HOST,
      PRESENCE_BSKY_APPVIEW_URL: FIXTURE_HOST,
      BSKY_IDENTIFIER: "fleet.bsky.social",
      BSKY_APP_PASSWORD: "app-password-fixture-never-real",
      ...overrides,
    } as AppEnv,
    userId: "user-bsky-1",
    trackingMode: "competitor",
    connection: null,
    fetchImpl,
  };
}

async function seedSourceTarget(connectorId: string, targetKey: string) {
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
       ) VALUES (?, ?, 'self', ?, NULL, NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, "Fixture brand", ISO_T0, ISO_T0)
    .run();
  // WRITE path against the real (re-widened) source_target CHECK.
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, is_active,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(targetId, entityId, userId, connectorId, targetKey, ISO_T0, ISO_T0)
    .run();
  // READ path: the row comes back with the 'bluesky' connector id intact.
  const row = await db()
    .prepare(`SELECT connector_id, target_key FROM source_target WHERE id = ?`)
    .bind(targetId)
    .first<{ connector_id: string; target_key: string }>();
  return { userId, entityId, targetId, row };
}

const AUTHED_SESSION = {
  "/xrpc/com.atproto.server.createSession": { status: 200, body: JSON.stringify({ accessJwt: mockJwt }) },
};

describe("bluesky mention connector — registration and docs coverage", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("bluesky");
    expect(connector).toBe(blueskyConnector);
    expect(connector.id).toBe("bluesky");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated", () => {
    const docs = presenceSourceCoverageForDocs();
    const bluesky = docs.find((entry) => entry.sourceId === "bluesky");
    expect(bluesky).toBeDefined();
    expect(bluesky?.productionStatus).toBe("gated");
  });
});

describe("bluesky mention connector — access gate", () => {
  it("is gated while PRESENCE_BLUESKY_ROLLOUT is unset", async () => {
    const gate = await evaluateConnectorAccessGate({} as AppEnv, "bluesky", "competitor");
    expect(gate.allowed).toBe(false);
    expect(gate.reasonCode).toBe("connector_disabled");
  });

  it("is gated by credentials_missing without BSKY_* credentials", async () => {
    const gate = await evaluateConnectorAccessGate(
      { PRESENCE_BLUESKY_ROLLOUT: "internal" } as AppEnv,
      "bluesky",
      "competitor",
    );
    expect(gate.allowed).toBe(false);
    expect(gate.reasonCode).toBe("credentials_missing");
  });

  it("allows polling with rollout + credentials", async () => {
    const operational = await connectorOperationalForPolling(
      { PRESENCE_BLUESKY_ROLLOUT: "internal", BSKY_IDENTIFIER: "a", BSKY_APP_PASSWORD: "b" } as AppEnv,
      "bluesky",
      "competitor",
    );
    expect(operational).toBe(true);
  });
});

describe("bluesky mention connector — validateTarget", () => {
  it("accepts a match phrase as the target key", async () => {
    const result = await blueskyConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: "Brand X makes a comeback" },
      makeCtx(xrpcFetcher(AUTHED_SESSION)),
    );
    expect(result.ok).toBe(true);
    expect(result.targetKey).toBe("Brand X makes a comeback");
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
  });

  it("rejects a missing match phrase", async () => {
    const result = await blueskyConnector.validateTarget(
      { trackingMode: "competitor", targetUrl: "  " },
      makeCtx(xrpcFetcher(AUTHED_SESSION)),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_match_phrase");
  });

  it("rejects when the connector is gated", async () => {
    const result = await blueskyConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: "phrase" },
      makeCtx(xrpcFetcher(AUTHED_SESSION), { PRESENCE_BLUESKY_ROLLOUT: undefined, BSKY_IDENTIFIER: undefined, BSKY_APP_PASSWORD: undefined }),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("connector_disabled");
  });
});

describe("bluesky mention connector — poll", () => {
  it("returns items with canonical bsky.app URLs, contentHash, publishedAt and author", async () => {
    const routes = {
      ...AUTHED_SESSION,
      "/xrpc/app.bsky.feed.searchPosts": { status: 200, body: searchPostsFixture(2) },
    };
    const fetchImpl = xrpcFetcher(routes);
    const result = await pollBlueskyMention(makeCtx(fetchImpl), "Brand X makes a comeback");

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    const first = result.items[0];
    expect(first?.canonicalUrl).toBe(`https://bsky.app/profile/${handle}/post/post1`);
    expect(first?.canonicalUrl).toMatch(/^https:\/\/bsky\.app\/profile\/.+\/post\//);
    expect(first?.contentHash).toBeTruthy();
    expect(first?.publishedAt).toBe("2026-09-01T12:00:00.000Z");
    expect(first?.author).toBe(handle);
    expect(result.costUnits).toBe(0);
  });

  it("returns ok:true with an empty item set for an empty result", async () => {
    const routes = {
      ...AUTHED_SESSION,
      "/xrpc/app.bsky.feed.searchPosts": { status: 200, body: JSON.stringify({ posts: [] }) },
    };
    const result = await pollBlueskyMention(makeCtx(xrpcFetcher(routes)), "Brand X makes a comeback");
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
  });

  it("sends every search request authenticated: the token rides the appview call, the app password never appears in a URL", async () => {
    const routes = {
      ...AUTHED_SESSION,
      "/xrpc/app.bsky.feed.searchPosts": { status: 200, body: searchPostsFixture(1) },
    };
    const fetchImpl = xrpcFetcher(routes) as unknown as Mock;
    const result = await pollBlueskyMention(makeCtx(fetchImpl), "Brand X makes a comeback");
    expect(result.ok).toBe(true);

    const urls = fetchImpl.mock.calls.map((call) => new URL(String(call[0])));
    expect(urls).toHaveLength(2);
    expect(urls.filter((u) => u.pathname.includes("searchPosts"))).toHaveLength(1);

    const searchCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes("searchPosts"));
    const headers = new Headers((searchCall?.[1] as RequestInit | undefined)?.headers);
    // The searchPosts request goes out authenticated, never anonymously.
    expect(headers.get("authorization")).toBe(`Bearer ${mockJwt}`);

    // The app password never appears in any request URL.
    for (const url of urls) {
      expect(url.toString()).not.toContain("app-password-fixture-never-real");
    }
  });

  it("fails fast with auth errors instead of an unauthenticated search when the session fails", async () => {
    const routes = {
      "/xrpc/com.atproto.server.createSession": { status: 401, body: JSON.stringify({ error: "AuthenticationRequired" }) },
    };
    const fetchImpl = xrpcFetcher(routes);
    const result = await pollBlueskyMention(makeCtx(fetchImpl), "Brand X makes a comeback");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("bluesky_auth_failed");
    expect(result.items).toEqual([]);
    // No searchPosts request was even attempted without a session.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports credentials_missing when BSKY_* is unset — no unauthenticated search", async () => {
    const fetchImpl = xrpcFetcher({});
    const result = await pollBlueskyMention(
      makeCtx(fetchImpl, { BSKY_IDENTIFIER: undefined, BSKY_APP_PASSWORD: undefined }),
      "Brand X makes a comeback",
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("credentials_missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("paginates with the cursor and keeps pagination bounded", async () => {
    const routes = {
      ...AUTHED_SESSION,
      "/xrpc/app.bsky.feed.searchPosts": { status: 200, body: searchPostsFixture(3, "cursor-1") },
      "/xrpc/app.bsky.feed.searchPosts?cursor=cursor-1": { status: 200, body: searchPostsFixture(2) },
    };
    const result = await pollBlueskyMention(makeCtx(xrpcFetcher(routes)), "Brand X makes a comeback");
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(5);
    expect((result.cursor as { cursor?: string } | undefined)?.cursor).toBeUndefined();
  });

  it("is gated at poll when the rollout is off", async () => {
    const result = await pollBlueskyMention(makeCtx(xrpcFetcher(AUTHED_SESSION), { PRESENCE_BLUESKY_ROLLOUT: undefined }), "phrase");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("connector_disabled");
  });
});

describe("bluesky mention connector — healthCheck", () => {
  it("reports gated while the rollout env is unset", async () => {
    const result = await blueskyConnector.healthCheck(makeCtx(xrpcFetcher(AUTHED_SESSION), {
      BSKY_IDENTIFIER: undefined,
      BSKY_APP_PASSWORD: undefined,
      PRESENCE_BLUESKY_ROLLOUT: undefined,
    }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("reports healthy when searchPosts answers", async () => {
    const routes = {
      ...AUTHED_SESSION,
      "/xrpc/app.bsky.feed.searchPosts": { status: 200, body: searchPostsFixture(1) },
    };
    const result = await blueskyConnector.healthCheck(
      makeCtx(xrpcFetcher(routes), { PRESENCE_BLUESKY_ROLLOUT: "internal" }),
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
  });

  it("reports degraded when searchPosts does not answer", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("unreachable");
    }) as unknown as typeof fetch;
    const result = await blueskyConnector.healthCheck(
      makeCtx(fetchImpl, { PRESENCE_BLUESKY_ROLLOUT: "internal" }),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("degraded");
  });
});

describe("bluesky mention connector — migration 0098 and the real substrate", () => {
  const statements = migrationSql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  it("applies cleanly, accepts 'bluesky' on source_target.connector_id, and preserves data", async () => {
    const d1 = env.DB;
    const id = Math.floor(Math.random() * 1e9).toString();
    const user = `ubsky_${id}`;
    const entity = `tebsky_${id}`;
    const target = `stbsky_${id}`;
    const item = `pibsky_${id}`;
    await d1.batch([
      d1.prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'U', ?, 1, 'c', 'u')`,
      ).bind(user, `${user}@example.test`),
      d1.prepare(
        `INSERT INTO tracked_entity (id, user_id, tracking_mode, label, is_active, created_at, updated_at) VALUES (?, ?, 'competitor', 'Bluesky fixture', 1, 'c', 'u')`,
      ).bind(entity, user),
      d1.prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'website', 'k', 1, 'c', 'u')`,
      ).bind(target, entity, user),
      d1.prepare(
        `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, canonical_url, url_hash, title, content_hash, revision, observed_at, created_at) VALUES (?, ?, ?, ?, 'website', 'https://x.test', 'h', 't', 'ch', 1, 'o', 'c')`,
      ).bind(item, target, entity, user),
    ]);
    expect(await count(d1, "source_target", `WHERE id = '${target}'`)).toBe(1);
    expect(await count(d1, "presence_item", `WHERE id = '${item}'`)).toBe(1);

    // apply the real migration statements (idempotent with the setup chain)
    await d1.batch(statements.map((sql) => d1.prepare(sql)));

    // WRITE path: 'bluesky' is accepted by the real CHECK after the widen.
    await d1.prepare(
      `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'bluesky', 'phrase', 1, 'c', 'u')`,
    ).bind(`stw_${id}`, entity, user).run();
    // READ path: rows (including pre-rebuild data and child rows) survive.
    expect(await count(d1, "source_target", `WHERE id = '${target}' AND connector_id = 'website'`)).toBe(1);
    expect(await count(d1, "source_target", `WHERE connector_id = 'bluesky' AND target_key = 'phrase'`)).toBe(1);
    expect(await count(d1, "presence_item", `WHERE id = '${item}'`)).toBe(1);

    // WRITE + READ through the connector itself, on the real substrate.
    const { row } = await seedSourceTarget("bluesky", "Brand X makes a comeback");
    expect(row?.connector_id).toBe("bluesky");
    expect(row?.target_key).toBe("Brand X makes a comeback");
  });
});

async function count(d1: typeof env.DB, table: string, where = "") {
  const row = await d1.prepare(`SELECT count(*) AS c FROM ${table} ${where}`).first<{ c: number }>();
  return row?.c ?? 0;
}
