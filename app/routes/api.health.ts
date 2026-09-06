import type { LoaderFunctionArgs } from "react-router";

import { getCloudflareContext } from "~/lib/cloudflare-context";
import { readReleaseIdentity } from "~/lib/canary-release-identity.server";

// Cheap uptime probe for Cloudflare health checks and external monitors.
// Does NOT touch D1 — must stay a pure edge check so a DB blip doesn't
// make the worker look unhealthy to the monitor.
//
// For a D1 dependency check, use `/api/health/deep` (rate-limited).
//
// Resource route pattern (React Router v7): only a loader, no default
// export. Without a component export, RR v7 returns the loader's Response
// directly instead of wrapping it in the root HTML layout. See
// `app/routes/api.auth.$.ts` for the same pattern.
export async function loader({ context }: LoaderFunctionArgs) {
  const cloudflare = getCloudflareContext(context);
  const env = cloudflare.env;
  const normalizeIdentifier = (value: unknown) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    return /^[A-Za-z0-9._-]{1,128}$/.test(normalized) ? normalized : null;
  };
  const releaseIdentity = readReleaseIdentity(env);

  return new Response(
    JSON.stringify({
      status: "ok",
      app: normalizeIdentifier(env.APP_NAME) ?? "0509",
      timestamp: new Date().toISOString(),
      releaseIdentity,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
