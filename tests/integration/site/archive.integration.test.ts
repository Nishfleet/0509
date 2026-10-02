import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readSiteWatchSummary } from "../../../app/lib/data/watch.server";
import { readArchiveCopy, waybackStamp } from "../../../app/lib/fetch/archive.server";
import { classifyCompetitorSites } from "../../../app/lib/site/classify-competitors.server";

const USER = "user-archive";
const WS = "ws-archive";
const RIVAL = "ent-archive-rival";
const HOME = "https://archive-rival.com/";
const BASE = "2026-10-02T02:00:00Z";
const PAGE = `<html><head><title>Rival</title></head><body><main><p>${"Rival opens a new flagship store and launches its autumn training range. ".repeat(6)}</p></main></body></html>`;

let run = 0;

function on(): string {
  return new Date(Date.UTC(2026, 10, 10 + run, 2)).toISOString();
}

function snapshotAt(now: string, ageDays: number, status = "200"): string {
  const stamp = waybackStamp(new Date(Date.parse(now) - ageDays * 86_400_000));
  return JSON.stringify({ archived_snapshots: { closest: { available: true, status, timestamp: stamp } } });
}

function stubWeb(options: { availability: string; copy: { status: number; body: string } }): string[] {
  const seen: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push(url);
    if (url.startsWith("https://archive.org/wayback/available")) {
      return Promise.resolve(new Response(options.availability, { headers: { "content-type": "application/json" } }));
    }
    if (url.startsWith("https://web.archive.org/web/")) {
      return Promise.resolve(new Response(options.copy.body, { status: options.copy.status }));
    }
    return Promise.resolve(new Response("denied", { status: 403 }));
  });
  return seen;
}

beforeEach(async () => {
  run += 1;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM watch WHERE entity_id = ?1").bind(RIVAL),
    env.DB.prepare("DELETE FROM page WHERE entity_id = ?1").bind(RIVAL),
    env.DB.prepare("DELETE FROM entity WHERE workspace_id = ?1").bind(WS),
    env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(WS),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(USER),
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(USER, "Owner", `${USER}@0509.io`, BASE),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)").bind(
      WS,
      USER,
      BASE,
    ),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'competitor', 'archive-rival.com', 'Rival', '{}', 'auto', 'on', ?3)",
    ).bind(RIVAL, WS, BASE),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public archive copy of a page that blocks us", () => {
  it("reads a snapshot taken within three days and marks it as an archive copy", async () => {
    const now = on();
    const seen = stubWeb({ availability: snapshotAt(now, 1), copy: { status: 200, body: PAGE } });
    const read = await readArchiveCopy(HOME, new Date(now));
    expect(read).toMatchObject({ ok: true, fromArchive: true, status: 200 });
    expect(seen.some((url) => url.includes("id_/https://archive-rival.com/"))).toBe(true);
  });

  it("refuses a snapshot older than three days without downloading it", async () => {
    const now = on();
    const seen = stubWeb({ availability: snapshotAt(now, 4), copy: { status: 200, body: PAGE } });
    expect(await readArchiveCopy(HOME, new Date(now))).toBeNull();
    expect(seen.some((url) => url.startsWith("https://web.archive.org/"))).toBe(false);
  });

  it("refuses a snapshot that was itself an error page", async () => {
    const now = on();
    stubWeb({ availability: snapshotAt(now, 1, "403"), copy: { status: 200, body: PAGE } });
    expect(await readArchiveCopy(HOME, new Date(now))).toBeNull();
  });

  it("refuses an archive copy with no readable text", async () => {
    const now = on();
    stubWeb({ availability: snapshotAt(now, 1), copy: { status: 200, body: "<html><body></body></html>" } });
    expect(await readArchiveCopy(HOME, new Date(now))).toBeNull();
  });

  it("keeps a blocked rival readable: not deferred, no note", async () => {
    const now = on();
    stubWeb({ availability: snapshotAt(now, 2), copy: { status: 200, body: PAGE } });
    await classifyCompetitorSites(now);
    const home = await env.DB.prepare("SELECT deferred_at FROM page WHERE entity_id = ?1 AND role = 'home'")
      .bind(RIVAL)
      .first<{ deferred_at: string | null }>();
    expect(home?.deferred_at).toBeNull();
    expect((await readSiteWatchSummary(WS, RIVAL)).unreadable).toBe(false);
  });

  it("still says the site blocks us when the archive copy is too old", async () => {
    const now = on();
    stubWeb({ availability: snapshotAt(now, 6), copy: { status: 200, body: PAGE } });
    await classifyCompetitorSites(now);
    expect((await readSiteWatchSummary(WS, RIVAL)).unreadable).toBe(true);
  });
});
