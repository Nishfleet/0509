import type { LoaderFunctionArgs } from "react-router";

import { isFunnelMeasurementEnabled } from "~/lib/env.server";
import { FUNNEL_EVENT_NAMES } from "~/lib/funnel-measurement.server";

/**
 * Operator readout for the funnel measurement layer (spec §6–§7). Token-gated
 * like /api/launch-readiness; read-only; returns bounded daily aggregate
 * counts only — no raw events, no identifiers, no credentials. Anonymous
 * funnel events live exclusively in structured JSON logs (Cloudflare Workers
 * observability) and are not queryable from the worker runtime, so this
 * readout reports the runtime gate status plus the account-scoped derived
 * measures counted off existing D1 business tables (spec §3.2).
 */

const MAX_DAYS = 30;
const DEFAULT_DAYS = 14;

function hasValidCanaryToken(request: Request, token: string | undefined) {
  const configured = token?.trim();
  if (!configured) {
    return false;
  }
  return request.headers.get("x-0509-canary-token") === configured;
}

function parseDays(value: string | null): number {
  const trimmed = value?.trim();
  const parsed = Number(trimmed ?? "");
  if (!trimmed || !Number.isFinite(parsed)) {
    return DEFAULT_DAYS;
  }
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(parsed)));
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { getFunnelDailyDerivedMetrics } = await import(
    "~/lib/data/funnel-derived-metrics.server"
  );
  const env = getEnv(context);

  if (!hasValidCanaryToken(request, env.CANARY_BYPASS_TOKEN)) {
    throw new Response("Not found", { status: 404 });
  }

  if (!env.DB) {
    return Response.json(
      {
        ok: false,
        blocker: "missing_db",
        message: "D1 is not configured, so derived funnel metrics cannot be aggregated.",
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  const days = parseDays(new URL(request.url).searchParams.get("days"));
  const daily = await getFunnelDailyDerivedMetrics(env, days);

  return Response.json(
    {
      ok: true,
      collection: isFunnelMeasurementEnabled(env) ? "enabled" : "disabled",
      eventNames: FUNNEL_EVENT_NAMES,
      anonymousEvents: {
        storage: "structured_json_logs",
        queryableInRuntime: false,
      },
      gates: {
        legalReview: "not_passed",
        retentionPeriod: "unset",
        ownerApproval: "not_granted",
      },
      dailyDerivedMetrics: daily,
    },
    {
      headers: { "cache-control": "no-store" },
    },
  );
}
