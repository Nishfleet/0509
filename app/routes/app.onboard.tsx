import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { SignupFirstBriefView } from "~/components/signup-first-brief-view";
import { useFirstCapturePolling } from "~/components/workspace/use-first-capture-polling";
import type {
  SignupFirstBriefBrandSuggestion,
  SignupFirstBriefLoaderData,
} from "~/lib/first-brief";
import type { FirstBriefFileResult } from "~/lib/first-brief.server";

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

  const watchlist = source.searchParams.get("watchlist")?.trim();
  if (watchlist) {
    throw redirect(
      `/app/watchlists?${new URLSearchParams({ watchlist })}`,
      301,
    );
  }

  const target = new URLSearchParams();
  for (const key of ["website", "country", "competitor"]) {
    const value = source.searchParams.get(key)?.trim();
    if (value) target.set(key, value);
  }
  const query = target.toString();
  throw redirect(`/app${query ? `?${query}` : ""}#setup-checklist`, 301);
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
 * Issue #2411: resolve the adjacent already-tracked brands offered in the
 * `no_ads` terminal state.
 *
 * Reuses the /brands hub's own loader (`loadIndexableAdsInternalLinks`, #1417)
 * so every suggestion is a brand the public hub already lists and whose
 * `/ads/:domain` page is in the sitemap's indexable set — a suggestion can
 * never point at a page the route would refuse to serve. `pickSignupFirstBriefBrandSuggestions`
 * then narrows to the same buyer category as the user's own competitor
 * (`brandCategoryForDomain`) before falling back to a deterministic slice.
 * Cache-only: never triggers live discovery or scraping, and never throws —
 * the loaders degrade to an empty list on any hiccup, in which case the view
 * simply hides the section.
 */
async function loadNoAdsBrandSuggestions(
  env: ReturnType<typeof import("~/lib/context.server").getEnv>,
  scannedWatchlist: { targetId?: string | null; targetLabel?: string | null },
): Promise<SignupFirstBriefBrandSuggestion[]> {
  try {
    const { loadIndexableAdsInternalLinks } = await import(
      "~/lib/ads-internal-links.server"
    );
    const {
      pickSignupFirstBriefBrandSuggestions,
      watchlistDomainForExistingHistory,
    } = await import("~/lib/first-brief");
    const links = await loadIndexableAdsInternalLinks(env);
    return pickSignupFirstBriefBrandSuggestions(
      links.map((link) => ({
        name: link.name,
        domain: link.domain,
        path: link.path,
      })),
      // Reuse the existing target-domain resolver rather than a second URL
      // parser — it already handles a bare domain, a full URL, and the
      // non-domain placeholder targets (`saved-query-1`) that must resolve to
      // null so the picker falls back to its deterministic slice.
      watchlistDomainForExistingHistory(scannedWatchlist),
    );
  } catch {
    return [];
  }
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
  const { emitFunnelFirstBriefViewed, activationResultEmailSent } =
    await import("~/lib/funnel-measurement.server");
  const { shouldEnsureFirstBrief } = await import("~/lib/first-brief");

  const { workspaceUserId } = await requireWorkspaceSession(env, request);

  const watchlists = await listWatchlists(env, workspaceUserId);
  let digests = await listDigests(env, workspaceUserId);

  // File the first brief if the activation scan has completed but no digest
  // exists yet — same gate the dashboard uses.
  let filingReason: FirstBriefFileResult["reason"] | null = null;
  if (shouldEnsureFirstBrief({ watchlists, digests })) {
    try {
      const { ensureFirstBriefForWorkspace } = await import(
        "~/lib/first-brief.server"
      );
      const result = await ensureFirstBriefForWorkspace(env, workspaceUserId);
      filingReason = result.reason;
      digests = await listDigests(env, workspaceUserId);
    } catch {
      // The waiting state below handles a missing brief; a filing failure
      // must never 500 the inline surface.
      filingReason = "create_failed";
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
    const scanned = watchlists.find(
      (w) => w.isActive && Boolean(w.lastScannedAt),
    );
    if (scanned) {
      // A scan finished, but filing did not produce an evidence-linked digest.
      // If it was an actual empty scan, the honest terminal state is `no_ads`.
      // If filing itself failed, keep the waiting/polling state so the next
      // load can retry instead of freezing the user on an empty screen.
      if (filingReason === "create_failed") {
        const activeWatchlist = watchlists.find((w) => w.isActive);
        return {
          step: "first-brief",
          status: "waiting",
          watchlistName: activeWatchlist?.targetLabel ?? null,
        };
      }
      return {
        step: "first-brief",
        status: "no_ads",
        watchlistId: scanned.id ?? null,
        watchlistName: scanned.targetLabel ?? null,
        // Issue #2411: a brand-new user's first product impression used to be
        // a dead end. Offer the nearest real value instead — 2-3 adjacent
        // already-tracked brands from the same public /brands surface the hub
        // serves (cache-only, indexability-filtered, never a dead link).
        suggestedBrands: await loadNoAdsBrandSuggestions(env, scanned),
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
    // Issue #2407: the ready state may only claim "we've emailed this brief to
    // you" when the activation-result delivery attempt actually reached
    // `sent` — a delivery failure is swallowed in the scan path, so the
    // surface must read the attempt row instead of assuming success.
    activationEmailSent: await activationResultEmailSent(env, {
      userId: workspaceUserId,
      watchlistId: payload.watchlistId,
    }),
  };
}
