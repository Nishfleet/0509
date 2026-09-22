import type { Route } from "./+types/api.auth.$";
import { env } from "cloudflare:workers";

import { createAuth } from "../lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  return createAuth(env).handler(request);
}

export async function action({ request }: Route.ActionArgs) {
  return createAuth(env).handler(request);
}
