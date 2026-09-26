import type { Route } from "./+types/api.auth.$";
import { env } from "cloudflare:workers";

import { createAuthForRequest } from "../lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  return (await createAuthForRequest(env, request)).handler(request);
}

export async function action({ request }: Route.ActionArgs) {
  return (await createAuthForRequest(env, request)).handler(request);
}
