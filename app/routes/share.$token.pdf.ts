import type { LoaderFunctionArgs } from "react-router";

import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";

// GET /share/:token/pdf — server-rendered branded PDF of a shared report
// snapshot. All validation, gating, caps, and rendering live in
// `~/lib/report-pdf.server`; this route stays a thin adapter.
export async function loader({ context, params, request }: LoaderFunctionArgs) {
	if (request.method.toUpperCase() !== "GET") {
		return new Response(null, {
			status: 405,
			headers: { Allow: "GET" },
		});
	}

	const { getEnv } = await import("~/lib/context.server");
  const { renderShareReportPdfResponse } = await import("~/lib/report-pdf.server");
  const env = getEnv(context);
  const executionContext = getOptionalCloudflareContext(context)?.ctx;

  return renderShareReportPdfResponse(env, request, params.token ?? "", executionContext);
}
