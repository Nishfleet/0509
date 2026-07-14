import type { LoaderFunctionArgs } from "react-router";

// GET /share/:token/pdf — server-rendered branded PDF of a shared report
// snapshot. All validation, gating, caps, and rendering live in
// `~/lib/report-pdf.server`; this route stays a thin adapter.
export async function loader({ context, params, request }: LoaderFunctionArgs) {
	const { getEnv } = await import("~/lib/context.server");
	const { renderShareReportPdfResponse } = await import("~/lib/report-pdf.server");
	const env = getEnv(context);
	const executionContext = ((context as { cloudflare?: { ctx?: ExecutionContext } } | undefined)
		?.cloudflare?.ctx ?? undefined);

	return renderShareReportPdfResponse(env, request, params.token ?? "", executionContext);
}
