import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readOpenIncidents } from "../../app/lib/data/incident.server";
import {
  acknowledgeIncidentAlert,
  insertIncidentAlert,
  readOpenIncidentBlock,
  readOwnSiteIncidents,
} from "../../app/lib/data/alert.server";

const USER = "user-incident-block";
const WS = "ws-incident-block";
const OTHER_USER = "user-incident-block-other";
const OTHER_WS = "ws-incident-block-other";
const ENTITY = "ent-incident-block";
const OTHER_ENTITY = "ent-incident-block-other";
const PAGE = "page-incident-block";
const OTHER_PAGE = "page-incident-block-other";
const DOMAIN = "block.example";
const OTHER_DOMAIN = "other.example";
const OPEN_INCIDENT = "inc-block-open";
const CLOSED_INCIDENT = "inc-block-closed";
const OTHER_INCIDENT = "inc-block-other-ws";
const KIND = "error";
const OPENED_AT = "2026-09-25T10:15:00.000Z";
const OTHER_OPENED_AT = "2026-09-25T11:30:00.000Z";
const ACKED_AT = "2026-09-25T12:05:00.000Z";

const seedUser = async (id: string, email: string) => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Block', ?, 1, '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z')`,
  )
    .bind(id, email)
    .run();
};

const seedWorkspace = async (id: string, ownerUserId: string) => {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Incident block', ?, 'UTC', 1, 8, '2026-09-25T00:00:00Z')`,
  )
    .bind(id, ownerUserId)
    .run();
};

const seedEntity = async (id: string, workspaceId: string, domain: string) => {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'self', ?, '{}', 'manual', 'on', '2026-09-25T00:00:00Z')`,
  )
    .bind(id, workspaceId, domain)
    .run();
};

const seedPage = async (id: string, entityId: string, domain: string) => {
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, discovered_at)
     VALUES (?, ?, ?, '2026-09-25T00:00:00Z')`,
  )
    .bind(id, entityId, `https://${domain}/`)
    .run();
};

