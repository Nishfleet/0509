import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";

import { deleteSignedInUser } from "./auth.server";
import { readWorkspaceIdForOwner, readWorkspaceR2Prefixes } from "./data/workspace.server";

const PAGE_SIZE = 1000;

export interface AccountDeleteParams {
  prefixes: string[];
}

export async function deleteAccount(
  helpers: OAuthHelpers,
  request: Request,
  userId: string,
): Promise<Headers | null> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  const prefixes = workspaceId === null ? [] : await readWorkspaceR2Prefixes(workspaceId);
  const headers = await deleteSignedInUser(env, request, new Date());
  if (headers === null) return null;
  await env.ACCOUNT_DELETE.create({ params: { prefixes } satisfies AccountDeleteParams });
  const grants = await helpers.listUserGrants(userId, { limit: 100 });
  await Promise.all(grants.items.map((grant) => helpers.revokeGrant(grant.id, userId)));
  return headers;
}

export async function deleteStoredPage(prefix: string): Promise<{ deleted: number; more: boolean }> {
  const listed = await env.SNAPSHOTS.list({ prefix, limit: PAGE_SIZE });
  const keys = listed.objects.map((object) => object.key);
  if (keys.length > 0) await env.SNAPSHOTS.delete(keys);
  return { deleted: keys.length, more: listed.truncated };
}
