import type { LoaderFunctionArgs } from "react-router";

// Cheap uptime probe for Cloudflare health checks and external monitors.
// Does NOT touch D1 — must stay a pure edge check so a DB blip doesn't
// make the worker look unhealthy to the monitor.
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

// Explicitly return null — this route is loader-only, no UI.
export default function ApiHealth() {
  return null;
}
