import type { ActionFunctionArgs } from "react-router";

import {
  E2E_AUTH_FAULT_HEADER,
  E2E_AUTH_FAULT_VALUE,
  resolveE2EAuthFaultRequest,
} from "~/lib/auth.server";

const J6_AUTH_USER_ID = "e2e-starter";
const J6_AUTH_VIEWPORTS = ["375x812", "768x900", "1440x900"] as const;

export type J6AuthReplayAction = "auth_outage" | "auth_recovery";
export type J6AuthReplayOutcome = "outage" | "recovery";
export type J6AuthViewport = (typeof J6_AUTH_VIEWPORTS)[number];

export interface J6AuthReplayMapping {
  action: J6AuthReplayAction;
  outcome: J6AuthReplayOutcome;
  userId: typeof J6_AUTH_USER_ID;
  runId: string;
  viewport: J6AuthViewport;
}

const J6_AUTH_REPLAY_ACTIONS: Readonly<Record<string, J6AuthReplayMapping>> = Object.freeze(
  Object.fromEntries(
    J6_AUTH_VIEWPORTS.flatMap((viewport) =>
      (["outage", "recovery"] as const).map((outcome) => {
        const action = outcome === "outage" ? "auth_outage" : "auth_recovery";
        const key = `e2e-j6-auth-${outcome}-${viewport}`;
        return [key, {
          action,
          outcome,
          userId: J6_AUTH_USER_ID,
          runId: `e2e-run-j6-auth-${outcome}-${viewport}`,
          viewport,
        } satisfies J6AuthReplayMapping];
      }),
    ),
  ),
);

export function resolveJ6AuthReplayMapping(
  idempotencyKey: string,
  userId: string,
  runId: string,
) {
  const mapping = J6_AUTH_REPLAY_ACTIONS[idempotencyKey];
  return mapping?.userId === userId && mapping.runId === runId ? mapping : null;
}

export function resolveJ6AuthReplayAction(
  idempotencyKey: string,
  userId: string,
  runId: string,
) {
  return resolveJ6AuthReplayMapping(idempotencyKey, userId, runId)?.action ?? null;
}

export function resolveJ6AuthFaultRequest(request: Request) {
  return resolveE2EAuthFaultRequest(request);
}

export async function action({ context, request }: ActionFunctionArgs) {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return notFound();
  }
  if (request.method !== "POST" || url.pathname !== "/api/e2e/auth/replay") {
    return notFound();
  }

  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const [{ resolveE2EProviderDeny }, { isE2ETestRequestEnabled }, guardModule] = await Promise.all([
    import("~/lib/e2e-provider.server"),
    import("~/lib/e2e-auth.server"),
    import("~/lib/e2e-harness-guard.server"),
  ]);
  const networkDeny = await resolveE2EProviderDeny(env, request);
  const testModeEnabled = await isE2ETestRequestEnabled(env, request);
  const guarded = await guardModule.guardE2EHarnessReplayRequest(request, {
    networkDeny,
    testMode: {
      enabled: testModeEnabled,
      sentinel: networkDeny.enabled && networkDeny.failClosed,
    },
  });
  if (!guarded.ok || guarded.metadata.scenario !== "j6") return notFound();

  const mapping = resolveJ6AuthReplayMapping(
    guarded.metadata.idempotencyKey,
    guarded.metadata.userId,
    guarded.metadata.runId,
  );
  if (!mapping) return notFound();

  return noStoreJson({
    ok: true,
    replayed: false,
    scenario: "j6",
    action: mapping.action,
    outcome: mapping.outcome,
    persona: mapping.userId,
    viewport: mapping.viewport,
    auth: mapping.outcome === "outage"
      ? {
          status: "unavailable",
          faultHeader: E2E_AUTH_FAULT_HEADER,
          faultValue: E2E_AUTH_FAULT_VALUE,
        }
      : {
          status: "recovered",
          faultHeader: E2E_AUTH_FAULT_HEADER,
          faultValue: null,
        },
    provider: { called: false, reason: "e2e_network_denied" },
    cleanup: {
      rawProviderIdsExposed: false,
      rawErrorsExposed: false,
      piiExposed: false,
      rawCookieExposed: false,
      rawTokenExposed: false,
    },
  });
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function notFound() {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}
