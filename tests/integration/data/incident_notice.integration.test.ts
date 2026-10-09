import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { claimIncidentNotice } from "../../../app/lib/data/incident_notice.server";

const NOW = "2026-09-25T00:00:00Z";
const USER = "user-incident-notice";
const WORKSPACE = "ws-incident-notice";
const ENTITY = "ent-incident-notice";
const PAGE = "page-incident-notice";
const DOMAIN = "notice.example";
const OPEN_INCIDENT = "inc-notice-open";
const CLOSED_INCIDENT = "inc-notice-closed";
const MORNING = "2026-09-25T08:00:00.000Z";
const LATE_MORNING = "2026-09-25T10:00:00.000Z";
const EVENING = "2026-09-25T18:30:00.000Z";
const SENT_ON = "2026-09-25";

const cleanTables = ["incident_notice", "incident", "page", "entity", "workspace"];

describe("claimIncidentNotice (0509#7144)", () => {
  beforeEach(async () => {
    for (const table of cleanTables) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', ?, 1, ?, ?)`,
    )
      .bind(USER, "notice@0509.io", NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Notice', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WORKSPACE, USER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
       VALUES (?, ?, 'self', ?, '{}', 'manual', 'on', ?)`,
    )
      .bind(ENTITY, WORKSPACE, DOMAIN, NOW)
      .run();
    await env.DB.prepare(`INSERT INTO page (id, entity_id, url, discovered_at) VALUES (?, ?, ?, ?)`)
      .bind(PAGE, ENTITY, `https://${DOMAIN}/`, NOW)
      .run();
  });

  const seedIncident = async (id: string, openedAt: string, closedAt: string | null) => {
    await env.DB.prepare(
      `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at, closed_at)
       VALUES (?, ?, ?, ?, 'error', ?, ?)`,
    )
      .bind(id, WORKSPACE, ENTITY, PAGE, openedAt, closedAt)
      .run();
  };

  const readNotice = async (id: string) => {
    return env.DB.prepare(
      `SELECT id, incident_id, page_id, sent_on, sent_at, is_resolution FROM incident_notice WHERE id = ?`,
    )
      .bind(id)
      .first<{
        id: string;
        incident_id: string;
        page_id: string;
        sent_on: string;
        sent_at: string;
        is_resolution: number;
      }>();
  };

  it("inserts a notice and returns the new row id", async () => {
    await seedIncident(OPEN_INCIDENT, MORNING, null);

    const claimed = await claimIncidentNotice(env.DB, {
      incidentId: OPEN_INCIDENT,
      pageId: PAGE,
      now: new Date(MORNING),
      isResolution: 0,
    });

    expect(claimed).not.toBeNull();
    expect(typeof claimed?.id).toBe("string");
    expect(claimed?.id.length).toBeGreaterThan(0);

    const row = await readNotice(claimed?.id ?? "");
    expect(row).toEqual({
      id: claimed?.id,
      incident_id: OPEN_INCIDENT,
      page_id: PAGE,
      sent_on: SENT_ON,
      sent_at: MORNING,
      is_resolution: 0,
    });
  });

  it("re-claiming by the same incident within the day updates and returns the same id", async () => {
    await seedIncident(OPEN_INCIDENT, MORNING, null);
    const first = await claimIncidentNotice(env.DB, {
      incidentId: OPEN_INCIDENT,
      pageId: PAGE,
      now: new Date(MORNING),
      isResolution: 0,
    });

    const second = await claimIncidentNotice(env.DB, {
      incidentId: OPEN_INCIDENT,
      pageId: PAGE,
      now: new Date(EVENING),
      isResolution: 0,
    });

    expect(second?.id).toBe(first?.id);
    const row = await readNotice(second?.id ?? "");
    expect(row?.sent_at).toBe(EVENING);
  });

  it("rejects a conflicting claim from a different incident", async () => {
    await seedIncident(CLOSED_INCIDENT, MORNING, LATE_MORNING);
    await seedIncident(OPEN_INCIDENT, LATE_MORNING, null);
    const first = await claimIncidentNotice(env.DB, {
      incidentId: CLOSED_INCIDENT,
      pageId: PAGE,
      now: new Date(MORNING),
      isResolution: 0,
    });
    expect(first).not.toBeNull();

    const conflicting = await claimIncidentNotice(env.DB, {
      incidentId: OPEN_INCIDENT,
      pageId: PAGE,
      now: new Date(EVENING),
      isResolution: 0,
    });

    expect(conflicting).toBeNull();
    const row = await readNotice(first?.id ?? "");
    expect(row?.incident_id).toBe(CLOSED_INCIDENT);
  });
});
