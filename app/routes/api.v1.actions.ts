import type { ActionFunctionArgs } from "react-router";

import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";

const MAX_AUTHENTICATED_API_BODY_BYTES = 64 * 1024;

export async function action({ context, request }: ActionFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const {
    createAuthenticatedApiLimitContext,
    enforceAuthenticatedApiLimit,
    verifyAuthenticatedApiIdentity,
  } = await import("~/lib/authenticated-api-limits.server");
  const cloudflare = getOptionalCloudflareContext(context);
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
  const apiLimit = createAuthenticatedApiLimitContext(env, {
    workspaceUserId,
    actorUserId: auth.apiKey.userId,
    apiKeyId: auth.apiKey.id,
  });
  const apiGate = await requireWorkspacePlanFeature(env, workspaceUserId, "api_access");
  if (!apiGate.ok) {
    return apiGate.response;
  }
  const actionsGate = await requireWorkspacePlanFeature(env, workspaceUserId, "mcp_account_actions");
  if (!actionsGate.ok) {
    return actionsGate.response;
  }

  const payloadResult = await readJsonObject(request);
  if (!payloadResult.ok) return payloadResult.response;
  const payload = payloadResult.value;
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

  const limitResponse = await enforceAuthenticatedApiLimit({
    env,
    ...apiLimit,
    operation: "api.v1.actions",
    actionName,
    request,
  });
  if (limitResponse) return normalizedLimitResponse(limitResponse);

  const input = readObject(payload, "input") ?? payload;
  const idempotencyKey =
    readString(payload, "idempotencyKey") ??
    request.headers.get("Idempotency-Key")?.trim() ??
    readString(input, "idempotencyKey") ??
    null;
  const executionContext = cloudflare?.ctx ?? null;

  try {
    const result = await runCustomerAgentAction(env, {
      userId: auth.apiKey.userId,
      apiKeyId: auth.apiKey.id,
      idempotencyKey,
      source: "api_v1",
      origin: new URL(request.url).origin,
      executionContext,
      authorizeExternalEffect: async () => {
        const response = await verifyAuthenticatedApiIdentity({
          ...apiLimit,
          operation: "api.v1.actions.external-effect",
          actionName,
        });
        if (response) throw response;
      },
    }, actionName, input);
		const { adaptLegacyReportTransportResult } = await import("~/lib/report");

		return actionResponse(adaptLegacyReportTransportResult(result));
  } catch (error) {
    const payload = customerAgentActionErrorPayload(error);
    return actionResponse(payload.body, payload.status);
  }
}

async function readJsonObject(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_AUTHENTICATED_API_BODY_BYTES) {
    return { ok: false as const, response: requestTooLargeResponse() };
  }
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_AUTHENTICATED_API_BODY_BYTES) {
      return { ok: false as const, response: requestTooLargeResponse() };
    }
    const payload = JSON.parse(body);
    return {
      ok: true as const,
      value: payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : null,
    };
  } catch {
    return { ok: true as const, value: null };
  }
}

function requestTooLargeResponse() {
  return actionResponse(
    {
      ok: false,
      error: "request_too_large",
      message: "Authenticated action payloads must be 64 KB or smaller.",
    },
    413,
  );
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
  const error = "error" in payload && typeof payload.error === "string" ? payload.error : null;
  const retryAfter = "retryAfterSeconds" in payload && typeof payload.retryAfterSeconds === "number"
    ? String(Math.max(1, payload.retryAfterSeconds))
    : null;
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(error === "invalid_api_key" ? { "WWW-Authenticate": 'Bearer realm="0509 API"' } : {}),
      ...(retryAfter ? { "Retry-After": retryAfter } : {}),
    },
  });
}

function normalizedLimitResponse(response: Response) {
  const isRateLimited = response.status === 429;
  const retryAfter = Number(response.headers.get("Retry-After"));
  return actionResponse(
    {
      ok: false,
      error: isRateLimited ? "rate_limited" : "rate_limit_unavailable",
      message: isRateLimited
        ? "Too many authenticated requests. Please try again shortly."
        : "Authenticated request limits are temporarily unavailable. Please try again shortly.",
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 1
        ? Math.ceil(retryAfter)
        : 1,
    },
    response.status,
  );
}
