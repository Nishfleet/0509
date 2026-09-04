import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import { createCustomerApiKey } from "~/lib/api-keys.server";
import { action as mcpAction } from "~/routes/api.mcp";
import { action as v1ActionsAction } from "~/routes/api.v1.actions";
import { loader as v1ResourceLoader } from "~/routes/api.v1.$resourceType.$resourceId";

import {
  ISO_T0,
  seedRun,
  seedUser,
  seedWatchlist,
  uid,
} from "./fixtures";

/**
 * BET 6 (issue #1275) tier-gating against real local D1 (not mocked): the
 * read-only MCP/API surface must be callable with a Free or Scout customer
 * API key, while write tools and CSV exports stay gated. Mocked bindings
 * cannot see the plan-feature gates or the key rows, so this file applies
 * the repo's real migrations and drives the real route handlers.
 */

const MCP_ENDPOINT = "https://0509.io/api/mcp";

async function seedUserWithPlan(plan: "free" | "scout" | "agency") {
  const userId = await seedUser();
  await env.DB.prepare(
    "INSERT INTO user_plan (user_id, plan, plan_updated_at) VALUES (?, ?, ?)",
  )
    .bind(userId, plan, ISO_T0)
    .run();
  return userId;
}

async function createKeyFor(userId: string, name: string, actionsWriteEnabled: boolean) {
  const { secret } = await createCustomerApiKey(
    { DB: env.DB },
    userId,
    name,
    { actionsWriteEnabled },
  );
  return secret;
}

function runtimeContext() {
  return {
    cloudflare: {
      env: { DB: env.DB },
      ctx: { waitUntil: () => Promise.resolve() },
    },
  };
}

