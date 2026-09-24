import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";

import { createAuth } from "../auth.server";
import type { AgentKey, ConnectedApp } from "./access";

function appName(metadata: unknown, fallback: string): string {
  if (typeof metadata !== "object" || metadata === null) return fallback;
  const name: unknown = Reflect.get(metadata, "appName");
  return typeof name === "string" && name.length > 0 ? name : fallback;
}

export async function readAgentAccess(
  helpers: OAuthHelpers,
  request: Request,
  userId: string,
): Promise<{ keys: AgentKey[]; apps: ConnectedApp[] }> {
  const [listed, grants] = await Promise.all([
    createAuth(env).api.listApiKeys({ headers: request.headers }),
    helpers.listUserGrants(userId, { limit: 100 }),
  ]);
  return {
    keys: listed.apiKeys.map((key) => ({
      id: key.id,
      name: key.name ?? "Unnamed key",
      start: key.start ?? null,
      createdAt: new Date(key.createdAt).toISOString(),
      lastUsedAt: key.lastRequest ? new Date(key.lastRequest).toISOString() : null,
    })),
    apps: grants.items.map((grant) => ({
      grantId: grant.id,
      name: appName(grant.metadata, grant.clientId),
      connectedAt: new Date(grant.createdAt * 1000).toISOString(),
    })),
  };
}

export async function createAgentKey(request: Request, name: string): Promise<string> {
  const created = await createAuth(env).api.createApiKey({ body: { name }, headers: request.headers });
  return created.key;
}

export async function revokeAgentKey(request: Request, keyId: string): Promise<void> {
  await createAuth(env).api.deleteApiKey({ body: { keyId }, headers: request.headers });
}

export function disconnectApp(helpers: OAuthHelpers, userId: string, grantId: string): Promise<void> {
  return helpers.revokeGrant(grantId, userId);
}
