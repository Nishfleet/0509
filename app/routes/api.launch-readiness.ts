import type { LoaderFunctionArgs } from "react-router";

function hasValidCanaryToken(request: Request, token: string | undefined) {
  const configured = token?.trim();
  if (!configured) {
    return false;
  }

  return request.headers.get("x-0509-canary-token") === configured;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { getLaunchReadinessSignals } = await import("~/lib/data.server");
  const { getMetaAdsBetaReadiness } = await import("~/lib/meta-ads-readiness.server");
  const env = getEnv(context);

  if (!hasValidCanaryToken(request, env.CANARY_BYPASS_TOKEN)) {
    throw new Response("Not found", { status: 404 });
  }

  if (!env.DB) {
    return Response.json(
      {
        ok: false,
        blocker: "missing_db",
        message: "D1 is not configured, so launch readiness signals cannot be checked.",
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  const [signals, metaAdsBeta] = await Promise.all([
    getLaunchReadinessSignals(env),
    getMetaAdsBetaReadiness(env),
  ]);
  const blockers = [
    signals.monitoring.recentSuccessfulRuns > 0 ? null : "no_recent_monitoring_run",
    signals.proof.recentSuccessfulCaptures > 0 ? null : "no_recent_proof_capture",
    signals.digestDelivery.recentAttempts > 0 ? null : "no_recent_digest_delivery_attempt",
    signals.digestDelivery.recentSent > 0 ? null : "no_recent_digest_sent",
    ...metaAdsBeta.blockers.map((blocker) => `meta_ads_beta:${blocker}`),
  ].filter((value): value is string => Boolean(value));

  return Response.json(
    {
      ok: blockers.length === 0,
      blockers,
      signals,
      metaAdsBeta,
    },
    {
      status: blockers.length === 0 ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
