import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * incident_notice uniqueness after 0004 (0509#4357).
 *
 * The shipped key was UNIQUE (page_id, sent_on), which drops a same-day
 * "fixed" notice. The widened key is UNIQUE (page_id, sent_on, is_resolution):
 * one open notice and one resolution notice per page per day, and a second of
 * either still fails the insert.
 */

const USER = "user-incident-notice";
const WS = "ws-incident-notice";
const ENTITY = "ent-incident-notice";
const PAGE = "page-incident-notice";
const INCIDENT = "inc-incident-notice";
const DAY = "2026-09-23";

const seed = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Reader', 'incident-notice@0509.io', 1, '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z')`,
  )
    .bind(USER)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Incident notice', ?, 'UTC', 1, 8, '2026-09-23T00:00:00Z')`,
  )
    .bind(WS, USER)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'self', 'incident-notice.0509.io', '{}', 'manual', 'on', '2026-09-23T00:00:00Z')`,
  )
    .bind(ENTITY, WS)
    .run();
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, discovered_at)
     VALUES (?, ?, 'https://incident-notice.0509.io/', '2026-09-23T00:00:00Z')`,
  )
    .bind(PAGE, ENTITY)
    .run();
  await env.DB.prepare(
    `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at)
     VALUES (?, ?, ?, ?, 'broken', '2026-09-23T00:00:00Z')`,
  )
    .bind(INCIDENT, WS, ENTITY, PAGE)
    .run();
};

const insertNotice = (id: string, isResolution: 0 | 1) =>
  env.DB.prepare(
    `INSERT INTO incident_notice (id, incident_id, page_id, sent_on, sent_at, is_resolution)
     VALUES (?, ?, ?, ?, '2026-09-23T01:00:00Z', ?)`,
  )
    .bind(id, INCIDENT, PAGE, DAY, isResolution)
    .run();

const noticeCount = async () => {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM incident_notice WHERE page_id = ?",
  )
    .bind(PAGE)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

describe("incident_notice uniqueness (0509#4357)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM incident_notice");
    await env.DB.exec("DELETE FROM incident");
    await env.DB.exec("DELETE FROM page");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await seed();
  });

  it("(a) rejects a second open notice for the same page and day", async () => {
    await insertNotice("notice-open-1", 0);
    await expect(insertNotice("notice-open-2", 0)).rejects.toThrow(/UNIQUE/);
  });

  it("(b) accepts an open notice and a same-day resolution", async () => {
    await insertNotice("notice-open", 0);
    await insertNotice("notice-fixed", 1);
    expect(await noticeCount()).toBe(2);
  });

  it("(c) rejects a second resolution for the same page and day", async () => {
    await insertNotice("notice-fixed-1", 1);
    await expect(insertNotice("notice-fixed-2", 1)).rejects.toThrow(/UNIQUE/);
  });
});
