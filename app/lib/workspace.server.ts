import { env } from "cloudflare:workers";

import { readWorkspaceSelfId } from "./data/entity.server";
import { ensureOwnerEmailTarget } from "./data/send_target.server";
import { fillWorkspaceTimezone, insertWorkspace } from "./data/workspace.server";
import type { WorkspaceDb } from "./data/workspace.server";
import { subjectRedirect } from "./onboarding-subject";
import { canonicalTimezone, timezoneCookieValue } from "./timezone";

export type { WorkspaceDb };

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

export function firstWorkspaceId(userId: string): string {
  return `ws_${userId}`;
}

export function workspaceNameFromEmail(email: string): string {
  const at = email.indexOf("@");
  const local = (at === -1 ? email : email.slice(0, at)).trim();
  return local.length > 0 ? local : "workspace";
}

async function readWorkspace(db: WorkspaceDb, userId: string): Promise<WorkspaceRow | null> {
  return db.prepare(SELECT_WORKSPACE).bind(userId).first<WorkspaceRow>();
}

async function withCapturedTimezone(
  db: WorkspaceDb,
  row: WorkspaceRow,
  timezone: string,
): Promise<WorkspaceRow> {
  if (row.timezone !== "UTC" || timezone === "UTC") return row;
  await fillWorkspaceTimezone(db, row.id, timezone);
  return { ...row, timezone };
}

export async function ensureWorkspace(
  db: WorkspaceDb,
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
  db: WorkspaceDb,
  input: { userId: string; request: Request | null; now?: string },
): Promise<WorkspaceRow | null> {
  const user = await db.prepare('SELECT email FROM "user" WHERE id = ?').bind(input.userId).first<{ email: string }>();
  if (!user?.email) return null;
  const workspace = await ensureWorkspace(db, {
    userId: input.userId,
    email: user.email,
    timezone: await timezoneCookieValue(input.request?.headers.get("cookie") ?? null),
    now: input.now,
  });
  await ensureOwnerEmailTarget(db, { workspaceId: workspace.id, now: input.now ?? new Date().toISOString() });
  return workspace;
}

export const ONBOARDING_COMPETITORS = "/onboarding/competitors";

export const SELECT_RUN = "SELECT input_raw, watching_started_at FROM onboarding_run WHERE workspace_id = ? ORDER BY started_at ASC LIMIT 1";

interface RunRow {
  input_raw: string;
  watching_started_at: string | null;
}

function resumePoint(hasSelf: boolean, run: RunRow | null): string | null {
  if (!hasSelf) return run === null ? "/onboarding" : (subjectRedirect(run.input_raw) ?? "/onboarding");
  if (run?.watching_started_at !== null) return null;
  return ONBOARDING_COMPETITORS;
}

export async function workspaceLanding(
  db: WorkspaceDb,
  input: { userId: string; email: string; timezone: string | null; now?: string },
): Promise<string | null> {
  const workspace = await ensureWorkspace(db, input);
  const [selfId, run] = await Promise.all([
    readWorkspaceSelfId(workspace.id),
    db.prepare(SELECT_RUN).bind(workspace.id).first<RunRow>(),
  ]);
  return resumePoint(selfId !== null, run);
}

export async function workspaceLandingForRequest(
  request: Request,
  user: { id: string; email: string },
): Promise<string | null> {
  if (!user.email) return "/onboarding";
  return workspaceLanding(env.DB, {
    userId: user.id,
    email: user.email,
    timezone: await timezoneCookieValue(request.headers.get("cookie")),
  });
}
