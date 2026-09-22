import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import { createAuth } from "./auth.server";
import { ensureWorkspaceForSignIn } from "./workspace.server";

export async function requireSession(request: Request) {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/login");
  await ensureWorkspaceForSignIn(env.DB, { userId: session.user.id, request });
  return session;
}
