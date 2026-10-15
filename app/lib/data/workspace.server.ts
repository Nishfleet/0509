import { env } from "cloudflare:workers";
import { z } from "zod";

import { resolveEntitlements } from "../billing/entitlements";
import { entitledTier } from "../billing/subscription-state";
import { MAX_CLIENT_BRANDS } from "../client-brands";
import { canonicalTimezone } from "../timezone";
import { activeFirstOrder, coveredWorkspace, governingWorkspace } from "./active-workspace";

const SELECT_WORKSPACE_TIMEZONE = "SELECT timezone FROM workspace WHERE id = ?";

const readWorkspaceTimezoneRow = z.object({ timezone: z.string() });

export async function readWorkspaceTimezone(workspaceId: string): Promise<string> {
  const row = readWorkspaceTimezoneRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_WORKSPACE_TIMEZONE).bind(workspaceId).first());
  return canonicalTimezone(row?.timezone);
}

const SELECT_WORKSPACE_WATCHES = `SELECT w.id FROM watch w
JOIN entity e ON e.id = w.entity_id
WHERE e.workspace_id = ?
ORDER BY w.id`;

const DELETE_WORKSPACE = "DELETE FROM workspace WHERE id = ?";

const SELECT_WORKSPACE_BY_OWNER = `SELECT w.id AS id FROM workspace w WHERE w.owner_user_id = ?1
ORDER BY ${activeFirstOrder("?1")} LIMIT 1`;

const workspaceIdRow = z.object({ id: z.string() });

export async function readWorkspaceIdForOwner(userId: string): Promise<string | null> {
  const row = workspaceIdRow.nullable().parse(await env.DB.prepare(SELECT_WORKSPACE_BY_OWNER).bind(userId).first());
  return row?.id ?? null;
}

const SELECT_WORKSPACE_LANDING = `SELECT w.id, w.timezone, e.id AS self_id, r.input_raw, r.watching_started_at,
       p.status AS plan_status, p.current_period_end AS plan_current_period_end
FROM workspace w
LEFT JOIN entity e ON e.id = (
  SELECT id FROM entity WHERE workspace_id = w.id AND role = 'self' LIMIT 1
)
LEFT JOIN onboarding_run r ON r.id = (
  SELECT id FROM onboarding_run WHERE workspace_id = w.id ORDER BY started_at ASC LIMIT 1
)
LEFT JOIN plan p ON p.workspace_id = ${governingWorkspace("w.id")}
WHERE w.owner_user_id = ?1
ORDER BY ${activeFirstOrder("?1", "w.id", "w.created_at")}
LIMIT 1`;

const workspaceLandingRow = z.object({
  id: z.string(),
  timezone: z.string(),
  self_id: z.string().nullable(),
  input_raw: z.string().nullable(),
  watching_started_at: z.string().nullable(),
  plan_status: z.string().nullable(),
  plan_current_period_end: z.string().nullable(),
});

export type WorkspaceLandingRow = z.infer<typeof workspaceLandingRow>;

export async function readWorkspaceLanding(db: WorkspaceDb, userId: string): Promise<WorkspaceLandingRow | null> {
  return workspaceLandingRow.nullable().parse(await db.prepare(SELECT_WORKSPACE_LANDING).bind(userId).first());
}

const ownerPlanRow = z.object({
  tier: z.string(),
  status: z.string(),
  current_period_end: z.string().nullable(),
  limits_json: z.string(),
});

type OwnerPlanRow = z.infer<typeof ownerPlanRow>;