const seedIncident = async (
  id: string,
  workspaceId: string,
  entityId: string,
  pageId: string,
  openedAt: string,
  closedAt: string | null,
) => {
  await env.DB.prepare(
    `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, workspaceId, entityId, pageId, KIND, openedAt, closedAt)
    .run();
};

const seedIncidentAlert = async (
  incidentId: string,
  workspaceId: string,
  entityId: string,
  pageId: string,
  title: string,
  createdAt: string,
) => {
  await insertIncidentAlert(env.DB, {
    incidentId,
    workspaceId,
    entityId,
    pageId,
    title,
    createdAt,
  });
};

const cleanTables = ["alert", "incident", "page", "entity", "workspace"];

describe("open incident block (0509#5142)", () => {
  beforeEach(async () => {
    for (const table of cleanTables) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await seedUser(USER, "blocker@0509.io");
    await seedUser(OTHER_USER, "other-blocker@0509.io");
    await seedWorkspace(WS, USER);
    await seedWorkspace(OTHER_WS, OTHER_USER);
    await seedEntity(ENTITY, WS, DOMAIN);
    await seedEntity(OTHER_ENTITY, OTHER_WS, OTHER_DOMAIN);
    await seedPage(PAGE, ENTITY, DOMAIN);
    await seedPage(OTHER_PAGE, OTHER_ENTITY, OTHER_DOMAIN);
  });

  it("(a) reads the workspace's open, unacknowledged own-site incident", async () => {
    await seedIncident(OPEN_INCIDENT, WS, ENTITY, PAGE, OPENED_AT, null);
    await seedIncidentAlert(OPEN_INCIDENT, WS, ENTITY, PAGE, "Checkout 500", OPENED_AT);

    const block = await readOpenIncidentBlock(env.DB, WS);

    expect(block).toEqual({
      alert_id: `incident-${OPEN_INCIDENT}`,
      title: "Checkout 500",
      kind: KIND,
      url: `https://${DOMAIN}/`,
      opened_at: OPENED_AT,
    });
  });

  it("(b) returns null once that alert is acknowledged", async () => {
    await seedIncident(OPEN_INCIDENT, WS, ENTITY, PAGE, OPENED_AT, null);
    await seedIncidentAlert(OPEN_INCIDENT, WS, ENTITY, PAGE, "Checkout 500", OPENED_AT);
    expect(await readOpenIncidentBlock(env.DB, WS)).not.toBeNull();

    await acknowledgeIncidentAlert(env.DB, WS, `incident-${OPEN_INCIDENT}`, ACKED_AT);

    expect(await readOpenIncidentBlock(env.DB, WS)).toBeNull();
    const row = await env.DB.prepare(`SELECT status, read_at FROM alert WHERE id = ?`)
      .bind(`incident-${OPEN_INCIDENT}`)
      .first<{ status: string; read_at: string }>();
    expect(row?.status).toBe("acknowledged");
    expect(row?.read_at).toBe(ACKED_AT);
  });

  it("(c) returns null for a closed incident", async () => {
    await seedIncident(CLOSED_INCIDENT, WS, ENTITY, PAGE, OPENED_AT, "2026-09-25T12:00:00.000Z");
    await seedIncidentAlert(CLOSED_INCIDENT, WS, ENTITY, PAGE, "Checkout 500", OPENED_AT);

    expect(await readOpenIncidentBlock(env.DB, WS)).toBeNull();
  });

  it("(d) returns null for another workspace's open incident", async () => {
    await seedIncident(OTHER_INCIDENT, OTHER_WS, OTHER_ENTITY, OTHER_PAGE, OTHER_OPENED_AT, null);
    await seedIncidentAlert(
      OTHER_INCIDENT,
      OTHER_WS,
      OTHER_ENTITY,
      OTHER_PAGE,
      "Pricing 500",
      OTHER_OPENED_AT,
    );

    expect(await readOpenIncidentBlock(env.DB, WS)).toBeNull();
    expect(await readOpenIncidentBlock(env.DB, OTHER_WS)).toEqual({
      alert_id: `incident-${OTHER_INCIDENT}`,
      title: "Pricing 500",
      kind: KIND,
      url: `https://${OTHER_DOMAIN}/`,
      opened_at: OTHER_OPENED_AT,
    });
  });

  it("(e) acknowledging leaves the incident open, in the feed and on the re-check list (0509#4115)", async () => {
    await seedIncident(OPEN_INCIDENT, WS, ENTITY, PAGE, OPENED_AT, null);
    await seedIncidentAlert(OPEN_INCIDENT, WS, ENTITY, PAGE, "Checkout 500", OPENED_AT);
    await acknowledgeIncidentAlert(env.DB, WS, `incident-${OPEN_INCIDENT}`, ACKED_AT);

    expect(await readOpenIncidentBlock(env.DB, WS)).toBeNull();
    const row = await env.DB.prepare(`SELECT closed_at FROM incident WHERE id = ?`)
      .bind(OPEN_INCIDENT)
      .first<{ closed_at: string | null }>();
    expect(row?.closed_at).toBeNull();

    expect(await readOwnSiteIncidents(env.DB, WS)).toEqual([
      {
        id: `incident-${OPEN_INCIDENT}`,
        title: "Checkout 500",
        created_at: OPENED_AT,
        closed_at: null,
      },
    ]);

    expect((await readOpenIncidents())[PAGE]).toBe(OPEN_INCIDENT);
  });

  it("(f) picks the newest open incident when a workspace has more than one", async () => {
    const secondPage = "page-incident-block-second";
    const secondIncident = "inc-block-newer";
    await seedPage(secondPage, ENTITY, "second.example");
    await seedIncident(OPEN_INCIDENT, WS, ENTITY, PAGE, OPENED_AT, null);
    await seedIncidentAlert(OPEN_INCIDENT, WS, ENTITY, PAGE, "Checkout 500", OPENED_AT);
    await seedIncident(secondIncident, WS, ENTITY, secondPage, OTHER_OPENED_AT, null);
    await seedIncidentAlert(secondIncident, WS, ENTITY, secondPage, "Pricing 500", OTHER_OPENED_AT);

    const block = await readOpenIncidentBlock(env.DB, WS);

    expect(block?.alert_id).toBe(`incident-${secondIncident}`);
    expect(block?.url).toBe("https://second.example/");
    expect(block?.opened_at).toBe(OTHER_OPENED_AT);
  });
});
