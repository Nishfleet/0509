import type { Route } from "./+types/api.auth.$";
import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import { createAuthForRequest } from "../lib/auth.server";

const MAGIC_LINK_VERIFY_PATH = "/api/auth/magic-link/verify";
const REJECTED_CALLBACK_CODES = new Set([
  "INVALID_CALLBACK_URL",
  "INVALID_ERROR_CALLBACK_URL",
  "INVALID_NEW_USER_CALLBACK_URL",
]);

async function rejectedCallback(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (typeof body !== "object" || body === null) return false;
  const code: unknown = Reflect.get(body, "code");
  return typeof code === "string" && REJECTED_CALLBACK_CODES.has(code);
}

export async function loader({ request }: Route.LoaderArgs) {
  const response = await (await createAuthForRequest(env, request)).handler(request);
  if (new URL(request.url).pathname === MAGIC_LINK_VERIFY_PATH && (await rejectedCallback(response))) {
    return redirect("/login?error=INVALID_TOKEN");
  }
  return response;
}

export async function action({ request }: Route.ActionArgs) {
  return (await createAuthForRequest(env, request)).handler(request);
}
