import type { LoaderFunctionArgs } from "react-router";

import { getCloudflareContext } from "~/lib/cloudflare-context";
import { summarizeErrorReports } from "~/lib/error-report.server";

/**
 * Issue #2988: detail view behind the /api/health/deep `errorReports` count
 * line. Unauthenticated but rate-limited under the normal /api/* api-read
 * bucket (same policy as /api/health/deep), because the operator judges read
 * it unattended. Rows carry no user identifiers — route, reason code, message
 * and a stack sample only, redacted by the sink's message truncation.
 */
export async function loader({ context }: LoaderFunctionArgs) {
  const env = getCloudflareContext(context).env;
  const summary = await summarizeErrorReports(env);
  const counts = summary.counts ?? [];
  const recent = summary.recent ?? [];
  return new Response(
    JSON.stringify({
      status: summary.counts === null || summary.recent === null ? "unavailable" : "ok",
      lookbackHours: 24,
      total: counts.reduce((sum, row) => sum + Number(row.count ?? 0), 0),
      counts,
      recent,
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
