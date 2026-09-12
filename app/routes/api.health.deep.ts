import type { LoaderFunctionArgs } from "react-router";

import { getCloudflareContext } from "~/lib/cloudflare-context";
import {
  mayReadReleaseIdentity,
  readReleaseIdentity,
} from "~/lib/canary-release-identity.server";
import type { AppEnv } from "~/lib/env.server";
import {
  listScheduledObservationHealth,
  readScheduledObservationGapCheckHealth,
  type ScheduledObservationGapCheckStatus,
} from "~/lib/scheduled-observation-health.server";

type DependencyStatus = "ok" | "error" | "missing";
type ScheduledWorkStatus = "ok" | "degraded" | "missing";

type DeepHealthBody = {
  status: "ok" | "degraded";
  app: string;
  timestamp: string;
  /**
   * Issue #2988: informational count line the hourly judges read. Degrade
   * catches (and thrown loader/action errors) land in the error_report sink;
   * this surfaces the 24-hour total without flipping overall health —
   * a single caught degrade is exactly the honest state we chose, not an
   * outage. The detailed row-level view lives on
   * /api/observability/error-reports.
   */
  errorReports?: { last24h: number; reported: boolean };
  checks: {
    edge: "ok";
    d1: DependencyStatus;
    scheduledWork: ScheduledWorkStatus;
    /**
     * Freshness of the hourly gap-check cron's own heartbeat. This is its own
     * check, never a member of `scheduledWork`: the soak contract only covers
     * the four workload crons, so the gap check dying silently used to leave
     * `scheduledWork` green (issue #2368).
     */
    scheduledGapCheck: ScheduledObservationGapCheckStatus;
  };
  releaseIdentity?: ReturnType<typeof readReleaseIdentity>;
};

async function probeD1(env: AppEnv): Promise<DependencyStatus> {
  if (!env.DB) {
    return "missing";
  }

  try {
    await env.DB.prepare("SELECT 1").first();
    return "ok";
  } catch {
    return "error";
  }
}

// Deep dependency probe for operators. Unauthenticated but rate-limited via
// the normal /api/* api-read bucket (unlike /api/health, which stays edge-only
// and rate-limit-exempt so uptime monitors stay green during a DB outage).
export async function loader({ context, request }: LoaderFunctionArgs) {
  const cloudflare = getCloudflareContext(context);
  const env = cloudflare.env;
  const releaseIdentity = readReleaseIdentity(env);
  const d1 = await probeD1(env);
  let scheduledWork: ScheduledWorkStatus = "missing";
  if (d1 === "ok") {
    try {
      const health = await listScheduledObservationHealth(env);
      scheduledWork = health.some(
        (entry) => entry.overdue || entry.futureEvidence,
      )
        ? "degraded"
        : "ok";
    } catch {
      scheduledWork = "missing";
    }
  }
  // Read unconditionally: the heartbeat lives in object storage, not D1, so a
  // D1 outage must not hide whether the hourly gap-check cron is running.
  const scheduledGapCheck = await readScheduledObservationGapCheckHealth(env, {
    deployedAt: releaseIdentity.timestamp,
  });
  const healthy =
    d1 === "ok" &&
    scheduledWork === "ok" &&
    scheduledGapCheck.status === "ok";
  const showReleaseIdentity = await mayReadReleaseIdentity(request, env);

  let errorReports: DeepHealthBody["errorReports"];
  if (d1 === "ok") {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const countRow = await env.DB!.prepare(
        "SELECT COUNT(*) AS n FROM error_report WHERE created_at >= ?",
      )
        .bind(since)
        .first<{ n: number }>();
      errorReports = { last24h: countRow?.n ?? 0, reported: true };
    } catch {
      errorReports = { last24h: -1, reported: false };
    }
  }

  const body: DeepHealthBody = {
    status: healthy ? "ok" : "degraded",
    app: env.APP_NAME ?? "0509",
    timestamp: new Date().toISOString(),
    checks: {
      edge: "ok",
      d1,
      scheduledWork,
      scheduledGapCheck: scheduledGapCheck.status,
    },
    ...(errorReports ? { errorReports } : {}),
    ...(showReleaseIdentity ? { releaseIdentity } : {}),
  };

  return new Response(JSON.stringify(body), {
    status: healthy ? 200 : 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
