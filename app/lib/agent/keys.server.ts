import { env } from "cloudflare:workers";

import { createAuth } from "../auth.server";
import type { AgentProps } from "./context.server";
import { API_KEY_PREFIX, READ_SCOPE } from "./paths";

export const RATE_LIMITED = "rate_limited";

function hasReadScope(permissions: unknown): boolean {
  if (typeof permissions !== "object" || permissions === null) return false;
  const read: unknown = Reflect.get(permissions, READ_SCOPE);
  return Array.isArray(read) && read.includes("*");
}

export async function propsForApiKey(key: string): Promise<AgentProps | typeof RATE_LIMITED | null> {
  if (!key.startsWith(API_KEY_PREFIX)) return null;
  const result = await createAuth(env).api.verifyApiKey({ body: { key } });
  if (!result.valid && result.error?.code === "RATE_LIMITED") return RATE_LIMITED;
  if (!result.valid || result.key === null || !hasReadScope(result.key.permissions)) return null;
  return { userId: result.key.referenceId, clientId: `apikey:${result.key.id}` };
}

export function bearerToken(request: Request): string | null {
  const [scheme, token, ...rest] = (request.headers.get("authorization") ?? "").trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) return null;
  return token;
}