interface BoundStatement {
  first<T>(): Promise<T | null>;
  all(): Promise<{ results: OwnerPlanRow[] }>;
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

const INSERT_WORKSPACE = `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture, parent_workspace_id)
SELECT ?1, ?2, ?3, ?4, 1, 8, ?5, ?6, ?7
WHERE (?8 = 1 OR (SELECT count(*) FROM workspace WHERE owner_user_id = ?3) < ?9)
AND (?7 IS NULL OR (SELECT count(*) FROM workspace WHERE parent_workspace_id = ?7) < ?10)
ON CONFLICT(id) DO NOTHING`;

const FILL_TIMEZONE = `UPDATE workspace SET timezone = ? WHERE id = ? AND timezone = 'UTC'`;

const SELECT_WORKSPACE_ID = "SELECT id FROM workspace WHERE id = ?";

const SELECT_OWNER_PLANS = `SELECT p.tier AS tier, p.status AS status, p.current_period_end AS current_period_end, p.limits_json AS limits_json
FROM workspace w
JOIN plan p ON p.workspace_id = w.id
WHERE w.owner_user_id = ?`;

function widerWorkspacesMax(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  return left > right ? left : right;
}

async function ownerWorkspacesMax(db: WorkspaceDb, ownerUserId: string): Promise<number | null> {
  const { results } = await db.prepare(SELECT_OWNER_PLANS).bind(ownerUserId).all();
  const plans = z.array(ownerPlanRow).parse(results);
  if (plans.length === 0) return resolveEntitlements("scout", "{}").workspaces_max;
  const now = new Date();
  return plans
    .map(
      (row) =>
        resolveEntitlements(
          entitledTier({ tier: row.tier, status: row.status, currentPeriodEnd: row.current_period_end }, now),
          row.limits_json,
        ).workspaces_max,
    )
    .reduce(widerWorkspacesMax);
}

export async function insertWorkspace(
  db: WorkspaceDb,
  input: {
    id: string;
    name: string;
    ownerUserId: string;
    timezone: string;
    createdAt: string;
    fixture: boolean;
    parentWorkspaceId?: string | null;
  },
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
      input.parentWorkspaceId ?? null,
      cap === null ? 1 : 0,
      cap ?? 0,
      MAX_CLIENT_BRANDS,
    )
    .run();
  if (result.meta.changes === 1) return;
  const existing = workspaceIdRow.nullable().parse(await db.prepare(SELECT_WORKSPACE_ID).bind(input.id).first());
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

const readWorkspaceR2PrefixesRow = z.object({ id: z.string() });
const readWorkspaceR2PrefixesRows = z.array(readWorkspaceR2PrefixesRow);

export async function readWorkspaceR2Prefixes(workspaceId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(SELECT_WORKSPACE_WATCHES).bind(workspaceId).all();
  return [
    `card/${workspaceId}/`,
    ...readWorkspaceR2PrefixesRows
      .parse(results)
      .flatMap((row) => [`snapshot/site/${row.id}/`, `snapshot/hiring/${row.id}/`, `snapshot/feed/${row.id}/`]),
  ];
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await env.DB.prepare(DELETE_WORKSPACE).bind(workspaceId).run();
}

const SELECT_SCHEDULE_BY_OWNER = `SELECT w.id AS id, w.timezone AS timezone, w.brief_weekday AS brief_weekday, w.brief_hour AS brief_hour, w.brief_paused_at AS brief_paused_at FROM workspace w WHERE w.owner_user_id = ?1
ORDER BY ${activeFirstOrder("?1")} LIMIT 1`;

const UPDATE_SCHEDULE = `UPDATE workspace SET timezone = ?, brief_weekday = ?, brief_hour = ? WHERE id = ?`;

export interface OwnedSchedule {
  workspaceId: string;
  schedule: { timezone: string; weekday: number; hour: number; pausedAt: string | null };
}

const readBriefScheduleForOwnerRow = z.object({
  id: z.string(),
  timezone: z.string(),
  brief_weekday: z.number(),
  brief_hour: z.number(),
  brief_paused_at: z.string().nullable(),
});

function ownedScheduleFromRow(row: z.infer<typeof readBriefScheduleForOwnerRow>): OwnedSchedule {
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

export async function readBriefScheduleForOwner(userId: string): Promise<OwnedSchedule | null> {
  const row = readBriefScheduleForOwnerRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_SCHEDULE_BY_OWNER).bind(userId).first());
  return row === null ? null : ownedScheduleFromRow(row);
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

const readOwnSiteAlertsRow = z.object({ own_site_alerts: z.number() });

export async function readOwnSiteAlerts(workspaceId: string): Promise<boolean> {
  const row = readOwnSiteAlertsRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_OWN_SITE_ALERTS).bind(workspaceId).first());
  return (row?.own_site_alerts ?? 1) === 1;
}

export async function setOwnSiteAlerts(workspaceId: string, ownSiteAlerts: boolean): Promise<void> {
  await env.DB.prepare(UPDATE_OWN_SITE_ALERTS)
    .bind(ownSiteAlerts ? 1 : 0, workspaceId)
    .run();
}

