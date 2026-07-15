import type { ActionFunctionArgs } from "react-router";

export async function action({ context, request }: ActionFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const {
    customerAgentActionErrorPayload,
    normalizeCustomerAgentActionName,
    runCustomerAgentAction,
  } = await import("~/lib/customer-agent-actions.server");
  const env = getEnv(context);
  const auth = await authenticateApiKeyRequest(env, request);
  if (!auth.ok) {
    return auth.response;
  }
  if (!auth.apiKey.actionsWriteEnabled) {
    return actionResponse(
      {
        ok: false,
        error: "actions_write_not_enabled",
        message: "Create a write-enabled API key before running account actions.",
      },
      403,
    );
  }
  const workspaceUserId = await resolveWorkspaceDataUserId(env, auth.apiKey.userId);
  const apiGate = await requireWorkspacePlanFeature(env, workspaceUserId, "api_access");
  if (!apiGate.ok) {
    return apiGate.response;
  }
  const actionsGate = await requireWorkspacePlanFeature(env, workspaceUserId, "mcp_account_actions");
  if (!actionsGate.ok) {
    return actionsGate.response;
  }

  const payload = await readJsonObject(request);
  if (!payload) {
    return actionResponse(
      {
        ok: false,
        error: "invalid_json",
        message: "POST a JSON object with action and input.",
      },
      400,
    );
  }

  const actionName = normalizeCustomerAgentActionName(readString(payload, "action"));
  if (!actionName) {
    return actionResponse(
      {
        ok: false,
        error: "unsupported_action",
        message: "Unsupported action.",
      },
      404,
    );
  }

  const input = readObject(payload, "input") ?? payload;
  const idempotencyKey =
    readString(payload, "idempotencyKey") ??
    request.headers.get("Idempotency-Key")?.trim() ??
    readString(input, "idempotencyKey") ??
    null;
  const executionContext = ((context.cloudflare as { ctx?: { waitUntil(promise: Promise<unknown>): void } } | undefined)
    ?.ctx ?? null) as ExecutionContext | null;

  try {
    const result = await runCustomerAgentAction(env, {
      userId: auth.apiKey.userId,
      apiKeyId: auth.apiKey.id,
      idempotencyKey,
      source: "api_v1",
      origin: new URL(request.url).origin,
      executionContext,
    }, actionName, input);
		const { adaptLegacyReportTransportResult } = await import("~/lib/report");

		return actionResponse(adaptLegacyReportTransportResult(result));
  } catch (error) {
    const payload = customerAgentActionErrorPayload(error);
    return actionResponse(payload.body, payload.status);
  }
}

async function readJsonObject(request: Request) {
  try {
    const payload = await request.json();
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readObject(input: Record<string, unknown>, field: string) {
  const value = input[field];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(input: Record<string, unknown>, field: string) {
  const value = input[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function actionResponse(payload: object, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
