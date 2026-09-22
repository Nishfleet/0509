import { env } from "cloudflare:workers";

import { createAuth } from "./auth.server";

function requestCarriesSessionCookie(request: Request) {
  return request.headers.get("cookie")?.includes("session_token") ?? false;
}

export async function readSignedIn(request: Request) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/") || !requestCarriesSessionCookie(request)) return false;
  try {
    const session = await createAuth(env).api.getSession({ headers: request.headers });
    return Boolean(session);
  } catch {
    return false;
  }
}
