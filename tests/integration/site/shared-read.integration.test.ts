import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteSweepTarget } from "../../../app/lib/data/watch.server";
import { readPage } from "../../../app/lib/site/read-page.server";
import { logSharedChecks, summarizeSharedChecks } from "../../../app/lib/shared-checks.server";

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

describe("a rival's public page, read for several workspaces", () => {
  beforeEach(async () => {
    const { keys } = await env.IDENTITY_CACHE.list({ prefix: "shared-read:" });
    await Promise.all(keys.map((key) => env.IDENTITY_CACHE.delete(key.name)));
    const noted = await env.IDENTITY_CACHE.list({ prefix: "shared-stats:" });
    await Promise.all(noted.keys.map((key) => env.IDENTITY_CACHE.delete(key.name)));
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
      await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
      await readPage(targetFor("ws-b", "competitor"), NIGHT_ONE);
      expect(fetched.filter((url) => url === URL_OF_RIVAL)).toHaveLength(2);
      expect((await env.IDENTITY_CACHE.list({ prefix: "shared-read:" })).keys).toHaveLength(0);
      expect(await summarizeSharedChecks(NIGHT_ONE)).toMatchObject({ enabled: false, pageHits: 0, pageMisses: {} });
    },
  );

  it("is off when the var is missing altogether", async () => {
    Reflect.deleteProperty(env, "SHARED_RIVAL_CHECKS");
    await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    await readPage(targetFor("ws-b", "competitor"), NIGHT_ONE);
    expect(fetched.filter((url) => url === URL_OF_RIVAL)).toHaveLength(2);
  });

  it("counts hits and misses by reason for the night", async () => {
    await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    await readPage(targetFor("ws-b", "competitor"), NIGHT_ONE);
    await readPage(targetFor("ws-c", "competitor"), NIGHT_ONE);
    expect(await summarizeSharedChecks(NIGHT_ONE)).toMatchObject({
      enabled: true,
      pageHits: 2,
      pageMisses: { no_copy: 1 },
    });
    expect(await summarizeSharedChecks(NIGHT_TWO)).toMatchObject({ pageHits: 0, pageMisses: {} });
  });

  it("counts a copy that could not be read as a miss with its own reason", async () => {
    vi.spyOn(env.IDENTITY_CACHE, "get").mockRejectedValue(new Error("KV GET failed: 429"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    vi.restoreAllMocks();
    expect(await summarizeSharedChecks(NIGHT_ONE)).toMatchObject({ pageHits: 0, pageMisses: { read_failed: 1 } });
  });

  it("logs one line for the sweep with counts only, nothing about a workspace or a rival", async () => {
    await readPage(targetFor("ws-secret", "competitor"), NIGHT_ONE);
    await readPage(targetFor("ws-other", "competitor"), NIGHT_ONE);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await logSharedChecks(NIGHT_ONE);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "site.shared_checks",
      enabled: true,
      pageHits: 1,
      pageMisses: { no_copy: 1 },
      verdictHits: 0,
      verdictMisses: {},
    });
    expect(line).not.toMatch(/ws-|shared-rival/);
  });
});
