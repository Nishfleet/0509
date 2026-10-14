import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteSweepTarget } from "../../../app/lib/data/watch.server";
import { readPage } from "../../../app/lib/site/read-page.server";

const NIGHT_ONE = "2026-10-14T21:00:00Z";
const SAME_NIGHT_LATER = "2026-10-14T23:30:00Z";
const NIGHT_TWO = "2026-10-15T21:00:00Z";
const URL_OF_RIVAL = "https://shared-rival.com/";
const PAGE =
  "<!doctype html><html><body><h1>Rival</h1><p>" +
  "Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.".repeat(
    3,
  ) +
  "</p></body></html>";

const fetched: string[] = [];

function stubWeb(status = 200): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    fetched.push(url);
    return Promise.resolve(new Response(PAGE, { status, headers: { "content-type": "text/html" } }));
  });
}

const targetFor = (workspaceId: string, role: "competitor" | "self", url = URL_OF_RIVAL): SiteSweepTarget => ({
  workspaceId,
  entityId: `ent-${workspaceId}`,
  entityRole: role,
  sourceId: "src_site_web",
  watchId: `watch-${workspaceId}`,
  pageId: `page-${workspaceId}`,
  pageRole: "home",
  url,
  transport: null,
  transportTestedAt: null,
});

function sharedOutcomes(log: { mock: { calls: unknown[][] } }): string[] {
  return log.mock.calls.flatMap(([line]) => {
    const parsed = JSON.parse(String(line)) as { event?: string; kind?: string; result?: string };
    return parsed.event === "site.shared_check" ? [`${parsed.kind ?? ""}:${parsed.result ?? ""}`] : [];
  });
}

async function seedPage(workspaceId: string): Promise<void> {
  const at = "2026-10-01T00:00:00Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Owner', ?2, 1, ?3, ?3)`,
    ).bind(`user-${workspaceId}`, `${workspaceId}@0509.io`, at),
    env.DB.prepare(
      `INSERT OR IGNORE INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?1, ?1, ?2, 'UTC', 1, 8, ?3)`,
    ).bind(workspaceId, `user-${workspaceId}`, at),
    env.DB.prepare(
      `INSERT OR IGNORE INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', 'shared-rival.com', 'Rival', 'on', ?3)`,
    ).bind(`ent-${workspaceId}`, workspaceId, at),
    env.DB.prepare(
      `INSERT OR IGNORE INTO page (id, entity_id, url, role, discovered_at) VALUES (?1, ?2, ?3, 'home', ?4)`,
    ).bind(`page-${workspaceId}`, `ent-${workspaceId}`, URL_OF_RIVAL, at),
  ]);
}

