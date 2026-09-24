import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { propsForApiKey } from "../../app/lib/agent/keys.server";
import {
  readAgentAlerts,
  readAgentBrief,
  readAgentCompetitor,
  readAgentCompetitors,
  readAgentStanding,
} from "../../app/lib/agent/read.server";
import { apiResponse, mcpResponse } from "../../app/lib/agent/serve.server";
import { createAuth } from "../../app/lib/auth.server";

const auth = createAuth({
  DB: env.DB,
  EMAIL: { send: async () => ({ ok: true }) },
  SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
  SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
  BETTER_AUTH_SECRET: "integration-test-secret",
  BETTER_AUTH_URL: "http://localhost:8787",
});

const NOW = "2026-09-21T12:00:00.000Z";

const PAYLOAD = {
  workspace_id: "ws_agent_a",
  timezone: "Europe/Berlin",
  period_start: "2026-09-14T00:00:00.000Z",
  period_end: "2026-09-21T00:00:00.000Z",
  headline_rank: 2,
  headline_total: 3,
  headline_movement: 1,
  headline_is_new: false,
  why_line: "You climbed one place on new ads.",
  is_quiet_week: false,
  read_this_first: [
    {
      signal_id: "sig_1",
      entity_id: "ent_agent_a",
      entity_name: "Rival A",
      title: "Pricing page changed",
      source: "site",
      observed_at: NOW,
      thumbnail_r2_key: "snapshot/site/secret.png",
      url: "https://rival-a.example/pricing",
      before: "€10",
      after: "€12",
      jev_reason: "They raised prices.",
    },
  ],
  brands: [{ entity_id: "ent_agent_a", name: "Rival A", rank: 1, movement: 0, is_new: false, biggest_move: null, ad_delta: 2, mention_delta: 0, site_change_count: 1 }],
  own_site: { status: "ok", incidents: [] },
  checked: { mention_count: 0, site_change_count: 1, new_ad_count: 2, source_keys: [], degraded_source_keys: [], degraded_sources: [] },
  next_brief_at: "2026-09-28T07:00:00.000Z",
};

async function seedWorkspace(suffix: string) {
  const userId = `u_agent_${suffix}`;
  const workspaceId = `ws_agent_${suffix}`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, 1, ?4, ?4)').bind(
      userId,
      "Agent Owner",
      `agent-${suffix}@test.dev`,
      NOW,
    ),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, 'UTC', ?4)").bind(
      workspaceId,
      suffix,
      userId,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
    ).bind(`ent_agent_${suffix}`, workspaceId, `rival-${suffix}.example`, `Rival ${suffix.toUpperCase()}`, NOW),
  ]);
  return { userId, workspaceId };
}

let a: { userId: string; workspaceId: string };
let b: { userId: string; workspaceId: string };
let keyA: string;

beforeAll(async () => {
  a = await seedWorkspace("a");
  b = await seedWorkspace("b");
  await env.DB.prepare(
    "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json) VALUES ('dg_agent_a', ?1, 'weekly', ?2, ?3, 'sent', ?4)",
  )
    .bind(a.workspaceId, PAYLOAD.period_start, PAYLOAD.period_end, JSON.stringify(PAYLOAD))
    .run();
  keyA = (await auth.api.createApiKey({ body: { userId: a.userId, name: "agent test" } })).key;
});

function jsonRpc(method: string, params: object = {}) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function rpcResult<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  const parsed: { result: T } = JSON.parse(data === undefined ? text : data.slice("data: ".length));
  return parsed.result;
}

