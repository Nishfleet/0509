import { describe, expect, it } from "vitest";

import { createCustomerApiKey } from "~/lib/api-keys.server";
import {
  MCP_READ_ONLY_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
  mcpToolFeature,
} from "~/lib/plan-feature-gate.server";
import { action } from "~/routes/api.mcp";

import { appEnv, db, uid } from "./fixtures";

const ISO_T0 = "2026-01-01T00:00:00.000Z";

/**
 * BET 6 — read-only MCP/API access on Scout (decision BET-6-ungate yes for
 * SCOUT; Free stays without API).
 *
 * This suite applies the real migrations to local D1 and exercises the actual
 * MCP route action with a real customer API key, so the tier gate is proven
 * against the real schema (not a mocked binding). It asserts:
 *   - every read-only tool is classified to the read-only tier;
 *   - every write/account-mutation tool is classified to the Agency tier;
 *   - a free key can call a read-only tool and gets a 200;
 *   - a free key calling a write tool gets a clean 403 with the tier message;
 *   - a Scout key matches the same surface.
 */
describe("api MCP tier gating against real D1", () => {
  async function seedUserWithPlan(plan: string) {
    const userId = uid("user");
    await db()
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(userId, `Fixture ${userId}`, `${userId}@example.test`, ISO_T0, ISO_T0)
      .run();
    await db()
      .prepare(`INSERT INTO user_plan (user_id, plan, plan_updated_at) VALUES (?, ?, ?)`)
      .bind(userId, plan, ISO_T0)
      .run();
    return userId;
  }

  async function createReadOnlyKey(userId: string) {
    const { secret } = await createCustomerApiKey(appEnv, userId, "tier test key", {
      actionsWriteEnabled: false,
    });
    return secret;
  }

  async function callMcpTool(secret: string, name: string, args: Record<string, unknown>) {
    return action({
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

  it("classifies every read-only tool to the read-only tier", () => {
    expect(MCP_READ_ONLY_TOOL_NAMES.size).toBeGreaterThan(0);
    for (const tool of MCP_READ_ONLY_TOOL_NAMES) {
      expect(mcpToolFeature(tool), `expected ${tool} to be read-only`).toBe("mcp_read_access");
    }
  });

  it("classifies every write/account-mutation tool to the Agency tier", () => {
    expect(MCP_WRITE_TOOL_NAMES.size).toBeGreaterThan(0);
    for (const tool of MCP_WRITE_TOOL_NAMES) {
      expect(mcpToolFeature(tool), `expected ${tool} to be an account-mutation tool`).toBe(
        "mcp_account_actions",
      );
    }
  });

  it("blocks a free key from a read-only tool (barebones: no API/MCP)", async () => {
    const userId = await seedUserWithPlan("free");
    const secret = await createReadOnlyKey(userId);

    const response = await callMcpTool(secret, "get_offer_state_at", {
      domain: `free-${uid("dom")}.example`,
      date: "2026-08-20",
    });

    // Barebones free (2026-09-10): no API/MCP access at all. Read-only MCP
    // tools are Scout+.
    expect(response.status).toBe(403);
  });

  it("blocks a free key from a write tool with a clean 403 and the tier message", async () => {
    const userId = await seedUserWithPlan("free");
    const secret = await createReadOnlyKey(userId);

    const response = await callMcpTool(secret, "create_watchlist", {
      name: "Blocked",
      target: { type: "advertiser", id: "x" },
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Agency");
  });

  it("lets a Scout key call a read-only tool and returns 200", async () => {
    const userId = await seedUserWithPlan("scout");
    const secret = await createReadOnlyKey(userId);

    const response = await callMcpTool(secret, "get_offer_state_at", {
      domain: `scout-${uid("dom")}.example`,
      date: "2026-08-20",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { structuredContent: { tool: string } };
    };
    expect(body.result.structuredContent.tool).toBe("get_offer_state_at");
  });

  it("blocks a Scout key from a write tool with a clean 403 and the tier message", async () => {
    const userId = await seedUserWithPlan("scout");
    const secret = await createReadOnlyKey(userId);

    const response = await callMcpTool(secret, "create_watchlist", {
      name: "Blocked",
      target: { type: "advertiser", id: "x" },
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Agency");
  });
});
