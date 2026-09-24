import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import { createAuth } from "./auth.server";

export async function requireSession(request: Request, returnTo?: string) {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect(returnTo === undefined ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`);
  return session;
}
