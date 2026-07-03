export {
  DeveloperAccessRoute as default,
  developerAccessMeta as meta,
} from "~/routes/app.developer-access.ui";
export {
  DeveloperAccessHydrateFallback as HydrateFallback,
  WorkspaceSettingsErrorBoundary as ErrorBoundary,
} from "~/routes/workspace-settings.shared";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const developerAccessActionIntents = new Set([
  "create-api-key",
  "revoke-api-key",
]);

export function handlesDeveloperAccessIntent(intent: string) {
  return developerAccessActionIntents.has(intent);
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { listCustomerApiKeys } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const apiKeys = await listCustomerApiKeys(env, workspaceUserId);

  return {
    apiKeys: apiKeys.map((apiKey) => ({
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      actionsWriteEnabled: apiKey.actionsWriteEnabled,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
    })),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (isMember && handlesDeveloperAccessIntent(intent)) {
    return {
      ok: false,
      message: "Only the account owner can manage developer access and API keys.",
    };
  }

  if (intent === "create-api-key") {
    const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
    const apiGate = await requireWorkspacePlanFeature(env, workspaceUserId, "api_access");
    if (!apiGate.ok) {
      return { ok: false, message: "Developer access is included in the Agency plan." };
    }
    const { createCustomerApiKey } = await import("~/lib/api-keys.server");
    const name = String(formData.get("apiKeyName") ?? "");
    const result = await createCustomerApiKey(env, workspaceUserId, name, {
      actionsWriteEnabled: formData.get("actionsWriteEnabled") === "1",
    });

    return {
      ok: true,
      message: "API key created. Copy it now; it will not be shown again.",
      apiKeySecret: result.secret,
      apiKeyPrefix: result.apiKey.keyPrefix,
    };
  }

  if (intent === "revoke-api-key") {
    const { revokeCustomerApiKey } = await import("~/lib/data.server");
    const apiKeyId = String(formData.get("apiKeyId") ?? "");
    await revokeCustomerApiKey(env, {
      userId: workspaceUserId,
      apiKeyId,
    });

    return {
      ok: true,
      message: "API key revoked.",
    };
  }

  return {
    ok: false,
    message: "Unknown developer access action.",
  };
}
