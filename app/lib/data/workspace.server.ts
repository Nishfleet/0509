import { env } from "cloudflare:workers";

import { canonicalTimezone } from "../timezone";

const SELECT_WORKSPACE_TIMEZONE = "SELECT timezone FROM workspace WHERE id = ?";

export async function readWorkspaceTimezone(workspaceId: string): Promise<string> {
  const row = await env.DB.prepare(SELECT_WORKSPACE_TIMEZONE)
    .bind(workspaceId)
    .first<{ timezone: string | null }>();
  return canonicalTimezone(row?.timezone);
}

const SELECT_WORKSPACE_WATCHES = `SELECT w.id FROM watch w
JOIN entity e ON e.id = w.entity_id
WHERE e.workspace_id = ?
ORDER BY w.id`;

const DELETE_WORKSPACE = "DELETE FROM workspace WHERE id = ?";

const SELECT_WORKSPACE_BY_OWNER = `SELECT id FROM workspace WHERE owner_user_id = ?
ORDER BY created_at LIMIT 1`;

export async function readWorkspaceIdForOwner(userId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_WORKSPACE_BY_OWNER).bind(userId).first<{ id: string }>();
  return row?.id ?? null;
}

interface BoundStatement {
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface WorkspaceDb {
  prepare(query: string): {
    bind(...values: unknown[]): BoundStatement;
  };
}

const INSERT_WORKSPACE = `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
VALUES (?, ?, ?, ?, 1, 8, ?)
ON CONFLICT(id) DO NOTHING`;

const FILL_TIMEZONE = `UPDATE workspace SET timezone = ? WHERE id = ? AND timezone = 'UTC'`;

export async function insertWorkspace(
  db: WorkspaceDb,
  input: { id: string; name: string; ownerUserId: string; timezone: string; createdAt: string },
): Promise<void> {
  await db
    .prepare(INSERT_WORKSPACE)
    .bind(input.id, input.name, input.ownerUserId, input.timezone, input.createdAt)
    .run();
}

export async function fillWorkspaceTimezone(db: WorkspaceDb, id: string, timezone: string): Promise<void> {
  await db.prepare(FILL_TIMEZONE).bind(timezone, id).run();
}

export async function readWorkspaceR2Prefixes(workspaceId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(SELECT_WORKSPACE_WATCHES)
    .bind(workspaceId)
    .all<{ id: string }>();
  return [`card/${workspaceId}/`, ...results.map((row) => `snapshot/site/${row.id}/`)];
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await env.DB.prepare(DELETE_WORKSPACE).bind(workspaceId).run();
}

const SELECT_SCHEDULE_BY_OWNER = `SELECT id, timezone, brief_weekday, brief_hour FROM workspace WHERE owner_user_id = ?
ORDER BY created_at LIMIT 1`;

const UPDATE_SCHEDULE = `UPDATE workspace SET timezone = ?, brief_weekday = ?, brief_hour = ? WHERE id = ?`;

export interface OwnedSchedule {
  workspaceId: string;
  schedule: { timezone: string; weekday: number; hour: number };
}

export async function readBriefScheduleForOwner(userId: string): Promise<OwnedSchedule | null> {
  const row = await env.DB.prepare(SELECT_SCHEDULE_BY_OWNER)
    .bind(userId)
    .first<{ id: string; timezone: string; brief_weekday: number; brief_hour: number }>();
  if (row === null) return null;
  return {
    workspaceId: row.id,
    schedule: { timezone: row.timezone, weekday: row.brief_weekday, hour: row.brief_hour },
  };
}

export async function updateBriefSchedule(
  workspaceId: string,
  schedule: { timezone: string; weekday: number; hour: number },
): Promise<void> {
  await env.DB.prepare(UPDATE_SCHEDULE)
    .bind(schedule.timezone, schedule.weekday, schedule.hour, workspaceId)
    .run();
}

const SELECT_OWN_SITE_ALERTS = "SELECT own_site_alerts FROM workspace WHERE id = ?";

const UPDATE_OWN_SITE_ALERTS = "UPDATE workspace SET own_site_alerts = ? WHERE id = ?";

export async function readOwnSiteAlerts(workspaceId: string): Promise<boolean> {
  const row = await env.DB.prepare(SELECT_OWN_SITE_ALERTS)
    .bind(workspaceId)
    .first<{ own_site_alerts: number | null }>();
  return (row?.own_site_alerts ?? 1) === 1;
}

export async function setOwnSiteAlerts(workspaceId: string, ownSiteAlerts: boolean): Promise<void> {
  await env.DB.prepare(UPDATE_OWN_SITE_ALERTS).bind(ownSiteAlerts ? 1 : 0, workspaceId).run();
}
