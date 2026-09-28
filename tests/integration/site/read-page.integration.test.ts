import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readSiteSweepTargets } from "../../../app/lib/data/watch.server";
import { readPage } from "../../../app/lib/site/read-page.server";

interface BrowserStub {
  calls: string[];
  closed: number;
  quickAction(
    action: "content",
    options: { url: string },
  ): Promise<Response>;
}

const browserHolder = vi.hoisted(() => ({
  current: undefined as undefined | BrowserStub,
}));

function installBrowser(): void {
  Object.defineProperty(env, "BROWSER", {
    configurable: true,
    get() {
      return browserHolder.current;
    },
  });
}

const USER = "user-read-page";
const WS = "ws-read-page";
const NOW = "2026-09-25T02:00:00Z";
const NEXT_DAY = "2026-09-26T02:00:00Z";
const EIGHT_DAYS_LATER = "2026-10-02T02:00:00Z";
const THIN_PAGE = "<!doctype html><html><body><div id=\"app\"></div></body></html>";
const SUBSTANTIAL_PAGE =
  "<!doctype html><html><body><h1>Brand</h1><p>" +
  "Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.".repeat(3) +
  "</p></body></html>";

const fetchState = {
  calls: [] as string[],
  responses: new Map<string, string>(),
};

function browserStub(): BrowserStub {
  const calls: string[] = [];
  const state = { closed: 0 };
  return {
    calls,
    get closed() {
      return state.closed;
    },
    async quickAction(_action, options) {
      calls.push(options.url);
      return new Response(
        JSON.stringify({
          success: true,
          result: SUBSTANTIAL_PAGE,
          meta: { status: 200 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    close() {
      state.closed += 1;
      return Promise.resolve();
    },
  };
}

const installFetch = () => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchState.calls.push(url);
    const body = fetchState.responses.get(url);
    if (body === undefined) throw new Error(`unexpected outbound fetch: ${url}`);
    return Promise.resolve(new Response(body, { status: 200 }));
  });
};

const seed = async (entityId: string, urls: readonly string[]) => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Reader', 'read-page@0509.io', 1, ?, ?)`,
  )
    .bind(USER, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Read page', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(WS, USER, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'competitor', 'rival.com', '{}', 'manual', 'on', ?)`,
  )
    .bind(entityId, WS, NOW)
    .run();
  for (const [index, url] of urls.entries()) {
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, role, discovered_at)
       VALUES (?, ?, ?, 'other', ?)`,
    )
      .bind(`page-read-page-${entityId}-${String(index)}`, entityId, url, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO watch (id, entity_id, source_id, target_key)
       VALUES (?, ?, 'src_site_web', ?)`,
    )
      .bind(`watch-read-page-${entityId}-${String(index)}`, entityId, url)
      .run();
  }
  return readSiteSweepTargets("site.web");
};

const cleanup = async () => {
  await env.DB.exec("DELETE FROM watch");
  await env.DB.exec("DELETE FROM page");
  await env.DB.exec("DELETE FROM entity");
  await env.DB.exec("DELETE FROM workspace");
  await env.DB.exec('DELETE FROM "user"');
};

beforeEach(async () => {
  await cleanup();
  fetchState.calls = [];
  fetchState.responses = new Map();
  installBrowser();
  browserHolder.current = browserStub();
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  browserHolder.current = undefined;
});

describe("readPage (0509#5299)", () => {
  it("records a browser transport and its reason after a thin-text escalation", async () => {
    const url = "https://rival.com/learned";
    fetchState.responses.set(url, THIN_PAGE);
    const [target] = await seed("ent-read-page-learned", [url]);
    if (target === undefined) throw new Error("expected a sweep target");

    const result = await readPage(target, NOW);
    expect(result).toMatchObject({
      ok: true,
      transport: "browser",
      escalationReason: "thin-text",
    });
    expect(fetchState.calls).toEqual([url]);
    expect(browserHolder.current?.calls).toEqual([url]);

    const row = await env.DB.prepare(
      "SELECT transport, transport_reason, transport_tested_at FROM page WHERE id = ?",
    )
      .bind(target.pageId)
      .first<{ transport: string | null; transport_reason: string | null; transport_tested_at: string | null }>();
    expect(row).toEqual({
      transport: "browser",
      transport_reason: "thin-text",
      transport_tested_at: NOW,
    });
  });

  it("starts with the learned browser transport on the next day", async () => {
    const url = "https://rival.com/next-day";
    fetchState.responses.set(url, THIN_PAGE);
    const [initialTarget] = await seed("ent-read-page-next-day", [url]);
    if (initialTarget === undefined) throw new Error("expected a sweep target");
    await readPage(initialTarget, NOW);
    fetchState.calls = [];

    const [target] = await readSiteSweepTargets("site.web");
    if (target === undefined) throw new Error("expected a re-read sweep target");
    const result = await readPage(target, NEXT_DAY);
    expect(result).toMatchObject({ ok: true, transport: "browser" });
    expect(fetchState.calls).toEqual([]);
    expect(browserHolder.current?.calls).toEqual([url, url]);
  });

  it("re-tests the transport with fetch after seven days", async () => {
    const url = "https://rival.com/retest";
    fetchState.responses.set(url, THIN_PAGE);
    const [initialTarget] = await seed("ent-read-page-retest", [url]);
    if (initialTarget === undefined) throw new Error("expected a sweep target");
    await readPage(initialTarget, NOW);
    fetchState.calls = [];

    const [target] = await readSiteSweepTargets("site.web");
    if (target === undefined) throw new Error("expected a re-read sweep target");
    const browserCallsBefore = browserHolder.current?.calls.length ?? 0;
    const result = await readPage(target, EIGHT_DAYS_LATER);
    expect(result).toMatchObject({ ok: true, transport: "browser" });
    expect(fetchState.calls).toEqual([url]);
    expect(browserHolder.current?.calls.length).toBe(browserCallsBefore + 1);

    const row = await env.DB.prepare(
      "SELECT transport, transport_reason, transport_tested_at FROM page WHERE id = ?",
    )
      .bind(target.pageId)
      .first<{ transport: string | null; transport_reason: string | null; transport_tested_at: string | null }>();
    expect(row).toEqual({
      transport: "browser",
      transport_reason: "thin-text",
      transport_tested_at: EIGHT_DAYS_LATER,
    });
  });

  it("defers the fifth browser escalation for one brand on one day", async () => {
    const urls = [
      "https://rival.com/budget-1",
      "https://rival.com/budget-2",
      "https://rival.com/budget-3",
      "https://rival.com/budget-4",
      "https://rival.com/budget-5",
    ];
    for (const url of urls) fetchState.responses.set(url, THIN_PAGE);
    const targets = await seed("ent-read-page-budget", urls);
    const results = [];
    for (const target of targets) results.push(await readPage(target, NOW));

    expect(results.slice(0, 4).every((result) => result.ok && result.transport === "browser")).toBe(true);
    expect(results[4]).toMatchObject({ ok: false, reason: "deferred" });
    expect(browserHolder.current?.calls).toHaveLength(4);
    expect(fetchState.calls).toHaveLength(5);

    const fifth = targets[4];
    if (fifth === undefined) throw new Error("expected five sweep targets");
    const row = await env.DB.prepare(
      "SELECT deferred_at FROM page WHERE id = ?",
    )
      .bind(fifth.pageId)
      .first<{ deferred_at: string | null }>();
    expect(row?.deferred_at).toBe(NOW);
    expect(browserHolder.current?.closed).toBe(0);
  });
});
