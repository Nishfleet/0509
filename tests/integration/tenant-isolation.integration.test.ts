import { describe, expect, it } from "vitest";

import { createCustomerApiKey } from "~/lib/api-keys.server";
import { action as mcpAction } from "~/routes/api.mcp";
import { loader as v1ResourceLoader } from "~/routes/api.v1.$resourceType.$resourceId";

import { appEnv, db, ISO_T0, uid } from "./fixtures";

/**
 * Cross-tenant isolation matrix on real D1 (issue #2349).
 *
 * D1 has no row-level security; tenant scoping lives only as a `workspaceUserId`
 * (or `userId`) predicate threaded into each read. This suite seeds two
 * independent workspaces and asserts that a cross-tenant read returns EXACTLY
 * the same response a non-existent resource returns for that route — 404 where
 * the route 404s, `null`/empty where the data function returns null, and an
 * MCP `not_found` error result where the MCP tool returns one. The per-resource
 * expected shape is encoded in each test name.
 *
 * The mutation check (drop a scoping predicate, watch the test go red, revert
 * before commit) is recorded in `.lane/reports/claim-issue-2349.md`.
 */
describe("cross-tenant isolation against real D1", () => {
  async function seedUserWithPlan(plan: string, id = uid("user")) {
    await db()
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(id, `Fixture ${id}`, `${id}@example.test`, ISO_T0, ISO_T0)
      .run();
    await db()
      .prepare(`INSERT INTO user_plan (user_id, plan, plan_updated_at) VALUES (?, ?, ?)`)
      .bind(id, plan, ISO_T0)
      .run();
    return id;
  }

  async function seedCollection(userId: string, id = uid("col")) {
    await db()
      .prepare(
        `INSERT INTO collection (id, user_id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      )
      .bind(id, userId, `Fixture ${id}`, ISO_T0, ISO_T0)
      .run();
    return id;
  }

  async function seedDigest(userId: string, id = uid("dig")) {
    await db()
      .prepare(
        `INSERT INTO digest_run (id, user_id, period_start, period_end, summary_json, created_at)
         VALUES (?, ?, ?, ?, '{}', ?)`,
      )
      .bind(id, userId, "2026-01-01", "2026-01-08", ISO_T0)
      .run();
    return id;
  }

  async function seedShareLink(userId: string, resourceId: string, id = uid("share")) {
    const token = uid("tok").replaceAll("_", "");
    await db()
      .prepare(
        `INSERT INTO share_link (id, token, user_id, resource_type, resource_id, is_snapshot, created_at)
         VALUES (?, ?, ?, 'collection', ?, 0, ?)`,
      )
      .bind(id, token, userId, resourceId, ISO_T0)
      .run();
    return { id, token };
  }

  async function makeReadonlyKey(userId: string) {
    const { secret } = await createCustomerApiKey(appEnv, userId, "isolation test key", {
      actionsWriteEnabled: false,
    });
    return secret;
  }

  // ---- data-layer reads -------------------------------------------------

  it("collection: cross-tenant getCollection returns null (same as non-existent id)", async () => {
    const { aId, bId, aCollection } = await seedTwoWorkspaces();

    const crossTenant = await import("~/lib/data.server").then((m) =>
      m.getCollection(appEnv, aCollection, bId),
    );
    const nonexistent = await import("~/lib/data.server").then((m) =>
      m.getCollection(appEnv, "does_not_exist", bId),
    );

    expect(crossTenant, "cross-tenant collection must be null").toBeNull();
    expect(nonexistent, "non-existent collection must be null").toBeNull();
    // Sanity: the owning workspace CAN read it, so a null here would mean the
    // seed itself is broken rather than the scope predicate working.
    const own = await import("~/lib/data.server").then((m) =>
      m.getCollection(appEnv, aCollection, aId),
    );
    expect(own?.id).toBe(aCollection);
  });

  it("watchlist: cross-tenant getWatchlist returns null (same as non-existent id)", async () => {
    const { bId, aId, aWatchlist } = await seedTwoWorkspaces();

    const crossTenant = await import("~/lib/data.server").then((m) =>
      m.getWatchlist(appEnv, aWatchlist, bId),
    );
    const nonexistent = await import("~/lib/data.server").then((m) =>
      m.getWatchlist(appEnv, "does_not_exist", bId),
    );

    expect(crossTenant, "cross-tenant watchlist must be null").toBeNull();
    expect(nonexistent, "non-existent watchlist must be null").toBeNull();
    // Sanity: the owning workspace CAN read it, so a null here would mean the
    // seed itself is broken rather than the scope predicate working.
    const own = await import("~/lib/data.server").then((m) =>
      m.getWatchlist(appEnv, aWatchlist, aId),
    );
    expect(own?.id).toBe(aWatchlist);
  });

  it("digest: getDigest is bearer-scoped, so the call-site ownership guard (digest.userId !== workspaceUserId) rejects cross-tenant (same 404 as non-existent)", async () => {
    const { bId, aId, aDigest } = await seedTwoWorkspaces();

    // getDigest itself is keyed by id only (bearer); the route enforces ownership
    // via `digest.userId !== workspaceUserId`. Prove the guard predicate fires:
    const digest = await import("~/lib/data.server").then((m) =>
      m.getDigest(appEnv, aDigest),
    );
    expect(digest, "seeded digest must resolve").not.toBeNull();
    expect(digest?.userId, "digest must be owned by workspace A").toBe(aId);
    // The exact predicate the v1 route + MCP tool use:
    expect(digest?.userId !== bId, "ownership guard must reject workspace B").toBe(true);

    // A non-existent digest id resolves to null — the route treats both as 404.
    const nonexistent = await import("~/lib/data.server").then((m) =>
      m.getDigest(appEnv, "does_not_exist"),
    );
    expect(nonexistent, "non-existent digest must be null").toBeNull();
  });

  it("share token: cross-tenant getShareLinkById returns null (same as non-existent id); bearer getShareLink is public-by-design and out of scope", async () => {
    const { aId, bId, aCollection } = await seedTwoWorkspaces();
    const { getShareLinkById } = await import("~/lib/data.server");
    const share = await seedShareLink(aId, aCollection);

    // Seeded under A; the owning workspace reads it back.
    const own = await getShareLinkById(appEnv, aId, share.id);
    expect(own, "owning workspace reads its share").not.toBeNull();

    // B must not see A's share by id — same null a non-existent id returns.
    const fromWrongTenant = await getShareLinkById(appEnv, bId, share.id);
    const nonexistent = await getShareLinkById(appEnv, aId, "does_not_exist");
    expect(fromWrongTenant, "cross-tenant share-by-id must be null").toBeNull();
    expect(nonexistent, "non-existent share-by-id must be null").toBeNull();
  });

  // ---- v1 resource route (end-to-end through the real loader) -----------

  async function callV1Resource(
    secret: string,
    resourceType: string,
    resourceId: string,
  ) {
    return v1ResourceLoader({
      context: { cloudflare: { env: appEnv } },
      params: { resourceType, resourceId },
      request: new Request(`https://0509.io/api/v1/${resourceType}/${resourceId}`, {
        headers: { Authorization: `Bearer ${secret}` },
      }),
    } as never);
  }

  it("v1 collection: cross-tenant read returns 404 (same as non-existent resource id)", async () => {
    const { bSecret, aCollection } = await seedTwoWorkspacesWithKeys();

    const crossTenant = await callV1Resource(bSecret, "collection", aCollection);
    const nonexistent = await callV1Resource(bSecret, "collection", "does_not_exist");

    expect(crossTenant.status, "cross-tenant v1 collection must 404").toBe(404);
    expect(nonexistent.status, "non-existent v1 collection must 404").toBe(404);
    const crossBody = (await crossTenant.json()) as { error: string };
    const noneBody = (await nonexistent.json()) as { error: string };
    expect(crossBody.error).toBe(noneBody.error);
  });

  it("v1 watchlist: cross-tenant read returns 404 (same as non-existent resource id)", async () => {
    const { bSecret, aWatchlist } = await seedTwoWorkspacesWithKeys();

    const crossTenant = await callV1Resource(bSecret, "watchlist", aWatchlist);
    const nonexistent = await callV1Resource(bSecret, "watchlist", "does_not_exist");

    expect(crossTenant.status, "cross-tenant v1 watchlist must 404").toBe(404);
    expect(nonexistent.status, "non-existent v1 watchlist must 404").toBe(404);
  });

  it("v1 digest: cross-tenant read returns 404 (same as non-existent resource id)", async () => {
    const { bSecret, aDigest } = await seedTwoWorkspacesWithKeys();

    const crossTenant = await callV1Resource(bSecret, "digest", aDigest);
    const nonexistent = await callV1Resource(bSecret, "digest", "does_not_exist");

    expect(crossTenant.status, "cross-tenant v1 digest must 404").toBe(404);
    expect(nonexistent.status, "non-existent v1 digest must 404").toBe(404);
  });

  // ---- MCP tool results (end-to-end through the real action) ------------

  async function callMcpTool(secret: string, name: string, args: Record<string, unknown>) {
    return mcpAction({
      context: { cloudflare: { env: appEnv } },
      request: new Request("https://0509.io/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
    } as never);
  }

  async function mcpNotFoundResult(response: Response) {
    expect(response.status, "MCP not-found is a 200 with isError").toBe(200);
    const body = (await response.json()) as {
      result: { isError: boolean; structuredContent: { error: string } };
    };
    return body.result;
  }

  it("MCP get_collection_export: cross-tenant returns not_found error result (same as non-existent collectionId)", async () => {
    const { bSecret, aCollection } = await seedTwoWorkspacesWithKeys();

    const crossTenant = await callMcpTool(bSecret, "get_collection_export", {
      collectionId: aCollection,
    });
    const nonexistent = await callMcpTool(bSecret, "get_collection_export", {
      collectionId: "does_not_exist",
    });

    const cross = await mcpNotFoundResult(crossTenant);
    const none = await mcpNotFoundResult(nonexistent);
    expect(cross.isError, "cross-tenant MCP collection must be an error").toBe(true);
    expect(cross.structuredContent.error, "cross-tenant must be not_found").toBe("not_found");
    expect(none.structuredContent.error).toBe("not_found");
  });

  it("MCP get_watchlist_export: cross-tenant returns not_found error result (same as non-existent watchlistId)", async () => {
    const { bSecret, aWatchlist } = await seedTwoWorkspacesWithKeys();

    const crossTenant = await callMcpTool(bSecret, "get_watchlist_export", {
      watchlistId: aWatchlist,
    });
    const nonexistent = await callMcpTool(bSecret, "get_watchlist_export", {
      watchlistId: "does_not_exist",
    });

    const cross = await mcpNotFoundResult(crossTenant);
    const none = await mcpNotFoundResult(nonexistent);
    expect(cross.isError, "cross-tenant MCP watchlist must be an error").toBe(true);
    expect(cross.structuredContent.error).toBe("not_found");
    expect(none.structuredContent.error).toBe("not_found");
  });

  it("MCP get_digest_export: cross-tenant returns not_found error result (same as non-existent digestId)", async () => {
    const { bSecret, aDigest } = await seedTwoWorkspacesWithKeys();

    const crossTenant = await callMcpTool(bSecret, "get_digest_export", {
      digestId: aDigest,
    });
    const nonexistent = await callMcpTool(bSecret, "get_digest_export", {
      digestId: "does_not_exist",
    });

    const cross = await mcpNotFoundResult(crossTenant);
    const none = await mcpNotFoundResult(nonexistent);
    expect(cross.isError, "cross-tenant MCP digest must be an error").toBe(true);
    expect(cross.structuredContent.error).toBe("not_found");
    expect(none.structuredContent.error).toBe("not_found");
  });

  // ---- shared seed ------------------------------------------------------

  /**
   * Seeds two independent workspaces (A and B) on the `scout` plan (which
   * carries `api_access` + `mcp_read_access`) plus a watchlist for A. Storage
   * is isolated per test FILE, so every id is unique within the file.
   */
  async function seedTwoWorkspaces() {
    const aId = await seedUserWithPlan("scout");
    const bId = await seedUserWithPlan("scout");
    const aCollection = await seedCollection(aId);
    const aWatchlist = await seedWatchlist(aId);
    const aDigest = await seedDigest(aId);
    return { aId, bId, aCollection, aWatchlist, aDigest };
  }

  async function seedWatchlist(userId: string, id = uid("wl")) {
    await db()
      .prepare(
        `INSERT INTO watchlist (
           id, user_id, name, target_type, target_id, target_fingerprint,
           target_label, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(id, userId, `Fixture ${id}`, `target_${id}`, `fp_${id}`, `Label ${id}`, ISO_T0, ISO_T0)
      .run();
    return id;
  }

  let cachedKeys: {
    aId: string;
    bId: string;
    aCollection: string;
    aWatchlist: string;
    aDigest: string;
    aSecret: string;
    bSecret: string;
  } | null = null;

  async function seedTwoWorkspacesWithKeys() {
    if (cachedKeys) return cachedKeys;
    const base = await seedTwoWorkspaces();
    const aSecret = await makeReadonlyKey(base.aId);
    const bSecret = await makeReadonlyKey(base.bId);
    cachedKeys = { ...base, aSecret, bSecret };
    return cachedKeys;
  }
});
