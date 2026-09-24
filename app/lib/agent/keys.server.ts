import { env } from "cloudflare:workers";

import { createAuth } from "../auth.server";
import type { AgentProps } from "./context.server";
import { API_KEY_PREFIX } from "./paths";

export async function propsForApiKey(key: string): Promise<AgentProps | null> {
  if (!key.startsWith(API_KEY_PREFIX)) return null;
  const result = await createAuth(env).api.verifyApiKey({ body: { key } });
  if (!result.valid || result.key === null) return null;
  return { userId: result.key.referenceId, clientId: `apikey:${result.key.id}` };
}

export function bearerToken(request: Request): string | null {
  const [scheme, token, ...rest] = (request.headers.get("authorization") ?? "").trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) return null;
  return token;
}
