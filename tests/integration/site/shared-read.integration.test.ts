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

describe("a rival's public page, read for several workspaces", () => {
  beforeEach(() => {
    fetched.length = 0;
    stubWeb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(env, "BROWSER");
  });

  it("is fetched once a night and handed to every workspace that watches it", async () => {
    const first = await readPage(targetFor("ws-a", "competitor"), NIGHT_ONE);
    const second = await readPage(targetFor("ws-b", "competitor"), NIGHT_ONE);
    const third = await readPage(targetFor("ws-c", "competitor"), NIGHT_ONE);

    expect(fetched.filter((url) => url === URL_OF_RIVAL)).toHaveLength(1);
    for (const read of [first, second, third]) {
      expect(read).toMatchObject({ ok: true, transport: "fetch", status: 200 });
    }
    expect(second.ok && first.ok ? second.html : null).toBe(first.ok ? first.html : undefined);
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
});
