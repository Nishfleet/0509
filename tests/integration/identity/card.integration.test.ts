import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startCard } from "../../../app/lib/identity/card.server";
import { confirmCard } from "../../../app/lib/identity/confirm.server";
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
    if (isLogo(url)) return Promise.resolve(new Response("png", { status: 200 }));
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
});

describe("startCard", () => {
  it("draws the card from the brand's homepage", async () => {
    stubWeb(() => new Response(gym, { status: 200 }));
    const card = startCard(subjectFor("gymshark.com"));

    const site = await card.site;
    expect(site.name).toBe("Gymshark");
    expect(site.description).toContain("game-changing workout clothes");
    expect(site.socials.map((social) => social.platform)).toContain("instagram");
    expect(site.unfound).toBe(false);
    expect(await card.logo).toContain("Gymshark_Combi_Logo_Black.png");
  });

  it("reads the homepage once a day, not once per visit", async () => {
    const calls = stubWeb(() => new Response(gym, { status: 200 }));
    await startCard(subjectFor("gymshark.com")).site;
    await startCard(subjectFor("https://www.gymshark.com/")).site;
    expect(calls.filter((url) => !isLogo(url))).toEqual(["https://gymshark.com/"]);
  });

  it("says nothing was found when the site cannot be read, and caches nothing", async () => {
    stubWeb(() => new Response("blocked", { status: 403 }));
    const card = startCard(subjectFor("unreachable.example"));
    expect(await card.site).toEqual({ name: null, description: null, socials: [], unfound: true });
    expect(await card.logo).toBeNull();
    expect((await env.IDENTITY_CACHE.list()).keys).toEqual([]);
  });

  it("starts a creator's card from the handle, without reading any site", async () => {
    const calls = stubWeb(() => new Response(gym, { status: 200 }));
    const site = await startCard(subjectFor("https://www.instagram.com/gymshark/")).site;
    expect(site).toEqual({
      name: "@gymshark",
      description: null,
      socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }],
      unfound: false,
    });
    expect(calls).toEqual([]);
  });
});

describe("confirmCard", () => {
  it("saves the card, with the user's edits, as the workspace's own brand", async () => {
    const saved = await confirmCard(
      "ws-1",
      form({
        subject: "https://www.gymshark.com/en-GB/",
        name: " Gymshark UK ",
        description: "Gym clothes",
        logo: "https://cdn.example/logo.png",
        "social.instagram": "https://www.instagram.com/gymshark/",
      }),
    );
    expect(saved).toBe(true);

    const row = await env.DB.prepare(
      "SELECT role, domain, name, identity_json, origin, state, confirmed_at IS NOT NULL AS confirmed FROM entity",
    ).first<Record<string, unknown>>();
    expect(row).toMatchObject({ role: "self", domain: "gymshark.com", name: "Gymshark UK", origin: "manual", state: "on", confirmed: 1 });
    expect(JSON.parse(String(row?.identity_json))).toEqual({
      kind: "domain",
      platform: null,
      url: "https://www.gymshark.com/",
      description: "Gym clothes",
      logoUrl: "https://cdn.example/logo.png",
      socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }],
    });
  });

  it("refuses a card with no name, and a second confirm keeps the first", async () => {
    expect(await confirmCard("ws-1", form({ subject: "gymshark.com", name: "  ", description: "", logo: "" }))).toBe(false);
    expect(await confirmCard("ws-1", form({ subject: "gymshark.com", name: "First", description: "", logo: "" }))).toBe(true);
    expect(await confirmCard("ws-1", form({ subject: "gymshark.com", name: "Second", description: "", logo: "" }))).toBe(true);
    const { results } = await env.DB.prepare("SELECT name FROM entity").all();
    expect(results).toEqual([{ name: "First" }]);
  });

  it("refuses a social link that is not a URL", async () => {
    const saved = await confirmCard(
      "ws-1",
      form({ subject: "gymshark.com", name: "Gymshark", description: "", logo: "", "social.x": "javascript:alert(1)" }),
    );
    expect(saved).toBe(false);
  });
});