const SELECT_CHANGE_ALERTS = "SELECT change_alerts FROM workspace WHERE id = ?";

const UPDATE_CHANGE_ALERTS = "UPDATE workspace SET change_alerts = ? WHERE id = ?";

const readChangeAlertsRow = z.object({ change_alerts: z.number() });

export async function readChangeAlerts(workspaceId: string): Promise<boolean> {
  const row = readChangeAlertsRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_CHANGE_ALERTS).bind(workspaceId).first());
  return (row?.change_alerts ?? 1) === 1;
}

export async function setChangeAlerts(workspaceId: string, changeAlerts: boolean): Promise<void> {
  await env.DB.prepare(UPDATE_CHANGE_ALERTS)
    .bind(changeAlerts ? 1 : 0, workspaceId)
    .run();
}

const SELECT_SLACK_BRIEF = "SELECT slack_brief FROM workspace WHERE id = ?";

const UPDATE_SLACK_BRIEF = "UPDATE workspace SET slack_brief = ? WHERE id = ?";

const readSlackBriefRow = z.object({ slack_brief: z.number() });

export async function readSlackBrief(db: D1Database, workspaceId: string): Promise<boolean> {
  const row = readSlackBriefRow.nullable().parse(await db.prepare(SELECT_SLACK_BRIEF).bind(workspaceId).first());
  return row?.slack_brief === 1;
}

export async function setSlackBrief(workspaceId: string, slackBrief: boolean): Promise<void> {
  await env.DB.prepare(UPDATE_SLACK_BRIEF)
    .bind(slackBrief ? 1 : 0, workspaceId)
    .run();
}

const SEEN_DEBOUNCE_MS = 20 * 3_600_000;

const TOUCH_WORKSPACE_SEEN = `UPDATE workspace SET last_seen_at = ?1
WHERE id = ?2 AND (last_seen_at IS NULL OR last_seen_at < ?3)`;

export async function touchWorkspaceSeen(workspaceId: string, now: Date): Promise<void> {
  const stale = new Date(now.getTime() - SEEN_DEBOUNCE_MS).toISOString();
  await env.DB.prepare(TOUCH_WORKSPACE_SEEN).bind(now.toISOString(), workspaceId, stale).run();
}

const SELECT_OWNED_WORKSPACES = `SELECT w.id AS id,
  COALESCE((SELECT e.name FROM entity e WHERE e.workspace_id = w.id AND e.role = 'self' ORDER BY e.created_at ASC LIMIT 1), w.name) AS name,
  w.parent_workspace_id AS parent_workspace_id,
  ${coveredWorkspace("w.id")} AS covered
FROM workspace w
WHERE w.owner_user_id = ?
ORDER BY w.created_at ASC`;

const ownedWorkspaceRow = z.object({
  id: z.string(),
  name: z.string(),
  parent_workspace_id: z.string().nullable(),
  covered: z.number(),
});

export async function readOwnedWorkspaces(userId: string) {
  const { results } = await env.DB.prepare(SELECT_OWNED_WORKSPACES).bind(userId).all();
  return ownedWorkspaceRow.array().parse(results);
}

const SELECT_BILLING_WORKSPACE = `SELECT COALESCE(
  (SELECT gw.parent_workspace_id FROM workspace gw
     JOIN workspace par ON par.id = gw.parent_workspace_id AND par.owner_user_id = gw.owner_user_id
    WHERE gw.id = ?1 AND NOT EXISTS (SELECT 1 FROM plan own WHERE own.workspace_id = gw.id)),
  ?1
) AS id FROM workspace WHERE id = ?1`;

export async function readBillingWorkspaceId(workspaceId: string): Promise<string | null> {
  const row = workspaceIdRow.nullable().parse(await env.DB.prepare(SELECT_BILLING_WORKSPACE).bind(workspaceId).first());
  return row === null ? null : row.id;
}

const SELECT_SCHEDULES_BY_OWNER = `SELECT id, timezone, brief_weekday, brief_hour, brief_paused_at FROM workspace WHERE owner_user_id = ?
ORDER BY created_at`;

export async function readBriefSchedulesForOwner(userId: string): Promise<OwnedSchedule[]> {
  const { results } = await env.DB.prepare(SELECT_SCHEDULES_BY_OWNER).bind(userId).all();
  return readBriefScheduleForOwnerRow.array().parse(results).map(ownedScheduleFromRow);
}
