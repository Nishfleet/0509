import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import { createAuth } from "./auth.server";

async function readSession(request: Request, returnTo: string | undefined, disableCookieCache: boolean) {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache } });
  if (!session) throw redirect(returnTo === undefined ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`);
  return session;
}

export function requireSession(request: Request, returnTo?: string) {
  return readSession(request, returnTo, false);
}

export function requireFreshSession(request: Request, returnTo?: string) {
  return readSession(request, returnTo, true);
}

export async function hasSession(request: Request): Promise<boolean> {
  const auth = createAuth(env);
  return (await auth.api.getSession({ headers: request.headers })) !== null;
}
