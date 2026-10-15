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
      "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?1, ?2, 'scout', 'trialing', ?3)",
    ).bind(`${workspaceId}-plan`, workspaceId, NOW),
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

const wikidataGymshark = vi.fn((input: RequestInfo | URL) => {
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleCompetitorIntent intent=add", () => {
  it("names a typed website after its domain when the site gives no name", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal("fetch", NOT_FOUND);
    const result = await handleCompetitorIntent(workspaceId, addForm("gymshark.com"));
    expect(result).toEqual({ message: null, added: true });

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
      name: "Gymshark",
      origin: "manual",
      state: "on",
    });
    expect(typeof row?.id).toBe("string");
    expect(row?.id.length).toBeGreaterThan(0);
  });

  it("stores the brand name the site gives for itself, so the customer never sees a bare domain", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response('<html><head><meta property="og:site_name" content="Gymshark"></head></html>', {
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    const result = await handleCompetitorIntent(workspaceId, addForm("gymshark.com"));
    expect(result).toEqual({ message: null, added: true });
    const row = await env.DB.prepare("SELECT name FROM entity WHERE workspace_id = ? AND domain = 'gymshark.com'")
      .bind(workspaceId)
      .first<{ name: string | null }>();
    expect(row?.name).toBe("Gymshark");
  });

  it("resolves a typed brand name through resolveDomain and stores it as typed", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal("fetch", wikidataGymshark);

    const result = await handleCompetitorIntent(workspaceId, addForm("Gymshark"));
    expect(result).toEqual({ message: null, added: true });

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

  it("asks for an address when the field is submitted blank, without a fetch or a row", async () => {
    const workspaceId = await seedWorkspace();
    const fetched = vi.fn(NOT_FOUND);
    vi.stubGlobal("fetch", fetched);

    expect(await handleCompetitorIntent(workspaceId, addForm("   "))).toEqual({
      message: "Enter their website address, like brand.com.",
    });
    expect(fetched).not.toHaveBeenCalled();
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

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ? AND role = 'competitor'")
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("asks to check the spelling when the address does not answer, and adds nothing", async () => {
    const workspaceId = await seedWorkspace();
    const fetched = vi.fn((_input: RequestInfo | URL) => Promise.reject(new TypeError("fetch failed")));
    vi.stubGlobal("fetch", fetched);

    expect(await handleCompetitorIntent(workspaceId, addForm("gymshrk.com"))).toEqual({
      message: "We couldn't reach that address. Check the spelling?",
      unreachable: true,
    });
    expect(fetched.mock.calls.map(([input]) => new URL(String(input)).hostname)).toContain("www.gymshrk.com");
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ? AND role = 'competitor'")
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("sends no request to the typed address once the probe limit is spent", async () => {
    const workspaceId = await seedWorkspace();
    const fetched = vi.fn((_input: RequestInfo | URL) => Promise.reject(new TypeError("fetch failed")));
    vi.stubGlobal("fetch", fetched);
    const limiter = vi.spyOn(env.PROBE_LIMIT, "limit").mockResolvedValue({ success: false });

    const result = await handleCompetitorIntent(workspaceId, addForm("gymshrk.com"));
    limiter.mockRestore();

    expect(result.unreachable).toBeUndefined();
    expect(result.message).toContain("tried a lot of addresses");
    expect(fetched).not.toHaveBeenCalled();
  });

  it("tells a workspace at its plan cap about the cap, not the spelling, and sends no request", async () => {
    const workspaceId = await seedWorkspace();
    const fetched = vi.fn((_input: RequestInfo | URL) => Promise.reject(new TypeError("fetch failed")));
    vi.stubGlobal("fetch", fetched);
    const rivals = ["a", "b", "c", "d", "e"].map((name) =>
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at) VALUES (?1, ?2, 'competitor', ?3, '{}', 'manual', 'on', ?4)",
      ).bind(`${workspaceId}-${name}`, workspaceId, `${name}-brand.example`, NOW),
    );
    await env.DB.batch(rivals);

    const result = await handleCompetitorIntent(workspaceId, addForm("gymshrk.com"));

    expect(result.unreachable).toBeUndefined();
    expect(result.message).toContain("Your plan watches up to 5 competitors");
    expect(fetched).not.toHaveBeenCalled();
  });

  it("adds an address that does not answer when the customer chooses to add it anyway", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const form = addForm("gymshrk.com");
    form.set("anyway", "1");

    expect(await handleCompetitorIntent(workspaceId, form)).toEqual({ message: null, added: true });
  });

  it("treats Cloudflare's no-such-origin answer as an address that cannot be found", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 530 })));

    expect(await handleCompetitorIntent(workspaceId, addForm("gymshrk.com"))).toEqual({
      message: "We couldn't reach that address. Check the spelling?",
      unreachable: true,
    });
  });

  it("accepts an address whose apex does not answer but whose www does", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
      new URL(String(input)).hostname === "www.gymshark.com"
        ? Promise.resolve(new Response(null, { status: 200 }))
        : Promise.reject(new TypeError("fetch failed")),
    );

    expect(await handleCompetitorIntent(workspaceId, addForm("gymshark.com"))).toEqual({ message: null, added: true });
  });

  it("does not block an address on a slow answer, only on one that cannot be found", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal("fetch", () => Promise.reject(new DOMException("timed out", "TimeoutError")));

    expect(await handleCompetitorIntent(workspaceId, addForm("slow-brand.com"))).toEqual({
      message: null,
      added: true,
    });
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

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ? AND role = 'competitor'")
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("never writes a Jev verdict for a manual add", async () => {
    const workspaceId = await seedWorkspace();
    vi.stubGlobal("fetch", wikidataGymshark);
    const result = await handleCompetitorIntent(workspaceId, addForm("Gymshark"));
    expect(result).toEqual({ message: null, added: true });
    const added = await env.DB.prepare(
      "SELECT id FROM entity WHERE workspace_id = ? AND role = 'competitor' AND domain = 'gymshark.com'",
    )
      .bind(workspaceId)
      .first<{ id: string }>();
    expect(typeof added?.id).toBe("string");

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});
