import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";

import { createAuth } from "../auth.server";
import type { AgentKey, ConnectedApp, CreateKeyResult } from "./access";

const FRESH = { disableCookieCache: true };

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
      rateLimitMax: key.rateLimitMax ?? null,
      remaining: key.remaining ?? null,
    })),
    apps: grants.items.map((grant) => ({
      grantId: grant.id,
      name: appName(grant.metadata, grant.clientId),
      connectedAt: new Date(grant.createdAt * 1000).toISOString(),
    })),
  };
}

const SUBMISSION = /^[0-9a-f-]{36}$/;

function formText(form: FormData, field: string): string | null {
  const value = form.get(field);
  return typeof value === "string" ? value : null;
}

async function submissionMinted(request: Request, submission: string): Promise<boolean> {
  const listed = await createAuth(env).api.listApiKeys({ headers: request.headers });
  return listed.apiKeys.some((key) => Reflect.get(key.metadata ?? {}, "submission") === submission);
}

export async function createAgentKey(request: Request, form: FormData): Promise<CreateKeyResult> {
  const submitted = formText(form, "name")?.trim() ?? "";
  const name = submitted === "" ? "My agent" : submitted.slice(0, 60);
  const token = formText(form, "submission");
  const submission = token !== null && SUBMISSION.test(token) ? token : crypto.randomUUID();
  try {
    const body = { name, metadata: { submission } };
    const created = await createAuth(env).api.createApiKey({ body, headers: request.headers, query: FRESH });
    return { newKey: created.key, duplicate: false };
  } catch (error) {
    if (await submissionMinted(request, submission).catch(() => false)) return { newKey: null, duplicate: true };
    throw error;
  }
}

export async function revokeAgentKey(request: Request, keyId: string): Promise<void> {
  await createAuth(env).api.deleteApiKey({ body: { keyId }, headers: request.headers, query: FRESH });
}

export function disconnectApp(helpers: OAuthHelpers, userId: string, grantId: string): Promise<void> {
  return helpers.revokeGrant(grantId, userId);
}
