import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleCompetitorIntent } from "../../../app/lib/competitors.server";

const NOW = "2026-09-24T06:00:00.000Z";

let runs = 0;

async function seedWorkspace(): Promise<string> {
  runs += 1;
  const userId = `user-addmanual-${String(runs)}`;
  const workspaceId = `ws-addmanual-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(userId, `${userId}@example.com`, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', 'self-brand.example', 'Self Brand', '{\"description\":\"Gym clothing\"}', ?3)",
    ).bind(`${workspaceId}-self`, workspaceId, NOW),
  ]);
  return workspaceId;
}

function addForm(value: string): FormData {
  const form = new FormData();
  form.set("intent", "add");
  form.set("competitor", value);
  return form;
}

const NOT_FOUND = () => Promise.resolve(new Response("not found", { status: 404 }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleCompetitorIntent intent=add", () => {
  it("stores a typed website with no stored name", async () => {
    const workspaceId = await seedWorkspace();
    const result = await handleCompetitorIntent(workspaceId, addForm("gymshark.com"));
    expect(result).toEqual({ message: null });

    const rows = await env.DB.prepare(
      "SELECT id, workspace_id, role, domain, name, origin, state FROM entity WHERE workspace_id = ? AND role = 'competitor'",
    )
      .bind(workspaceId)
      .all<{
        id: string;
        workspace_id: string;
        role: string;
        domain: string;
        name: string | null;
        origin: string;
        state: string;
      }>();
    expect(rows.results).toHaveLength(1);
    const row = rows.results[0];
    expect(row).toMatchObject({
      workspace_id: workspaceId,
      role: "competitor",
      domain: "gymshark.com",
      name: null,
      origin: "manual",
      state: "on",
    });
    expect(typeof row?.id).toBe("string");
    expect(row?.id.length).toBeGreaterThan(0);
  });

  it("resolves a typed brand name through resolveDomain and stores it as typed", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("wbsearchentities")) {
          return Promise.resolve(Response.json({ search: [{ id: "Q123" }] }));
        }
        if (url.includes("wbgetentities")) {
          return Promise.resolve(
            Response.json({
              entities: {
                Q123: {
                  claims: {
                    P856: [
                      {
                        mainsnak: {
                          datavalue: { value: "https://www.gymshark.com" },
                        },
                      },
                    ],
                  },
                },
              },
            }),
          );
        }
        return NOT_FOUND();
      }),
    );

    const result = await handleCompetitorIntent(workspaceId, addForm("Gymshark"));
    expect(result).toEqual({ message: null });

    const rows = await env.DB.prepare(
      "SELECT id, workspace_id, role, domain, name, origin, state FROM entity WHERE workspace_id = ? AND role = 'competitor'",
    )
      .bind(workspaceId)
      .all<{
        id: string;
        workspace_id: string;
        role: string;
        domain: string;
        name: string | null;
        origin: string;
        state: string;
      }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      workspace_id: workspaceId,
      role: "competitor",
      domain: "gymshark.com",
      name: "Gymshark",
      origin: "manual",
      state: "on",
    });
  });

  it("returns the couldn't-find message when resolveDomain cannot find the brand", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.hostname === "www.wikidata.org") {
          return Promise.resolve(Response.json({ search: [] }));
        }
        if (url.hostname === "zzqxnonbrand0509.com") {
          return Promise.reject(new Error("network"));
        }
        return NOT_FOUND();
      }),
    );

    const result = await handleCompetitorIntent(workspaceId, addForm("Zzqx Nonbrand 0509"));
    expect(result).toEqual({
      message: "We couldn't find that brand's website. Try their main website, like brand.com.",
    });

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ? AND role = 'competitor'",
    )
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("refuses to add a domain that is already on the takedown list", async () => {
    const workspaceId = await seedWorkspace();
    await env.DB.prepare(
      "INSERT INTO takedown (subject, requested_at, actioned_at, actioned_by) VALUES (?, ?, ?, 'nish')",
    )
      .bind("refused.example", NOW, NOW)
      .run();

    const result = await handleCompetitorIntent(workspaceId, addForm("refused.example"));
    expect(result).toEqual({
      message: "That brand asked not to be tracked, so we can't add it.",
    });

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ? AND role = 'competitor'",
    )
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("never writes a Jev verdict for a manual add", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("wbsearchentities")) {
          return Promise.resolve(Response.json({ search: [{ id: "Q123" }] }));
        }
        if (url.includes("wbgetentities")) {
          return Promise.resolve(
            Response.json({
              entities: {
                Q123: {
                  claims: {
                    P856: [
                      {
                        mainsnak: {
                          datavalue: { value: "https://www.gymshark.com" },
                        },
                      },
                    ],
                  },
                },
              },
            }),
          );
        }
        return NOT_FOUND();
      }),
    );
    await handleCompetitorIntent(workspaceId, addForm("Gymshark"));

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});
