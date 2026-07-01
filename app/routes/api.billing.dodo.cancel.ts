import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  await requireSession(env, request);
  const url = new URL(request.url);
  const plan = cleanPlan(url.searchParams.get("plan"));
  const cycle = cleanCycle(url.searchParams.get("cycle"));
  const source = cleanSourceParam(url.searchParams.get("source"));

  const returnUrl = new URL("/app/billing", url.origin);
  returnUrl.searchParams.set("checkout", "cancelled");
  returnUrl.searchParams.set("kind", "plan");
  returnUrl.searchParams.set("plan", plan);
  returnUrl.searchParams.set("cycle", cycle);
  if (source) returnUrl.searchParams.set("source", source);
  returnUrl.hash = "plans";
  throw redirect(`${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`, { status: 303 });
}

export function action(_args: ActionFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use GET." },
    { status: 405, headers: { Allow: "GET" } },
  );
}

function cleanPlan(value: string | null) {
  return value === "scout" || value === "starter" || value === "agency" ? value : "starter";
}

function cleanCycle(value: string | null) {
  return value === "yearly" ? "yearly" : "monthly";
}

function cleanSourceParam(value: string | null) {
  const cleaned = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(cleaned) ? cleaned : null;
}
