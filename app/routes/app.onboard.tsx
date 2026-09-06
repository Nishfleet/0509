import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { SignupFirstBriefView } from "~/components/signup-first-brief-view";
import { useFirstCapturePolling } from "~/components/workspace/use-first-capture-polling";
import type { SignupFirstBriefLoaderData } from "~/lib/first-brief";

const COMPAT_COOKIE = "f9_onboard_compat";

/** Compatibility only: setup now lives in the signed-in Overview. */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  await requireSession(env, request);

  const source = new URL(request.url);

  // BET 7 (issue #1276): the same-session first brief. When the feature flag
  // is on and the user lands on ?step=first-brief, render the inline brief
  // instead of redirecting to the dashboard. The flag defaults off; the
  // redirect below remains the path for everyone else.
  if (source.searchParams.get("step") === "first-brief") {
    const { isSignupFirstBriefEnabled } = await import("~/lib/env.server");
    if (isSignupFirstBriefEnabled(env)) {
      return firstBriefLoader(env, context, request);
    }
  }

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
  const data = useLoaderData<typeof loader>() as
    | SignupFirstBriefLoaderData
    | null;
  // BET 7 (issue #1487): while the activation scan is in flight, keep
  // revalidating the loader so the brief renders in the SAME session the
  // moment evidence lands — no manual reload, no "check email Monday"
  // placeholder. Same bounded 30s-poll pattern as the dashboard and the
  // Competitors board (useFirstCapturePolling).
  const awaitingFirstScan =
    data?.step === "first-brief" && data.status === "waiting";
  useFirstCapturePolling(awaitingFirstScan);
  if (data && data.step === "first-brief") {
    return <SignupFirstBriefView data={data} />;
  }
  return null;
}

/**
 * BET 7 (issue #1276): the inline first-brief loader. Loads the filed
 * first-brief digest (filing it if needed, same as the dashboard), resolves
 * the ads its items reference, builds the inline payload, and emits the
 * `funnel_first_brief_viewed` event. Returns a waiting state when no
 * evidence-linked brief is available yet — the activation scan may still be
 * in flight.
 */
async function firstBriefLoader(
  env: ReturnType<typeof import("~/lib/context.server").getEnv>,
  context: LoaderFunctionArgs["context"],
  request: Request,
): Promise<SignupFirstBriefLoaderData> {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { listDigests, listAdsByIds, listWatchlists } = await import(
    "~/lib/data.server"
  );
  const {
    findFirstBriefDigest,
    hasEvidenceLinkedItem,
    buildSignupFirstBriefPayload,
  } = await import("~/lib/first-brief");
  const { emitFunnelFirstBriefViewed } = await import(
    "~/lib/funnel-measurement.server"
  );
  const { shouldEnsureFirstBrief } = await import("~/lib/first-brief");

  const { workspaceUserId } = await requireWorkspaceSession(env, request);

  const watchlists = await listWatchlists(env, workspaceUserId);
  let digests = await listDigests(env, workspaceUserId);

  // File the first brief if the activation scan has completed but no digest
  // exists yet — same gate the dashboard uses.
  if (shouldEnsureFirstBrief({ watchlists, digests })) {
    try {
      const { ensureFirstBriefForWorkspace } = await import(
        "~/lib/first-brief.server"
      );
      await ensureFirstBriefForWorkspace(env, workspaceUserId);
      digests = await listDigests(env, workspaceUserId);
    } catch {
      // The waiting state below handles a missing brief; a filing failure
      // must never 500 the inline surface.
    }
  }

  const firstBrief = findFirstBriefDigest(digests);
  const hasEvidence = firstBrief && hasEvidenceLinkedItem(firstBrief.items);

  if (hasEvidence && firstBrief) {
    emitFunnelFirstBriefViewed(env, request);
  }

  if (!firstBrief || !hasEvidence) {
    // Distinguish "scan still in flight" from "scan completed but no verified
    // ads were found". The watchdog's first-scan workflow writes
    // `lastScannedAt` when the activation scan runs to completion, whether
    // or not it surfaced any ads. When the scan is finished but no
    // evidence-linked first-brief exists, the honest surface is a terminal
    // `no_ads` state with a next action — not a perpetual "still being
    // captured" wait (BET 7 / issue #1750 accept #2).
    //
    // Completion is detected with `.some` (any active watchlist scanned), the
    // same guard `shouldEnsureFirstBrief` uses above — a multi-watchlist
    // workspace must not regress to a perpetual wait just because the first
    // returned active watchlist still has a null `lastScannedAt`.
    const activeScanned = watchlists.some(
      (w) => w.isActive && Boolean(w.lastScannedAt),
    );
    if (activeScanned) {
      const scanned = watchlists.find(
        (w) => w.isActive && Boolean(w.lastScannedAt),
      );
      return {
        step: "first-brief",
        status: "no_ads",
        watchlistName: scanned?.targetLabel ?? null,
      };
    }
    // The activation scan is still in flight. Render the waiting state — the
    // client polls the dashboard's first-scan status endpoint.
    const activeWatchlist = watchlists.find((w) => w.isActive);
    return {
      step: "first-brief",
      status: "waiting",
      watchlistName: activeWatchlist?.targetLabel ?? null,
    };
  }

  // Collect ad ids from the digest items so we can enrich the payload with
  // headline / CTA / offer text.
  const adIds: string[] = [];
  for (const item of firstBrief.items) {
    const metadata = (item.metadata ?? {}) as Record<string, unknown>;
    if (typeof metadata.adId === "string" && metadata.adId) {
      adIds.push(metadata.adId);
    }
  }
  const ads = await listAdsByIds(env, adIds);
  const payload = buildSignupFirstBriefPayload({
    digest: firstBrief,
    ads: ads as never,
  });

  if (!payload) {
    return {
      step: "first-brief",
      status: "waiting",
      watchlistName:
        watchlists.find((w) => w.isActive)?.targetLabel ?? null,
    };
  }

  return {
    step: "first-brief",
    status: "ready",
    brief: payload,
  };
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
