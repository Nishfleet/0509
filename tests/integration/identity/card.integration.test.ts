import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startCard } from "../../../app/lib/identity/card.server";
import { confirmCard } from "../../../app/lib/identity/confirm.server";
import { extractIdentity } from "../../../app/lib/identity/extract";
import { normaliseSubject } from "../../../app/lib/identity/normalise";
import gym from "../../fixtures/gymshark-2026-09-22-a.html?raw";

const NOW = "2026-09-24T00:00:00Z";
const LOGO_HOST = "images.ctfassets.net";

function isLogo(url: string): boolean {
  return new URL(url).hostname === LOGO_HOST;
}

function subjectFor(input: string) {
  const normalised = normaliseSubject(input);
  if (!normalised.ok) throw new Error(`${input} must normalise`);
  return normalised.subject;
}

function stubWeb(homepage: (url: string) => Response) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (isLogo(url)) return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }));
    return Promise.resolve(homepage(url));
  });
  return calls;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(async () => {
  const listed = await env.IDENTITY_CACHE.list();
  for (const key of listed.keys) await env.IDENTITY_CACHE.delete(key.name);
  const logos = await env.SNAPSHOTS.list({ prefix: "logo/" });
  for (const object of logos.objects) await env.SNAPSHOTS.delete(object.key);
  for (const table of ["entity", "takedown", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u1', 'Owner', 'u1@0509.io', 0, ?, ?)`,
  ).bind(NOW, NOW).run();
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES ('ws-1', 'Owner', 'u1', ?)`)
    .bind(NOW)
    .run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "AI");
});

describe("startCard", () => {
  function stubAi(p: number) {
    const run = vi.fn(() =>
      Promise.resolve({
        answers: {
          "identity_field_confidence.name": { type: "noul", noul: p },
          "identity_field_confidence.description": { type: "noul", noul: p },
          "identity_field_confidence.socials": { type: "noul", noul: p },
        },
      }),
    );
    Reflect.set(env, "AI", { run });
    return run;
  }

  it("draws the card from the brand's homepage", async () => {
    stubAi(0.95);
    stubWeb(() => new Response(gym, { status: 200 }));
    const card = startCard("ws-1", subjectFor("gymshark.com"));

    const site = await card.site;
    expect(site.name).toBe("Gymshark");
    expect(site.description).toContain("game-changing workout clothes");
    expect(site.socials.map((social) => social.platform)).toContain("instagram");
    expect(site.review).toEqual({ name: "fill", description: "fill", socials: "fill" });
    expect(site.unfound).toBe(false);
    expect(await card.logo).toBe("data:image/png;base64,AQID");
    expect(await env.SNAPSHOTS.get("logo/gymshark.com")).not.toBeNull();
  });

  it("reads the homepage once a day, not once per visit", async () => {
    stubAi(0.95);
    const calls = stubWeb(() => new Response(gym, { status: 200 }));
    await startCard("ws-1", subjectFor("gymshark.com")).site;
    await startCard("ws-1", subjectFor("https://www.gymshark.com/")).site;
    expect(calls.filter((url) => !isLogo(url))).toEqual(["https://gymshark.com/"]);
  });

  it("says nothing was found when the site cannot be read, and caches nothing", async () => {
    stubAi(0.95);
    stubWeb(() => new Response("blocked", { status: 403 }));
    const card = startCard("ws-1", subjectFor("unreachable.example"));
    expect(await card.site).toEqual({
      name: null,
      description: null,
      socials: [],
      review: { name: "empty", description: "empty", socials: "empty" },
      unfound: true,
    });
    expect(await card.logo).toBeNull();
    expect((await env.IDENTITY_CACHE.list()).keys).toEqual([]);
  });

  it("starts a creator's card from the handle, without reading any site", async () => {
    stubAi(0.95);
    const calls = stubWeb(() => new Response(gym, { status: 200 }));
    const site = await startCard("ws-1", subjectFor("https://www.instagram.com/gymshark/")).site;
    expect(site).toEqual({
      name: "@gymshark",
      description: null,
      socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }],
      review: { name: "fill", description: "empty", socials: "fill" },
      unfound: false,
    });
    expect(calls).toEqual([]);
  });
});

describe("confirmCard", () => {
  it("saves the card, with the user's edits, as the workspace's own brand", async () => {
    stubWeb(() => new Response(gym, { status: 200, headers: { "content-type": "text/html" } }));
    await env.SNAPSHOTS.put("logo/gymshark.com", new Uint8Array([1]), { httpMetadata: { contentType: "image/png" } });
    const saved = await confirmCard(
      "ws-1",
      form({
        subject: "https://www.gymshark.com/en-GB/",
        name: " Gymshark UK ",
        description: "Gym clothes",
        "social.instagram": "https://www.instagram.com/gymshark/",
      }),
    );
    expect(saved).toBe(true);

    const row = await env.DB.prepare(
      "SELECT role, domain, name, identity_json, origin, state, confirmed_at IS NOT NULL AS confirmed, id FROM entity",
    ).first<Record<string, unknown>>();
    expect(row).toMatchObject({ role: "self", domain: "gymshark.com", name: "Gymshark UK", origin: "manual", state: "on", confirmed: 1 });
    expect(JSON.parse(String(row?.identity_json))).toEqual({
      kind: "domain",
      platform: null,
      url: "https://www.gymshark.com/",
      description: "Gym clothes",
      logoUrl: "/app/logos/" + String(row?.id),
      socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }],
    });
  });

  it("classifies the homepage's nav pages and writes them as judged page rows", async () => {
    stubWeb(() => new Response(gym, { status: 200, headers: { "content-type": "text/html" } }));
    const run = vi.fn(() => Promise.resolve({ answers: { page_role: { type: "choice", choice: "pricing" } } }));
    Reflect.set(env, "AI", { run });

    expect(
      await confirmCard("ws-1", form({ subject: "https://www.gymshark.com/", name: "Gymshark", description: "" })),
    ).toBe(true);

    const entity = await env.DB.prepare("SELECT id FROM entity WHERE role = 'self'").first<{ id: string }>();
    const expected = (await extractIdentity(gym, "https://www.gymshark.com/")).navPages.length;
    expect(expected).toBeGreaterThan(0);

    const { results } = await env.DB.prepare(
      "SELECT role, role_decided_for_hash FROM page WHERE entity_id = ?1 AND role_decided_for_hash IS NOT NULL",
    )
      .bind(entity?.id ?? "")
      .all<{ role: string; role_decided_for_hash: string }>();
    expect(results).toHaveLength(expected);
    for (const page of results) expect(page.role).toBe("pricing");
  });

  it("keeps the confirm and records no role when Jev is down", async () => {
    stubWeb(() => new Response(gym, { status: 200, headers: { "content-type": "text/html" } }));
    const run = vi.fn(() => Promise.reject(new Error("down")));
    Reflect.set(env, "AI", { run });

    expect(
      await confirmCard("ws-1", form({ subject: "https://www.gymshark.com/", name: "Gymshark", description: "" })),
    ).toBe(true);

    const entity = await env.DB.prepare("SELECT id FROM entity WHERE role = 'self'").first<{ id: string }>();
    expect(entity).not.toBeNull();
    const { results } = await env.DB.prepare(
      "SELECT id FROM page WHERE entity_id = ?1 AND role_decided_for_hash IS NOT NULL",
    )
      .bind(entity?.id ?? "")
      .all();
    expect(results).toEqual([]);
  });

  it("ignores a form-supplied logo URL when no logo is kept in R2", async () => {
    stubWeb(() => new Response(gym, { status: 200, headers: { "content-type": "text/html" } }));
    const saved = await confirmCard(
      "ws-1",
      form({
        subject: "gymshark.com",
        name: "Gymshark",
        description: "Gym clothes",
        logo: "https://evil.example/x.png",
      }),
    );
    expect(saved).toBe(true);
    const row = await env.DB.prepare("SELECT identity_json FROM entity").first<Record<string, unknown>>();
    expect(JSON.parse(String(row?.identity_json)).logoUrl).toBeNull();
  });

  it("refuses a card with no name, and a second confirm keeps the first", async () => {
    expect(await confirmCard("ws-1", form({ subject: "gymshark.com", name: "  ", description: "" }))).toBe(false);
    expect(await confirmCard("ws-1", form({ subject: "gymshark.com", name: "First", description: "" }))).toBe(true);
    expect(await confirmCard("ws-1", form({ subject: "gymshark.com", name: "Second", description: "" }))).toBe(true);
    const { results } = await env.DB.prepare("SELECT name FROM entity").all();
    expect(results).toEqual([{ name: "First" }]);
  });

  it("refuses a social link that is not a URL", async () => {
    const saved = await confirmCard(
      "ws-1",
      form({ subject: "gymshark.com", name: "Gymshark", description: "", "social.x": "javascript:alert(1)" }),
    );
    expect(saved).toBe(false);
  });
});
