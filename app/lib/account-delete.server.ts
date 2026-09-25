import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";

import { deleteSignedInUser } from "./auth.server";
import { readWorkspaceIdForOwner, readWorkspaceR2Prefixes } from "./data/workspace.server";

const PAGE_SIZE = 1000;

export interface AccountDeleteParams {
  prefixes: string[];
}

export interface AccountDeleteProgress {
  rows: "removed";
  files: "removing" | "removed" | "failed";
  deleted: number | null;
}

export async function deleteAccount(
  helpers: OAuthHelpers,
  request: Request,
  userId: string,
): Promise<{ headers: Headers; instanceId: string } | null> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  const prefixes = workspaceId === null ? [] : await readWorkspaceR2Prefixes(workspaceId);
  const headers = await deleteSignedInUser(env, request, new Date());
  if (headers === null) return null;
  const instance = await env.ACCOUNT_DELETE.create({ params: { prefixes } satisfies AccountDeleteParams });
  const grants = await helpers.listUserGrants(userId, { limit: 100 });
  await Promise.all(grants.items.map((grant) => helpers.revokeGrant(grant.id, userId)));
  return { headers, instanceId: instance.id };
}

export async function deleteStoredPage(prefix: string): Promise<{ deleted: number; more: boolean }> {
  const listed = await env.SNAPSHOTS.list({ prefix, limit: PAGE_SIZE });
  const keys = listed.objects.map((object) => object.key);
  if (keys.length > 0) await env.SNAPSHOTS.delete(keys);
  return { deleted: keys.length, more: listed.truncated };
}

export function isAccountDeleteInstanceMissing(error: unknown): boolean {
  return error instanceof Error && error.message.includes("instance.not_found");
}

export async function readAccountDeleteProgress(
  instanceId: string,
): Promise<AccountDeleteProgress | null> {
  const lookup = await env.ACCOUNT_DELETE.get(instanceId).catch((error: unknown) => {
    if (isAccountDeleteInstanceMissing(error)) return null;
    throw error;
  });
  if (lookup === null) return null;
  const { status, output } = await lookup.status();
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
