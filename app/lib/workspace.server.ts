import { env } from "cloudflare:workers";

import { fillWorkspaceTimezone, insertWorkspace } from "./data/workspace.server";
import type { Db } from "./data/workspace.server";
import { canonicalTimezone, timezoneCookieValue } from "./timezone";

export type { Db };

interface WorkspaceRow {
  id: string;
  name: string;
  owner_user_id: string;
  timezone: string;
  brief_weekday: number;
  brief_hour: number;
  created_at: string;
}

const SELECT_WORKSPACE = `SELECT id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at
FROM workspace WHERE owner_user_id = ?
ORDER BY created_at ASC
LIMIT 1`;

const SELECT_SELF = `SELECT id FROM entity WHERE workspace_id = ? AND role = 'self' LIMIT 1`;

export function firstWorkspaceId(userId: string): string {
  return `ws_${userId}`;
}

export function workspaceNameFromEmail(email: string): string {
  const at = email.indexOf("@");
  const local = (at === -1 ? email : email.slice(0, at)).trim();
  return local.length > 0 ? local : "workspace";
}

async function readWorkspace(db: Db, userId: string): Promise<WorkspaceRow | null> {
  return db.prepare(SELECT_WORKSPACE).bind(userId).first<WorkspaceRow>();
}

async function withCapturedTimezone(
  db: Db,
  row: WorkspaceRow,
  timezone: string,
): Promise<WorkspaceRow> {
  if (row.timezone !== "UTC" || timezone === "UTC") return row;
  await fillWorkspaceTimezone(db, row.id, timezone);
  return { ...row, timezone };
}

export async function ensureWorkspace(
  db: Db,
  input: { userId: string; email: string; timezone: string | null; now?: string },
): Promise<WorkspaceRow> {
  const timezone = canonicalTimezone(input.timezone);
  const existing = await readWorkspace(db, input.userId);
  if (existing) return withCapturedTimezone(db, existing, timezone);

  const createdAt = input.now ?? new Date().toISOString();
  try {
    await insertWorkspace(db, {
      id: firstWorkspaceId(input.userId),
      name: workspaceNameFromEmail(input.email),
      ownerUserId: input.userId,
      timezone,
      createdAt,
    });
  } catch (error) {
    const raced = await readWorkspace(db, input.userId);
    if (raced) return withCapturedTimezone(db, raced, timezone);
    throw error;
  }

  const row = await readWorkspace(db, input.userId);
  if (!row) throw new Error("workspace was not created");
  return withCapturedTimezone(db, row, timezone);
}

export async function ensureWorkspaceForSignIn(
  db: Db,
  input: { userId: string; request: Request | null; now?: string },
): Promise<WorkspaceRow | null> {
  const user = await db.prepare('SELECT email FROM "user" WHERE id = ?').bind(input.userId).first<{ email: string }>();
  if (!user?.email) return null;
  return ensureWorkspace(db, {
    userId: input.userId,
    email: user.email,
    timezone: await timezoneCookieValue(input.request?.headers.get("cookie") ?? null),
    now: input.now,
  });
}

export async function workspaceLanding(
  db: Db,
  input: { userId: string; email: string; timezone: string | null; now?: string },
): Promise<"/onboarding" | null> {
  const workspace = await ensureWorkspace(db, input);
  const self = await db.prepare(SELECT_SELF).bind(workspace.id).first<{ id: string }>();
  return self ? null : "/onboarding";
}

export async function workspaceLandingForRequest(request: Request, userId: string): Promise<"/onboarding" | null> {
  const header = request.headers.get("cookie");
  const user = await env.DB.prepare('SELECT email FROM "user" WHERE id = ?').bind(userId).first<{ email: string }>();
  if (!user?.email) return "/onboarding";
  return workspaceLanding(env.DB, {
    userId,
    email: user.email,
    timezone: await timezoneCookieValue(header),
  });
}
