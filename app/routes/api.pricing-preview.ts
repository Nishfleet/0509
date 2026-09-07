import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { publicCommercialLaunchSummary } = await import("~/lib/commercial-launch-gate.server");
  const { previewDodo0509PlanPrices } = await import("~/lib/dodo-pricing.server");
  const env = getEnv(context);
  const versionBoundCanary = request.headers.has("x-0509-expected-worker-version");
  if (versionBoundCanary) {
    const configured = env.CANARY_BYPASS_TOKEN?.trim();
    const token = request.headers.get("x-0509-canary-token");
    const { verifyExpectedCanaryWorkerVersion } = await import(
      "~/lib/canary-release-identity.server"
    );
    if (!configured || token !== configured || !verifyExpectedCanaryWorkerVersion(request, env).ok) {
      return Response.json(
        { available: false, reason: "worker_version_mismatch" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const preview = await previewDodo0509PlanPrices({
    env,
    request,
  });

  return Response.json(
    {
      ...preview,
      commercialLaunch: publicCommercialLaunchSummary(env),
      ...(versionBoundCanary ? { workerVersionId: env.CF_VERSION_METADATA?.id ?? null } : {}),
    },
    {
      headers: {
        "Cache-Control": versionBoundCanary ? "no-store" : preview.available ? "private, max-age=300" : "no-store",
      },
    },
  );
}

export function action(_args: ActionFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use GET." },
    { status: 405, headers: { Allow: "GET" } },
  );
}