describe("agent access, scoped to one workspace", () => {
  it("issues keys with the 0509_ prefix and resolves them to their owner only", async () => {
    expect(keyA.startsWith("0509_")).toBe(true);
    expect(await propsForApiKey(keyA)).toMatchObject({ userId: a.userId });
    expect(await propsForApiKey("0509_not-a-real-key")).toBeNull();
    expect(await propsForApiKey("sk_other_vendor_key")).toBeNull();
  });

  it("reads the brief in customer terms and never leaks storage keys", async () => {
    const { brief } = await readAgentBrief(a.workspaceId);
    expect(brief?.headline).toEqual({ rank: 2, of: 3, movement: 1, isNew: false, why: "You climbed one place on new ads." });
    expect(brief?.readThisFirst[0]).toMatchObject({ competitor: "Rival A", why: "They raised prices." });
    expect(JSON.stringify(brief)).not.toContain("snapshot/site");
    expect(await readAgentBrief(b.workspaceId)).toEqual({ brief: null });
  });

  it("never returns another workspace's competitors or alerts", async () => {
    const competitors = await readAgentCompetitors(b.workspaceId);
    expect(competitors.tracked.map((row) => row.domain)).toEqual(["rival-b.example"]);
    expect(await readAgentAlerts(b.workspaceId)).toEqual({ alerts: [] });
  });

  it("refuses the REST API without a valid key, and serves the key owner's data with one", async () => {
    const missing = await apiResponse(new Request("http://localhost/api/v1/brief"), readAgentBrief);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");

    const ok = await apiResponse(
      new Request("http://localhost/api/v1/competitors", { headers: { authorization: `Bearer ${keyA}` } }),
      readAgentCompetitors,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body: { tracked: { domain: string }[] } = await ok.json();
    expect(body.tracked.map((row) => row.domain)).toEqual(["rival-a.example"]);
  });

  it("slows one address guessing keys before any key lookup", async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 121; attempt += 1) {
      const response = await apiResponse(
        new Request("http://localhost/api/v1/brief", {
          headers: { authorization: "Bearer 0509_not-a-real-key", "cf-connecting-ip": "203.0.113.200" },
        }),
        readAgentBrief,
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 120).every((status) => status === 401)).toBe(true);
    expect(statuses[120]).toBe(429);
  });

  it("serves the MCP tools as read-only, and a call reads only the caller's workspace", async () => {
    const listed = await mcpResponse(jsonRpc("tools/list"), { userId: a.userId, clientId: "test" });
    expect(listed.status).toBe(200);
    const list = await rpcResult<{ tools: { name: string; annotations: { readOnlyHint: boolean } }[] }>(listed);
    expect(list.tools.map((tool) => tool.name).sort()).toEqual([
      "get_brief",
      "get_competitor",
      "get_standing",
      "list_alerts",
      "list_competitors",
    ]);
    expect(list.tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);

    const called = await mcpResponse(jsonRpc("tools/call", { name: "list_competitors", arguments: {} }), {
      userId: b.userId,
      clientId: "test",
    });
    const call = await rpcResult<{ structuredContent: { tracked: { domain: string }[] } }>(called);
    expect(call.structuredContent.tracked.map((row) => row.domain)).toEqual(["rival-b.example"]);
  });

  it("reads one competitor only inside the caller's workspace", async () => {
    const own = await readAgentCompetitor(a.workspaceId, "ent_agent_a");
    expect(own.competitor).toMatchObject({ id: "ent_agent_a", domain: "rival-a.example", state: "on" });
    expect(await readAgentCompetitor(b.workspaceId, "ent_agent_a")).toEqual({ competitor: null });

    const called = await mcpResponse(
      jsonRpc("tools/call", { name: "get_competitor", arguments: { competitorId: "ent_agent_a" } }),
      { userId: a.userId, clientId: "test" },
    );
    const call = await rpcResult<{ structuredContent: { competitor: { id: string } | null } }>(called);
    expect(call.structuredContent.competitor?.id).toBe("ent_agent_a");
  });

  it("reads standing for the caller's workspace and hides a paused competitor", async () => {
    const standingA = await readAgentStanding(a.workspaceId);
    expect(standingA.standing?.rank).toBe(2);
    expect(standingA.standing?.lines.map((line) => line.competitorId)).toEqual(["ent_agent_a"]);

    await env.DB.prepare("UPDATE entity SET state = 'off' WHERE id = 'ent_agent_a'").run();
    expect((await readAgentStanding(a.workspaceId)).standing?.lines).toEqual([]);
    await env.DB.prepare("UPDATE entity SET state = 'on' WHERE id = 'ent_agent_a'").run();

    expect(await readAgentStanding(b.workspaceId)).toEqual({ standing: null });
  });

  it("refuses a signed-in user who has no workspace yet", async () => {
    const response = await mcpResponse(jsonRpc("tools/list"), { userId: "u_agent_nobody", clientId: "test" });
    expect(response.status).toBe(403);
  });
});