describe("a rival's public page, read for several workspaces", () => {
  beforeEach(async () => {
    const { keys } = await env.IDENTITY_CACHE.list({ prefix: "shared-read:" });
    await Promise.all(keys.map((key) => env.IDENTITY_CACHE.delete(key.name)));
    Reflect.set(env, "SHARED_RIVAL_CHECKS", "on");
    fetched.length = 0;
    stubWeb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(env, "BROWSER");
    Reflect.set(env, "SHARED_RIVAL_CHECKS", "on");
  });

  it("is fetched once a night and handed to every workspace that watches it", async () => {
    const first = await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    const second = await readPage(targetFor("ws-b", "competitor"), NIGHT_ONE);
    const third = await readPage(targetFor("ws-c", "competitor"), NIGHT_ONE);

    expect(fetched.filter((url) => url === URL_OF_RIVAL)).toHaveLength(1);
    for (const read of [first, second, third]) {
      expect(read).toMatchObject({ ok: true, transport: "fetch", status: 200 });
    }
    if (!first.ok || !second.ok) throw new Error("expected both reads to succeed");
    expect(second.html).toBe(first.html);
  });

  it("is fetched again the next night, so a changed page is seen", async () => {
    await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    await readPage(targetFor("ws-a", "competitor"), NIGHT_TWO);
    expect(fetched.filter((url) => url === URL_OF_RIVAL)).toHaveLength(2);
  });

  it("is fetched again by a later run the same day, so a catch-up run never sees stale text", async () => {
    await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    await readPage(targetFor("ws-a", "competitor"), SAME_NIGHT_LATER);
    expect(fetched.filter((url) => url === URL_OF_RIVAL)).toHaveLength(2);
  });

  it("still returns the page when the shared copy cannot be stored", async () => {
    vi.spyOn(env.IDENTITY_CACHE, "put").mockRejectedValue(new Error("KV PUT failed: 429"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const read = await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    expect(read).toMatchObject({ ok: true, transport: "fetch", status: 200 });
  });

  it("reads the page itself when the shared copy cannot be read", async () => {
    vi.spyOn(env.IDENTITY_CACHE, "get").mockRejectedValue(new Error("KV GET failed: 429"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const read = await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    expect(read).toMatchObject({ ok: true, transport: "fetch", status: 200 });
  });

  it("is never shared for the owner's own page, which each workspace reads for itself", async () => {
    await readPage(targetFor("ws-a", "self"), NIGHT_ONE);
    await readPage(targetFor("ws-b", "self"), NIGHT_ONE);
    expect(fetched.filter((url) => url === URL_OF_RIVAL).length).toBeGreaterThanOrEqual(2);
  });

  it("does not hand a rival's cached copy to a workspace's own page at the same address", async () => {
    await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    const before = fetched.length;
    await readPage(targetFor("ws-b", "self"), NIGHT_ONE);
    expect(fetched.length).toBeGreaterThan(before);
  });

  it("shares nothing but the page text: no workspace, brand or snapshot id is stored with it", async () => {
    await readPage(targetFor("ws-secret", "competitor"), NIGHT_ONE);
    const { keys } = await env.IDENTITY_CACHE.list({ prefix: "shared-read:" });
    expect(keys).toHaveLength(1);
    const stored = (await env.IDENTITY_CACHE.get(keys[0]?.name ?? "")) ?? "";
    expect(Object.keys(JSON.parse(stored) as object).sort()).toEqual(["html", "ms", "ok", "status", "transport"]);
    expect(stored).not.toContain("ws-secret");
    expect(keys[0]?.name).not.toContain("shared-rival");
  });

  it.each(["off", "", "  ", "yes"])(
    "reads for every workspace itself and keeps no copy unless the switch is on (%j)",
    async (value) => {
      Reflect.set(env, "SHARED_RIVAL_CHECKS", value);
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
      await readPage(targetFor("ws-b", "competitor"), NIGHT_ONE);
      expect(fetched.filter((url) => url === URL_OF_RIVAL)).toHaveLength(2);
      expect((await env.IDENTITY_CACHE.list({ prefix: "shared-read:" })).keys).toHaveLength(0);
      expect(sharedOutcomes(log)).toEqual([]);
    },
  );

  it("is off when the var is missing altogether", async () => {
    Reflect.deleteProperty(env, "SHARED_RIVAL_CHECKS");
    await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    await readPage(targetFor("ws-b", "competitor"), NIGHT_ONE);
    expect(fetched.filter((url) => url === URL_OF_RIVAL)).toHaveLength(2);
  });

  it("logs one line per shared lookup, saying only whether it was a hit and why not", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await readPage(targetFor("ws-secret", "competitor"), NIGHT_ONE);
    await readPage(targetFor("ws-other", "competitor"), NIGHT_ONE);
    expect(sharedOutcomes(log)).toEqual(["page:no_copy", "page:hit"]);
    const lines = log.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("site.shared_check"));
    expect(lines.join("\n")).not.toMatch(/ws-|shared-rival/);
  });

  it("logs a copy that could not be read as a miss with its own reason", async () => {
    vi.spyOn(env.IDENTITY_CACHE, "get").mockRejectedValue(new Error("KV GET failed: 429"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    expect(sharedOutcomes(log)).toEqual(["page:read_failed"]);
  });

  it("never hands a fetch-only copy to a page that has learned it needs the browser", async () => {
    await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    const learned = { ...targetFor("ws-b", "competitor"), transport: "browser" as const, transportTestedAt: NIGHT_ONE };
    const read = await readPage(learned, NIGHT_ONE);
    expect(read.ok).toBe(false);
    expect(fetched.filter((url) => url === URL_OF_RIVAL)).toHaveLength(1);
  });

  it("still records how the page was read for a workspace that took the shared copy", async () => {
    await seedPage("ws-b");
    await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    const second = await readPage(targetFor("ws-b", "competitor"), NIGHT_ONE);
    expect(second).toMatchObject({ ok: true });
    expect(fetched.filter((url) => url === URL_OF_RIVAL)).toHaveLength(1);
    const page = await env.DB.prepare("SELECT transport, transport_tested_at FROM page WHERE id = 'page-ws-b'").first();
    expect(page).toEqual({ transport: "fetch", transport_tested_at: NIGHT_ONE });
  });
});
