import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import { createAuth } from "./auth.server";

/**
 * The gate for every /app surface.
 *
 * better-auth reads the session from the request's own cookies — this never
 * parses one itself. No session means /login, which is the only branch: a
 * half-authenticated page is worse than a redirect.
 */
export async function requireSession(request: Request) {
  const auth = createAuth(env as never);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/login");
  return session;
}
