import { env, introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jevAnswers = vi.hoisted(() => ({
  noul: new Map<string, number>(),
  choice: new Map<string, string>(),
}));

vi.mock("../../../app/lib/jev/client.server", () => {
  class JevUnavailableError extends Error {
    constructor(cause: unknown) {
      super(`jev unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
      this.name = "JevUnavailableError";
    }
  }
  return {
    JevUnavailableError,
    askNoul: async (_workspaceId: string, question: { id: string }) => {
      const p = jevAnswers.noul.get(question.id);
      if (p === undefined) throw new JevUnavailableError(new Error(`no answer for ${question.id}`));
      return { questionId: question.id, inputHash: `noul-${question.id}`, p, cached: false };
    },
    askChoice: async (_workspaceId: string, question: { id: string }) => {
      const choice = jevAnswers.choice.get(question.id);
      if (choice === undefined) throw new JevUnavailableError(new Error(`no answer for ${question.id}`));
      return { questionId: question.id, inputHash: `choice-${question.id}`, choice, cached: false };
    },
  };
});

import { parseSiteChangePayload } from "../../../app/lib/site-change";
import {
  CHUNK_SIZE,
  countCovered,
  PAGES_PER_COMPETITOR,
  planSweep,
  sweepItem,
} from "../../../app/lib/site/sweep.server";
import type { SweepItem } from "../../../app/lib/site/sweep.server";

const USER = "user-sweep-scope";
const WS = "ws-sweep-scope";
const NOW = "2026-09-24T02:00:00Z";

const PAD =
  "Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.";

const BEFORE_HTML = `<!doctype html><html><body><h1>Rival</h1><p>Plans start at ten dollars a month.</p><p>${PAD}</p></body></html>`;
const AFTER_HTML = `<!doctype html><html><body><h1>Rival</h1><p>Plans start at twelve dollars a month. New: team seats.</p><p>${PAD}</p></body></html>`;

const readHolder = { html: "" };
const calls: string[] = [];

const seedEntity = (id: string, role: "self" | "competitor", domain: string, state: "on" | "off") =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, WS, role, domain, `${role}-${domain}`, state, NOW)
    .run();

const seedPage = (id: string, entityId: string, url: string, role: string) =>
  env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, title, role, discovered_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, entityId, url, `${role} page`, role, NOW)
    .run();

const seedWatch = (id: string, entityId: string, targetKey: string) =>
  env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key)
     VALUES (?, ?, 'src_site_web', ?)`,
  )
    .bind(id, entityId, targetKey)
    .run();

const nextTick = async (name: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { instanceId: name, plannedAt: new Date().toISOString() };
};

const itemFor = (items: readonly SweepItem[], pageId: string): SweepItem => {
  const found = items.find((item) => item.pageId === pageId);
  if (found === undefined) throw new Error(`no planned item for page ${pageId}`);
  return found;
};

const snapshotRow = async (id: string, watchId: string, pageId: string, fetchedAt: string) =>
  env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, watchId, pageId, fetchedAt, `snapshot/site/${watchId}/${id}.txt`, `hash-${id}`)
    .run();

describe("site sweep scopes", () => {
  beforeEach(async () => {
    for (const table of ["signal", "jev_verdict", "snapshot", "watch", "page", "entity", "workspace", '"user"']) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    const listed = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
    await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));
    jevAnswers.noul.clear();
    jevAnswers.choice.clear();

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'sweep-scope@0509.io', 1, ?, ?)`,
    )
      .bind(USER, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Sweep scope', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS, USER, NOW)
      .run();

    await seedEntity("ent-self", "self", "mybrand.com", "on");
    await seedPage("page-self-home", "ent-self", "https://mybrand.com/", "home");
    await seedPage("page-self-blog", "ent-self", "https://mybrand.com/blog", "blog");
    await seedWatch("watch-self-home", "ent-self", "https://mybrand.com/");
    await seedWatch("watch-self-blog", "ent-self", "https://mybrand.com/blog");

    const rivalPages: [string, string, string][] = [
      ["page-rival-news", "https://rival.com/news", "blog"],
      ["page-rival-blog", "https://rival.com/blog", "blog"],
      ["page-rival-guides", "https://rival.com/guides", "blog"],
      ["page-rival-changelog", "https://rival.com/changelog", "blog"],
      ["page-rival-pricing", "https://rival.com/pricing", "pricing"],
      ["page-rival-home", "https://rival.com/", "home"],
    ];
    await seedEntity("ent-rival", "competitor", "rival.com", "on");
    for (const [id, url, role] of rivalPages) await seedPage(id, "ent-rival", url, role);
    for (const [id, url] of rivalPages) await seedWatch(`watch-${id}`, "ent-rival", url);

    await seedEntity("ent-paused", "competitor", "paused.com", "off");
    await seedPage("page-paused-home", "ent-paused", "https://paused.com/", "home");
    await seedWatch("watch-page-paused-home", "ent-paused", "https://paused.com/");

    readHolder.html = BEFORE_HTML;
    calls.length = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      return Promise.resolve(new Response(readHolder.html, { status: 200 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports the chunk size and the competitor page budget", () => {
    expect(CHUNK_SIZE).toBe(10);
    expect(PAGES_PER_COMPETITOR).toBe(4);
  });

  it("plans the self scope as home and pricing pages only", async () => {
    const items = await planSweep("self");
    expect(items.map((item) => [item.entityId, item.url, item.pageRole, item.isSelf])).toEqual([
      ["ent-self", "https://mybrand.com/", "home", true],
    ]);
  });

  it("plans the competitor scope with home first, pricing second, and at most four pages per brand", async () => {
    const items = await planSweep("competitors");
    expect(items).toHaveLength(PAGES_PER_COMPETITOR);
    expect(items.slice(0, 2).map((item) => item.pageRole)).toEqual(["home", "pricing"]);
    expect(items.map((item) => item.entityId)).toEqual(["ent-rival", "ent-rival", "ent-rival", "ent-rival"]);
    expect(items.every((item) => item.isSelf === false)).toBe(true);
    expect(items.map((item) => item.url)).not.toContain("https://paused.com/");
  });

  it("counts covered watches from snapshot rows at or after the given instant", async () => {
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(await countCovered("competitors", since)).toBe(0);

    await snapshotRow("snap-1", "watch-page-rival-home", "page-rival-home", new Date().toISOString());
    expect(await countCovered("competitors", since)).toBe(1);

    await snapshotRow("snap-2", "watch-self-blog", "page-self-blog", new Date().toISOString());
    expect(await countCovered("competitors", since)).toBe(1);
    expect(await countCovered("self", since)).toBe(0);
  });

  it("keeps the first read as the baseline, then writes the mark payload the live readers parse", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");

    const firstItems = await planSweep("competitors");
    const rival = itemFor(firstItems, "page-rival-home");
    expect(await sweepItem(rival, await nextTick("scope-1"))).toBe("first");
    expect(await sweepItem(rival, await nextTick("scope-2"))).toBe("unchanged");

    readHolder.html = AFTER_HTML;
    const changed = itemFor(await planSweep("competitors"), "page-rival-home");
    expect(await sweepItem(changed, await nextTick("scope-3"))).toBe("published");

    const rows = await env.DB.prepare(
      "SELECT entity_id, source_id, kind, aspect, url, payload_json FROM signal WHERE workspace_id = ?",
    )
      .bind(WS)
      .all<{ entity_id: string; source_id: string; kind: string; aspect: string; url: string; payload_json: string }>();
    expect(rows.results).toHaveLength(1);
    const row = rows.results[0];
    if (row === undefined) throw new Error("expected the swept change to file a signal");
    expect(row).toMatchObject({
      entity_id: "ent-rival",
      source_id: "src_site_web",
      kind: "change",
      aspect: "home",
      url: "https://rival.com/",
    });

    const parsed = parseSiteChangePayload(row.payload_json);
    expect(parsed).toMatchObject({
      page: { role: "home", url: "https://rival.com/" },
      wordsAdded: 4,
      wordsRemoved: 1,
    });
    if (parsed === null) throw new Error("expected a parsable site-change payload");
    expect(parsed.before.snapshotId).not.toBe(parsed.after.snapshotId);
    const diff = await env.SNAPSHOTS.get(parsed.diffKey ?? "");
    expect(diff).not.toBeNull();
  });

  it("skips the customer's own page when robots.txt disallows the bot", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      return Promise.resolve(
        url === "https://mybrand.com/robots.txt"
          ? new Response("User-agent: FiveToNineBot\nDisallow: /\n", { status: 200 })
          : new Response(readHolder.html, { status: 200 }),
      );
    });

    const self = itemFor(await planSweep("self"), "page-self-home");
    expect(await sweepItem(self, await nextTick("scope-robots"))).toBe("failed");
    expect(calls).not.toContain("https://mybrand.com/");
  });

  it("runs the chunked sweep through the workflow and pings its monitor once", async () => {
    const id = "sweep-scope-run";
    await using introspector = await introspectWorkflowInstance(env.SITE_SWEEP, id);
    await env.SITE_SWEEP.create({ id, params: { scope: "competitors" } });
    await introspector.waitForStatus("complete");

    expect(calls.filter((call) => call === "https://hc-ping.example/site-sweep")).toHaveLength(1);
    const output = await introspector.getOutput<{ planned: number; covered: number; short: boolean }>();
    expect(output).toMatchObject({ planned: PAGES_PER_COMPETITOR, covered: PAGES_PER_COMPETITOR, short: false });
  });
});
