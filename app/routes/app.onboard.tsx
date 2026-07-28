import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const COMPAT_COOKIE = "f9_onboard_compat";

/** Compatibility only: setup now lives in the signed-in Overview. */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  await requireSession(env, request);

  const source = new URL(request.url);
  if (requestHasCompatCookie(request)) {
    const { requireWorkspaceSession } = await import("~/lib/auth.server");
    const { getWorkspaceBranding } = await import("~/lib/data.server");
    const { checkPlanLimit, getUserPlan } = await import("~/lib/plan.server");
    const { defaultCountryForVisitor } = await import("~/lib/countries");
    const { getOptionalCloudflareContext } = await import("~/lib/cloudflare-context");
    const cloudflare = getOptionalCloudflareContext(context);
    const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
    const [plan, watchlistLimit, branding] = await Promise.all([
      getUserPlan(env, workspaceUserId),
      checkPlanLimit(env, workspaceUserId, "watchlists"),
      getWorkspaceBranding(env, workspaceUserId),
    ]);
    return Response.json(
      {
        session,
        plan,
        watchlistLimit,
        brandWebsite: branding.brandWebsite,
        prefillWebsite: source.searchParams.get("website")?.trim() ?? "",
        prefillCountry: source.searchParams.get("country")?.trim() ?? "",
        resumeSetup: true,
        visitorCountry: defaultCountryForVisitor(
          cloudflare?.country ?? request.headers.get("cf-ipcountry"),
        ),
      },
      {
        headers: {
          "Set-Cookie": compatCookie(request, 0),
        },
      },
    );
  }

  const watchlist = source.searchParams.get("watchlist")?.trim();
  if (watchlist) {
    throw redirect(
      `/app/watchlists?${new URLSearchParams({ watchlist })}`,
      301,
    );
  }

  const target = new URLSearchParams();
  for (const key of ["website", "country"]) {
    const value = source.searchParams.get(key)?.trim();
    if (value) target.set(key, value);
  }
  const query = target.toString();
  throw redirect(`/app${query ? `?${query}` : ""}#setup-checklist`, 301);
}

/** Preserve forms left open across deployment under the original route ID. */
export async function action(args: ActionFunctionArgs) {
  const { handleSetupChecklistAction } = await import(
    "~/lib/setup-checklist-action.server"
  );
  const result = await handleSetupChecklistAction(args);
  if (result instanceof Response) return result;
  return Response.json(result, {
    headers: {
      "Set-Cookie": compatCookie(args.request, 60),
    },
  });
}

export default function RetiredOnboardRoute() {
  return null;
}

function requestHasCompatCookie(request: Request) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .some((entry) => entry.trim() === `${COMPAT_COOKIE}=1`);
}

function compatCookie(request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COMPAT_COOKIE}=${maxAge > 0 ? "1" : ""}; Path=/app/onboard; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
