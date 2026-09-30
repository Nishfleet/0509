import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";
import { createCookie } from "react-router";

import { deleteSignedInUser } from "./auth.server";
import { readWorkspaceIdForOwner, readWorkspaceR2Prefixes } from "./data/workspace.server";

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
  const workspaceId = await readWorkspaceIdForOwner(userId);
  const prefixes = workspaceId === null ? [] : await readWorkspaceR2Prefixes(workspaceId);
  const headers = await deleteSignedInUser(env, request, new Date());
  if (headers === null) return null;
  const instance = await env.ACCOUNT_DELETE.create({ params: { prefixes } satisfies AccountDeleteParams });
  headers.append("set-cookie", await cookie.serialize(instance.id));
  await revokeGrants(helpers, userId);
  return { headers, instanceId: instance.id };
}

async function revokeGrants(helpers: Pick<OAuthHelpers, "listUserGrants" | "revokeGrant">, userId: string) {
  try {
    const grants = await helpers.listUserGrants(userId, { limit: 100 });
    await Promise.all(grants.items.map((grant) => helpers.revokeGrant(grant.id, userId)));
  } catch (error) {
    console.error(JSON.stringify({ event: "account_delete.grant_revoke_failed", error: String(error) }));
  }
}

function deleteInstanceCookie() {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured");
  return createCookie(DELETE_INSTANCE_COOKIE, {
    httpOnly: true,
    maxAge: 60 * 60,
    path: "/login",
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

export async function deleteStoredPage(prefix: string): Promise<{ deleted: number; more: boolean }> {
  const listed = await env.SNAPSHOTS.list({ prefix, limit: PAGE_SIZE });
  const keys = listed.objects.map((object) => object.key);
  if (keys.length > 0) await env.SNAPSHOTS.delete(keys);
  return { deleted: keys.length, more: listed.truncated };
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
