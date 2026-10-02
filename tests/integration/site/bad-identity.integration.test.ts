import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readEntitiesWithoutHomePage } from "../../../app/lib/data/page.server";
import { readUnwatchedEntities } from "../../../app/lib/data/watch.server";
import { ensureHomePages } from "../../../app/lib/site/sweep.server";

const NOW = "2026-10-02T02:00:00Z";
const USER = "user-bad-identity";
const WS = "ws-bad-identity";
const GOOD = "ent-bad-identity-good";
const BAD = "ent-bad-identity-bad";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM entity WHERE workspace_id = ?1").bind(WS),
    env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(WS),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(USER),
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(USER, "Owner", `${USER}@0509.io`, NOW),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)").bind(
      WS,
      USER,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'competitor', 'good-rival.com', 'Good', json_object('url', 'https://good-rival.com/'), 'auto', 'on', ?3)",
    ).bind(GOOD, WS, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'competitor', 'bad-rival.com', 'Bad', 'not json {', 'auto', 'on', ?3)",
    ).bind(BAD, WS, NOW),
  ]);
});

describe("one unreadable identity row", () => {
  it("does not stop the read of entities without a home page", async () => {
    const rows = (await readEntitiesWithoutHomePage()).filter((row) => row.id === GOOD || row.id === BAD);
    expect(rows.map((row) => [row.id, row.url])).toEqual([
      [BAD, null],
      [GOOD, "https://good-rival.com/"],
    ]);
  });

  it("does not stop the read of unwatched entities", async () => {
    const rows = (await readUnwatchedEntities("src-bad-identity")).filter((row) => row.id === GOOD || row.id === BAD);
    expect(rows.map((row) => [row.id, row.url])).toEqual([
      [BAD, null],
      [GOOD, "https://good-rival.com/"],
    ]);
  });

  it("falls back to the domain and logs the entity id only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await ensureHomePages(NOW);
    const logged = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes(BAD));
    warn.mockRestore();
    expect(logged).toEqual([JSON.stringify({ event: "site-sweep.identity-json-invalid", entityId: BAD })]);
    const home = await env.DB.prepare("SELECT url FROM page WHERE entity_id = ?1 AND role = 'home'")
      .bind(BAD)
      .first<{ url: string }>();
    expect(home?.url).toBe("https://bad-rival.com/");
  });
});
