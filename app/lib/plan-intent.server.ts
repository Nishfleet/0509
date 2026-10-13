import { env } from "cloudflare:workers";
import { createCookie } from "react-router";

import { isPlanId, type PlanId } from "./billing/plans";

function planIntentCookie() {
  return createCookie("plan_intent", {
    httpOnly: true,
    maxAge: 60 * 60,
    path: "/",
    sameSite: "lax",
    secure: new URL(env.BETTER_AUTH_URL).protocol === "https:",
  });
}

function planFromSearch(search: URLSearchParams): PlanId | null {
  const value = search.get("plan");
  return isPlanId(value) ? value : null;
}

export async function planIntentHeaders(search: URLSearchParams): Promise<HeadersInit | undefined> {
  const plan = planFromSearch(search);
  if (plan === null) return undefined;
  return { "set-cookie": await planIntentCookie().serialize(plan) };
}

export async function readPlanIntent(request: Request): Promise<PlanId | null> {
  const parsed: unknown = await planIntentCookie().parse(request.headers.get("cookie"));
  return isPlanId(parsed) ? parsed : null;
}
