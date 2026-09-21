import type { Route } from "./+types/api.auth.$";
import { env } from "cloudflare:workers";

import { createAuth } from "../lib/auth.server";

/**
 * better-auth's own handler, mounted whole.
 *
 * Bindings come from `cloudflare:workers`, which is how this scaffold exposes
 * them. They are NOT on `context.cloudflare.env` — that is the React Router 7
 * shape and this app provides no getLoadContext, so reaching for it throws and
 * every auth route 500s.
 */
export async function loader({ request }: Route.LoaderArgs) {
  return createAuth(env as never).handler(request);
}

export async function action({ request }: Route.ActionArgs) {
  return createAuth(env as never).handler(request);
}
