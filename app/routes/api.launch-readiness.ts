import type { LoaderFunctionArgs } from "react-router";

function isWhatsAppLaunchScoped(input: {
  providerConfigured: boolean;
  customerReady: boolean;
  webhookConfigured: boolean;
  usableTargets: number;
  recentAttempts: number;
  recentSent: number;
}) {
  return (
    input.providerConfigured ||
    input.customerReady ||
    input.webhookConfigured ||
    input.usableTargets > 0 ||
    input.recentAttempts > 0 ||
    input.recentSent > 0
  );
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { getLaunchReadinessSignals } = await import("~/lib/data.server");
  const { isWhatsAppDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
  const { getMetaAdsBetaReadiness } = await import("~/lib/meta-ads-readiness.server");
  const { hasValidCanaryToken } = await import("~/lib/canary-token.server");
  const env = getEnv(context);

  if (!(await hasValidCanaryToken(request, env.CANARY_BYPASS_TOKEN))) {
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

  try {
    const [signals, metaAdsBeta] = await Promise.all([
      getLaunchReadinessSignals(env),
      getMetaAdsBetaReadiness(env),
    ]);
    const whatsappLaunchScoped =
      isWhatsAppDeliveryCustomerFacing() && isWhatsAppLaunchScoped(signals.whatsappDelivery);
    const blockers = [
      signals.monitoring.recentSuccessfulRuns > 0 ? null : "no_recent_monitoring_run",
      signals.proof.recentSuccessfulCaptures > 0 ? null : "no_recent_proof_capture",
      signals.digestDelivery.recentAttempts > 0 ? null : "no_recent_email_delivery_attempt",
      signals.digestDelivery.recentSent > 0 ? null : "no_recent_email_sent",
      whatsappLaunchScoped && !signals.whatsappDelivery.providerConfigured
        ? "whatsapp_provider_not_configured"
        : null,
      whatsappLaunchScoped && !signals.whatsappDelivery.customerReady
        ? "whatsapp_customer_delivery_not_enabled"
        : null,
      whatsappLaunchScoped && !signals.whatsappDelivery.webhookConfigured
        ? "whatsapp_webhook_not_configured"
        : null,
      whatsappLaunchScoped && signals.whatsappDelivery.usableTargets === 0
        ? "no_usable_whatsapp_delivery_target"
        : null,
      whatsappLaunchScoped && signals.whatsappDelivery.recentSent === 0
        ? "no_recent_whatsapp_delivered"
        : null,
      ...metaAdsBeta.blockers.map((blocker) => `meta_ads_beta:${blocker}`),
    ].filter((value): value is string => Boolean(value));
    const advisories = [
      signals.emailDelivery.recentSent > 0 ? null : "no_recent_general_email_provider_accepted",
      signals.slackDelivery.usableTargets > 0 ? null : "no_slack_delivery_target",
      signals.slackDelivery.recentSent > 0 ? null : "no_recent_slack_sent",
    ].filter((value): value is string => Boolean(value));

    return Response.json(
      {
        ok: blockers.length === 0,
        blockers,
        blockerDetails: {
          no_recent_email_delivery_attempt: {
            scope: "digest_email",
            meaning: "No recent digest email delivery attempt was recorded.",
          },
          no_recent_email_sent: {
            scope: "digest_email",
            meaning: "No recent digest email provider acceptance was recorded.",
          },
        },
        advisories,
        signals,
        launchScope: {
          whatsapp: whatsappLaunchScoped,
          slack: false,
        },
        metaAdsBeta,
      },
      {
        status: blockers.length === 0 ? 200 : 503,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    // Fail closed with the partial-state identifier, same contract as the
    // canary route's catch (#3146): an unhandled throw here used to escape as
    // a bare 500, which Gate C's verifier journaled as blockers:[] — a real
    // outage disguised as "0 blockers" (#3392). Re-throw Response objects
    // unchanged; only ordinary exceptions become the unified blocker, with a
    // sanitized reason/detail the verifier can re-project and a D1 error-sink
    // row so the failure class survives without Workers Logs access.
    if (error instanceof Response) {
      throw error;
    }
    console.error("launch readiness signals query failed", {
      kind: "launch_readiness_signals_failed",
      message: error instanceof Error ? error.message : String(error),
    });
    const { safeCanaryDetail, sanitizeCanaryFailureReason } = await import(
      "~/lib/canary-detail"
    );
    const detail = safeCanaryDetail(error);
    try {
      const { reportError } = await import("~/lib/error-report.server");
      await reportError(env, {
        route: "api.launch-readiness",
        reasonCode: "launch_readiness_signals_failed",
        error,
      });
    } catch {
      // the sink must never mask the original failure
    }
    const reason = sanitizeCanaryFailureReason(
      error instanceof Error ? error.message : String(error),
    );
    return Response.json(
      {
        ok: false,
        blocker: "launch_readiness_signals_failed",
        blockers: ["launch_readiness_signals_failed"],
        message: "Launch readiness signals could not be loaded.",
        detail,
        ...(reason ? { reason } : {}),
        signals: null,
        metaAdsBeta: null,
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
