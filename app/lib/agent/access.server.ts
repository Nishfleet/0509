import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { createAuth } from "../auth.server";
import { readOwnerWorkspaceApiAccess } from "../data/plan.server";
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

const createKeyForm = z.object({
  name: z.string().optional(),
  submission: z.string().optional(),
});

async function submissionMinted(request: Request, submission: string): Promise<boolean> {
  const listed = await createAuth(env).api.listApiKeys({ headers: request.headers });
  return listed.apiKeys.some((key) => Reflect.get(key.metadata ?? {}, "submission") === submission);
}

function keyFields(form: FormData): { name: string; submission: string } {
  const parsed = createKeyForm.safeParse(Object.fromEntries(form));
  const submitted = parsed.success ? (parsed.data.name === undefined ? "" : parsed.data.name.trim()) : "";
  const name = submitted === "" ? "My agent" : submitted.slice(0, 60);
  const token = parsed.success && parsed.data.submission !== undefined ? parsed.data.submission : null;
  const submission = token !== null && SUBMISSION.test(token) ? token : crypto.randomUUID();
  return { name, submission };
}

async function apiAccessDenied(request: Request): Promise<boolean> {
  const session = await createAuth(env).api.getSession({ headers: request.headers, query: FRESH });
  if (session === null) return false;
  const access = await readOwnerWorkspaceApiAccess(session.user.id);
  return access?.apiAccess !== true;
}

export async function createAgentKey(request: Request, form: FormData): Promise<CreateKeyResult> {
  const { name, submission } = keyFields(form);
  if (await apiAccessDenied(request)) return { newKey: null, duplicate: false };
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
