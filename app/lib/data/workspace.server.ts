import { env } from "cloudflare:workers";

import { entitledTier, resolveEntitlements } from "../billing/entitlements";
import { canonicalTimezone } from "../timezone";

const SELECT_WORKSPACE_TIMEZONE = "SELECT timezone FROM workspace WHERE id = ?";

export async function readWorkspaceTimezone(workspaceId: string): Promise<string> {
  const row = await env.DB.prepare(SELECT_WORKSPACE_TIMEZONE).bind(workspaceId).first<{ timezone: string | null }>();
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

const SELECT_WORKSPACE_LANDING = `SELECT w.id, w.timezone, e.id AS self_id, r.input_raw, r.watching_started_at
FROM workspace w
LEFT JOIN entity e ON e.id = (
  SELECT id FROM entity WHERE workspace_id = w.id AND role = 'self' LIMIT 1
)
LEFT JOIN onboarding_run r ON r.id = (
  SELECT id FROM onboarding_run WHERE workspace_id = w.id ORDER BY started_at ASC LIMIT 1
)
WHERE w.owner_user_id = ?
ORDER BY w.created_at ASC
LIMIT 1`;

export interface WorkspaceLandingRow {
  id: string;
  timezone: string;
  self_id: string | null;
  input_raw: string | null;
  watching_started_at: string | null;
}

export async function readWorkspaceLanding(db: WorkspaceDb, userId: string): Promise<WorkspaceLandingRow | null> {
  return db.prepare(SELECT_WORKSPACE_LANDING).bind(userId).first<WorkspaceLandingRow>();
}

interface BoundStatement {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface WorkspaceDb {
  prepare(query: string): {
    bind(...values: unknown[]): BoundStatement;
  };
}

export class WorkspaceCapError extends Error {
  constructor() {
    super("workspace cap");
    this.name = "WorkspaceCapError";
  }
}

const INSERT_WORKSPACE = `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture)
SELECT ?, ?, ?, ?, 1, 8, ?, ?
WHERE (
  SELECT count(*) FROM workspace WHERE owner_user_id = ?
) = 0
OR ? = 1
OR (
  SELECT count(*) FROM workspace WHERE owner_user_id = ?
) < ?
ON CONFLICT(id) DO NOTHING`;

const FILL_TIMEZONE = `UPDATE workspace SET timezone = ? WHERE id = ? AND timezone = 'UTC'`;

const SELECT_WORKSPACE_ID = "SELECT id FROM workspace WHERE id = ?";

const SELECT_OWNER_PLANS = `SELECT p.tier AS tier, p.status AS status, p.current_period_end AS current_period_end, p.limits_json AS limits_json
FROM workspace w
JOIN plan p ON p.workspace_id = w.id
WHERE w.owner_user_id = ?`;

interface OwnerPlanRow {
  tier: string;
  status: string;
  current_period_end: string | null;
  limits_json: string;
}

function widerWorkspacesMax(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  return left > right ? left : right;
}

async function ownerWorkspacesMax(db: WorkspaceDb, ownerUserId: string): Promise<number | null> {
  const { results } = await db.prepare(SELECT_OWNER_PLANS).bind(ownerUserId).all<OwnerPlanRow>();
  if (results.length === 0) return resolveEntitlements("scout", "{}").workspaces_max;
  const now = new Date();
  return results
    .map((row) =>
      resolveEntitlements(
        entitledTier({ tier: row.tier, status: row.status, currentPeriodEnd: row.current_period_end }, now),
        row.limits_json,
      ).workspaces_max,
    )
    .reduce(widerWorkspacesMax);
}

export async function insertWorkspace(
  db: WorkspaceDb,
  input: { id: string; name: string; ownerUserId: string; timezone: string; createdAt: string; fixture: boolean },
): Promise<void> {
  const cap = await ownerWorkspacesMax(db, input.ownerUserId);
  const result = await db
    .prepare(INSERT_WORKSPACE)
    .bind(
      input.id,
      input.name,
      input.ownerUserId,
      input.timezone,
      input.createdAt,
      input.fixture ? 1 : 0,
      input.ownerUserId,
      cap === null ? 1 : 0,
      input.ownerUserId,
      cap ?? 0,
    )
    .run();
  if (result.meta.changes === 1) return;
  const existing = await db.prepare(SELECT_WORKSPACE_ID).bind(input.id).first<{ id: string }>();
  if (existing !== null) return;
  throw new WorkspaceCapError();
}

export async function fillWorkspaceTimezone(db: WorkspaceDb, id: string, timezone: string): Promise<boolean> {
  const result = await db.prepare(FILL_TIMEZONE).bind(timezone, id).run();
  return result.meta.changes > 0;
}

const REVERT_TIMEZONE = `UPDATE workspace SET timezone = 'UTC' WHERE id = ? AND timezone = ?`;

export async function revertWorkspaceTimezone(db: WorkspaceDb, id: string, timezone: string): Promise<void> {
  await db.prepare(REVERT_TIMEZONE).bind(id, timezone).run();
}

export async function readWorkspaceR2Prefixes(workspaceId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(SELECT_WORKSPACE_WATCHES).bind(workspaceId).all<{ id: string }>();
  return [
    `card/${workspaceId}/`,
    ...results.flatMap((row) => [`snapshot/site/${row.id}/`, `snapshot/hiring/${row.id}/`, `snapshot/feed/${row.id}/`]),
  ];
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await env.DB.prepare(DELETE_WORKSPACE).bind(workspaceId).run();
}

const SELECT_SCHEDULE_BY_OWNER = `SELECT id, timezone, brief_weekday, brief_hour, brief_paused_at FROM workspace WHERE owner_user_id = ?
ORDER BY created_at LIMIT 1`;

const UPDATE_SCHEDULE = `UPDATE workspace SET timezone = ?, brief_weekday = ?, brief_hour = ? WHERE id = ?`;

export interface OwnedSchedule {
  workspaceId: string;
  schedule: { timezone: string; weekday: number; hour: number; pausedAt: string | null };
}

export async function readBriefScheduleForOwner(userId: string): Promise<OwnedSchedule | null> {
  const row = await env.DB.prepare(SELECT_SCHEDULE_BY_OWNER).bind(userId).first<{
    id: string;
    timezone: string;
    brief_weekday: number;
    brief_hour: number;
    brief_paused_at: string | null;
  }>();
  if (row === null) return null;
  return {
    workspaceId: row.id,
    schedule: {
      timezone: row.timezone,
      weekday: row.brief_weekday,
      hour: row.brief_hour,
      pausedAt: row.brief_paused_at,
    },
  };
}

export async function updateBriefSchedule(
  workspaceId: string,
  schedule: { timezone: string; weekday: number; hour: number },
): Promise<void> {
  await env.DB.prepare(UPDATE_SCHEDULE).bind(schedule.timezone, schedule.weekday, schedule.hour, workspaceId).run();
}

const UPDATE_BRIEF_PAUSED = "UPDATE workspace SET brief_paused_at = ? WHERE id = ?";

export async function setBriefPaused(workspaceId: string, pausedAt: string | null): Promise<void> {
  await env.DB.prepare(UPDATE_BRIEF_PAUSED).bind(pausedAt, workspaceId).run();
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
  await env.DB.prepare(UPDATE_OWN_SITE_ALERTS)
    .bind(ownSiteAlerts ? 1 : 0, workspaceId)
    .run();
}

const SELECT_CHANGE_ALERTS = "SELECT change_alerts FROM workspace WHERE id = ?";

const UPDATE_CHANGE_ALERTS = "UPDATE workspace SET change_alerts = ? WHERE id = ?";

export async function readChangeAlerts(workspaceId: string): Promise<boolean> {
  const row = await env.DB.prepare(SELECT_CHANGE_ALERTS).bind(workspaceId).first<{ change_alerts: number | null }>();
  return (row?.change_alerts ?? 1) === 1;
}

export async function setChangeAlerts(workspaceId: string, changeAlerts: boolean): Promise<void> {
  await env.DB.prepare(UPDATE_CHANGE_ALERTS)
    .bind(changeAlerts ? 1 : 0, workspaceId)
    .run();
}
