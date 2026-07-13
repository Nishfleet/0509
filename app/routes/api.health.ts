import type { LoaderFunctionArgs } from "react-router";

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
  const cloudflare = context.cloudflare as { env: Env };
  const env = cloudflare.env;

  return new Response(
    JSON.stringify({
      status: "ok",
      app: env.APP_NAME ?? "0509",
      timestamp: new Date().toISOString(),
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
