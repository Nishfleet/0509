import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";
import { createCookie } from "react-router";

import { deleteSignedInUser } from "./auth.server";
import { readBriefScheduleForOwner, readWorkspaceR2Prefixes } from "./data/workspace.server";
import type { OwnedSchedule } from "./data/workspace.server";
import { retireRollovers } from "./standing/retire";

const PAGE_SIZE = 1000;
const DELETE_INSTANCE_COOKIE = "account-delete";
const STATUS_DEADLINE_MS = 3000;

export interface AccountDeleteParams {
  prefixes: string[];
}

export interface AccountDeleteProgress {
  rows: "removed";
  files: "removing" | "removed" | "failed";
  deleted: number | null;
}

export async function deleteAccount(
  helpers: Pick<OAuthHelpers, "listUserGrants" | "revokeGrant">,
  request: Request,
  userId: string,
): Promise<{ headers: Headers; instanceId: string } | null> {
  const cookie = deleteInstanceCookie();
  const owned = await readBriefScheduleForOwner(userId);
  const prefixes = owned === null ? [] : await readWorkspaceR2Prefixes(owned.workspaceId);
  const headers = await deleteSignedInUser(env, request, new Date());
  if (headers === null) return null;
  if (owned !== null) await retireWorkspaceRollovers(owned);
  const instance = await env.ACCOUNT_DELETE.create({ params: { prefixes } satisfies AccountDeleteParams });
  headers.append("set-cookie", await cookie.serialize(instance.id));
  await revokeGrants(helpers, userId);
  return { headers, instanceId: instance.id };
}

async function retireWorkspaceRollovers(owned: OwnedSchedule): Promise<void> {
  try {
    const terminated = await retireRollovers(env.STANDING_ROLLOVER, owned, new Date());
    console.log(JSON.stringify({ event: "account_delete.rollovers_terminated", terminated: terminated.length }));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "account_delete.rollovers_not_terminated",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}

async function revokeGrants(helpers: Pick<OAuthHelpers, "listUserGrants" | "revokeGrant">, userId: string) {
  let failed = 0;
  let cursor: string | undefined;
  try {
    do {
      const grants = await helpers.listUserGrants(userId, { limit: 100, cursor });
      const settled = await Promise.allSettled(grants.items.map((grant) => helpers.revokeGrant(grant.id, userId)));
      failed += settled.filter((result) => result.status === "rejected").length;
      cursor = grants.cursor;
    } while (cursor !== undefined);
  } catch {
    failed += 1;
  }
  if (failed > 0) console.error(JSON.stringify({ event: "account_delete.grant_revoke_failed", failed }));
}

function deleteInstanceCookie() {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured");
  return createCookie(DELETE_INSTANCE_COOKIE, {
    httpOnly: true,
    maxAge: 60 * 60,
    path: "/",
    sameSite: "lax",
    secrets: [secret],
    secure: new URL(env.BETTER_AUTH_URL).protocol === "https:",
  });
}

export async function sealAccountDeleteInstanceId(instanceId: string): Promise<string> {
  return deleteInstanceCookie().serialize(instanceId);
}

export async function clearAccountDeleteInstanceId(): Promise<string> {
  return deleteInstanceCookie().serialize("", { maxAge: 0 });
}

export async function readAccountDeleteInstanceId(request: Request): Promise<string | null> {
  const parsed: unknown = await deleteInstanceCookie().parse(request.headers.get("cookie"));
  return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
}

export interface DeletedPage {
  deleted: number;
  cursor: string | null;
}

async function deletePage(bucket: R2Bucket, prefix: string, cursor: string | null): Promise<DeletedPage> {
  const listed = await bucket.list({ prefix, limit: PAGE_SIZE, ...(cursor === null ? {} : { cursor }) });
  const keys = listed.objects.map((object) => object.key);
  if (keys.length > 0) await bucket.delete(keys);
  return { deleted: keys.length, cursor: listed.truncated ? listed.cursor : null };
}

export async function deleteStoredPage(prefix: string, cursor: string | null): Promise<DeletedPage> {
  return deletePage(env.SNAPSHOTS, prefix, cursor);
}

export async function deleteBackupPage(prefix: string, cursor: string | null): Promise<DeletedPage> {
  return deletePage(env.SNAPSHOTS_BACKUP, prefix, cursor);
}

function isAccountDeleteInstanceMissing(error: unknown): boolean {
  return error instanceof Error && error.message.includes("instance.not_found");
}

async function lookupInstanceStatus(instanceId: string) {
  const lookup = await env.ACCOUNT_DELETE.get(instanceId).catch((error: unknown) => {
    if (isAccountDeleteInstanceMissing(error)) return null;
    throw error;
  });
  return lookup === null ? null : lookup.status();
}

async function withinDeadline<T>(work: Promise<T>): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
    }, STATUS_DEADLINE_MS);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function readAccountDeleteProgress(instanceId: string): Promise<AccountDeleteProgress | null> {
  const found = await withinDeadline(lookupInstanceStatus(instanceId));
  if (found === "timeout") return { rows: "removed", files: "removing", deleted: null };
  if (found === null) return null;
  const { status, output } = found;
  if (status === "complete") {
    const deleted =
      typeof output === "object" && output !== null && "deleted" in output && typeof output.deleted === "number"
        ? output.deleted
        : null;
    return { rows: "removed", files: "removed", deleted };
  }
  if (status === "errored" || status === "terminated") {
    return { rows: "removed", files: "failed", deleted: null };
  }
  return { rows: "removed", files: "removing", deleted: null };
}