async function postMcp(secret: string, body: Record<string, unknown>) {
  return mcpAction({
    context: runtimeContext(),
    request: new Request(MCP_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  } as never);
}

async function getV1Resource(
  secret: string,
  resourceType: string,
  resourceId: string,
  format: string,
) {
  return v1ResourceLoader({
    context: runtimeContext(),
    params: { resourceType, resourceId },
    request: new Request(
      `https://0509.io/api/v1/${resourceType}/${resourceId}?format=${format}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    ),
  } as never);
}

async function postV1Action(secret: string, body: Record<string, unknown>) {
  return v1ActionsAction({
    context: runtimeContext(),
    request: new Request("https://0509.io/api/v1/actions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  } as never);
}

function rpcId(counter: { n: number }) {
  counter.n += 1;
  return counter.n;
}

function readToolInputs(watchlistId: string): Array<{ name: string; arguments?: Record<string, unknown> }> {
  return [
    { name: "get_workspace_readiness" },
    { name: "list_memory", arguments: { scope: "workspace" } },
    { name: "list_client_rooms" },
    { name: "list_support_cases" },
    { name: "list_web_mentions" },
    { name: "watchlist_runs.list", arguments: { watchlistId } },
  ];
}

describe("BET 6 MCP / API tier gating against real D1", () => {
  it("lets a Free read-only key call every read-only MCP tool and hides write tools", async () => {
    const userId = await seedUserWithPlan("free");
    const collectionId = uid("col");
    const watchlistId = await seedWatchlist(userId);
    await seedRun(watchlistId);
    await env.DB.prepare(
      `INSERT INTO collection (id, user_id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(collectionId, userId, "Free evidence", null, ISO_T0, ISO_T0)
      .run();

    const secret = await createKeyFor(userId, "Free agent read", false);
    const counter = { n: 0 };
    const readTools = readToolInputs(watchlistId);
    const listed = await postMcp(secret, {
      jsonrpc: "2.0",
      id: rpcId(counter),
      method: "tools/list",
      params: {},
    });
    const listedBody = await listed.json() as {
      result: { tools: Array<{ name: string; requiresWriteEnabled: boolean }> };
    };
    const advertised = listedBody.result.tools.map((tool) => tool.name);
    expect(advertised).toEqual([
      "get_workspace_readiness",
      "get_collection_export",
      "get_watchlist_export",
      "watchlist_runs.list",
      "get_digest_export",
      "list_memory",
      "list_client_rooms",
      "list_support_cases",
      "list_web_mentions",
    ]);
    expect(listedBody.result.tools.every((tool) => !tool.requiresWriteEnabled)).toBe(true);

    for (const input of readTools) {
      const response = await postMcp(secret, {
        jsonrpc: "2.0",
        id: rpcId(counter),
        method: "tools/call",
        params: input,
      });
      const body = await response.json() as {
        result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
        error?: { code: number; message: string };
      };
      expect(response.status, `${input.name}: ${JSON.stringify(body)}`).toBe(200);
      expect(body.result, `${input.name} returned a JSON-RPC error: ${JSON.stringify(body.error)}`).toBeDefined();
      expect(body.result?.isError, `${input.name} failed: ${JSON.stringify(body.result)}`).toBe(false);
    }

    const watchlistExport = await postMcp(secret, {
      jsonrpc: "2.0",
      id: rpcId(counter),
      method: "tools/call",
      params: {
        name: "get_watchlist_export",
        arguments: { watchlistId },
      },
    });
    const watchlistBody = await watchlistExport.json() as {
      result: { isError: boolean; structuredContent: { resourceType: string; watchlist: { name: string } } };
    };
    expect(watchlistExport.status).toBe(200);
    expect(watchlistBody.result.isError).toBe(false);
    expect(watchlistBody.result.structuredContent.resourceType).toBe("watchlist");
    expect(watchlistBody.result.structuredContent.watchlist.name).toMatch(/^Fixture /);

    const collectionExport = await postMcp(secret, {
      jsonrpc: "2.0",
      id: rpcId(counter),
      method: "tools/call",
      params: {
        name: "get_collection_export",
        arguments: { collectionId },
      },
    });
    const collectionBody = await collectionExport.json() as {
      result: { isError: boolean; structuredContent: { resourceType: string; collection: { name: string } } };
    };
    expect(collectionExport.status).toBe(200);
    expect(collectionBody.result.isError).toBe(false);
    expect(collectionBody.result.structuredContent.resourceType).toBe("collection");
    expect(collectionBody.result.structuredContent.collection.name).toBe("Free evidence");

    // Digest with no seeded row: the free key still reaches the tool (gate
    // passed) and gets a clean account-scoped not_found inside the 200.
    const digestCall = await postMcp(secret, {
      jsonrpc: "2.0",
      id: rpcId(counter),
      method: "tools/call",
      params: {
        name: "get_digest_export",
        arguments: { digestId: uid("digest") },
      },
    });
    const digestBody = await digestCall.json() as {
      result: { isError: boolean; structuredContent: { error: string } };
    };
    expect(digestCall.status).toBe(200);
    expect(digestBody.result.isError).toBe(true);
    expect(digestBody.result.structuredContent.error).toBe("not_found");
  });

  it("denies a write tool from a Free key with the documented tier message in a clean JSON-RPC error", async () => {
    const userId = await seedUserWithPlan("free");
    const readSecret = await createKeyFor(userId, "Free read-only", false);

    const response = await postMcp(readSecret, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_watchlist",
        arguments: { targetLabel: "Glossier", idempotencyKey: uid("wl-create") },
      },
    });
    const body = await response.json() as { error: { code: number; message: string } };
    // JSON-RPC transport: plan/key denials are per-method errors (HTTP 200
    // envelope), never a 500 — the tier boundary is the message, not a burst.
    expect(response.status).toBe(200);
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("read-only");

    // A (simulated) write-enabled key on Free hits the Agency plan gate.
    const writeSecret = await createKeyFor(userId, "Simulated write key", true);
    const denied = await postMcp(writeSecret, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "create_watchlist",
        arguments: { targetLabel: "Glossier", idempotencyKey: uid("wl-create-2") },
      },
    });
    const deniedBody = await denied.json() as { error: { code: number; message: string } };
    expect(denied.status).toBe(200);
    expect(deniedBody.error.code).toBe(-32602);
    expect(deniedBody.error.message).toContain("Agency plan");
  });

  it("matches the same read surface for a Scout key", async () => {
    const userId = await seedUserWithPlan("scout");
    const watchlistId = await seedWatchlist(userId);
    await seedRun(watchlistId);
    const secret = await createKeyFor(userId, "Scout agent read", false);
    const counter = { n: 0 };
    const readTools = readToolInputs(watchlistId);

    const listed = await postMcp(secret, {
      jsonrpc: "2.0",
      id: rpcId(counter),
      method: "tools/list",
      params: {},
    });
    const listedBody = await listed.json() as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listedBody.result.tools.map((tool) => tool.name)).toContain(
      "get_workspace_readiness",
    );
    expect(listedBody.result.tools.map((tool) => tool.name)).toContain("list_web_mentions");

    for (const input of readTools) {
      const response = await postMcp(secret, {
        jsonrpc: "2.0",
        id: rpcId(counter),
        method: "tools/call",
        params: input,
      });
      const body = await response.json() as { result?: { isError?: boolean } };
      expect(response.status, `${input.name}`).toBe(200);
      expect(body.result?.isError, `${input.name}: ${JSON.stringify(body)}`).toBe(false);
    }
  });

  it("lets a Free key read JSON over REST and keeps CSV exports gated to Starter+", async () => {
    const userId = await seedUserWithPlan("free");
    const collectionId = uid("col");
    await env.DB.prepare(
      `INSERT INTO collection (id, user_id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(collectionId, userId, "REST free evidence", null, ISO_T0, ISO_T0)
      .run();
    const secret = await createKeyFor(userId, "REST read", false);

    const jsonRead = await getV1Resource(secret, "collections", collectionId, "json");
    expect(jsonRead.status, await jsonRead.text()).toBe(200);

    const csvExport = await getV1Resource(secret, "collections", collectionId, "csv");
    const csvBody = await csvExport.json() as { error: string; feature: string; plan: string };
    expect(csvExport.status).toBe(403);
    expect(csvBody.error).toBe("plan_gated");
    expect(csvBody.feature).toBe("export_csv");
  });

  it("returns a real 403 for a write action from a Free key over REST", async () => {
    const userId = await seedUserWithPlan("free");
    const secret = await createKeyFor(userId, "REST write attempt", true);
    const response = await postV1Action(secret, {
      action: "watchlist.create",
      input: { targetLabel: "Glossier" },
      idempotencyKey: uid("rest-wl"),
    });
    const body = await response.json() as { error: string; feature: string };
    expect(response.status).toBe(403);
    expect(body.error).toBe("plan_gated");
    expect(body.feature).toBe("mcp_account_actions");
  });
});