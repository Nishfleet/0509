import type { LoaderFunctionArgs } from "react-router";

import type { AppEnv } from "~/lib/env.server";

type DependencyStatus = "ok" | "error" | "missing";

type DeepHealthBody = {
  status: "ok" | "degraded";
  app: string;
  timestamp: string;
  checks: {
    edge: "ok";
    d1: DependencyStatus;
  };
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
export async function loader({ context }: LoaderFunctionArgs) {
  const cloudflare = context.cloudflare as { env: AppEnv };
  const env = cloudflare.env;
  const d1 = await probeD1(env);
  const healthy = d1 === "ok";

  const body: DeepHealthBody = {
    status: healthy ? "ok" : "degraded",
    app: env.APP_NAME ?? "0509",
    timestamp: new Date().toISOString(),
    checks: {
      edge: "ok",
      d1,
    },
  };

  return new Response(JSON.stringify(body), {
    status: healthy ? 200 : 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
