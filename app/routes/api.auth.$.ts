import type { Route } from "./+types/api.auth.$";
import { env } from "cloudflare:workers";

import { handleAuthRequest } from "../lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  return handleAuthRequest(env, request);
}

export async function action({ request }: Route.ActionArgs) {
  return handleAuthRequest(env, request);
}
