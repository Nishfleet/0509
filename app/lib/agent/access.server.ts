import type { GrantSummary, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { createAuth } from "../auth.server";
import type { AgentKey, ConnectedApp, CreateKeyResult } from "./access";

const FRESH = { disableCookieCache: true };
const GRANT_PAGE = 100;
const GRANT_PAGES = 50;

function appLabel(metadata: unknown, fallback: string): { name: string; host: string } {
  if (typeof metadata !== "object" || metadata === null) return { name: fallback, host: fallback };
  const name: unknown = Reflect.get(metadata, "appName");
  const host: unknown = Reflect.get(metadata, "host");
  const labelled = typeof name === "string" && name.length > 0 ? name : fallback;
  const redirectHost = typeof host === "string" && host.length > 0 ? host : labelled;
  return { name: labelled, host: redirectHost };
}

export async function listAllGrants(helpers: OAuthHelpers, userId: string): Promise<GrantSummary[]> {
  const items: GrantSummary[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < GRANT_PAGES; pages += 1) {
    const page = await helpers.listUserGrants(userId, { limit: GRANT_PAGE, cursor });
    items.push(...page.items);
    const next = page.cursor;
    if (next === undefined || next === "" || next === cursor) return items;
    cursor = next;
  }
  return items;
}

export async function readAgentAccess(
  helpers: OAuthHelpers,
  request: Request,
  userId: string,
): Promise<{ keys: AgentKey[]; apps: ConnectedApp[] }> {
  const [listed, grants] = await Promise.all([
    createAuth(env).api.listApiKeys({ headers: request.headers }),
    listAllGrants(helpers, userId),
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
    apps: grants.map((grant) => {
      const label = appLabel(grant.metadata, grant.clientId);
      return {
        grantId: grant.id,
        name: label.name,
        host: label.host,
        connectedAt: new Date(grant.createdAt * 1000).toISOString(),
      };
    }),
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

export async function createAgentKey(request: Request, form: FormData): Promise<CreateKeyResult> {
  const parsed = createKeyForm.safeParse(Object.fromEntries(form));
  const submitted = parsed.success ? (parsed.data.name === undefined ? "" : parsed.data.name.trim()) : "";
  const name = submitted === "" ? "My agent" : submitted.slice(0, 60);
  const token = parsed.success && parsed.data.submission !== undefined ? parsed.data.submission : null;
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
