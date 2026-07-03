export {
  WorkspaceSettingsErrorBoundary as ErrorBoundary,
  SourceAccessHydrateFallback as HydrateFallback,
  sourceAccessMeta as meta,
  SourceAccessRoute as default,
} from "~/routes/app.workspace-settings";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const ownerOnlySourceIntents = new Set([
  "connect-meta-token",
  "retest-meta-token",
  "disconnect-meta-token",
]);

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getCustomerMetaConnection } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const [connection, discoveryStatus] = await Promise.all([
    getCustomerMetaConnection(env, workspaceUserId),
    resolveCommercialAdSourceStatus(env),
  ]);

  return {
    connection: connection
      ? {
          status: connection.status,
          tokenLastFour: connection.tokenLastFour,
          summary: connection.summary,
          lastCheckedAt: connection.lastCheckedAt,
          lastErrorCode: connection.lastErrorCode,
          lastErrorMessage: connection.lastErrorMessage,
          updatedAt: connection.updatedAt,
        }
      : null,
    discoveryStatus,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    disconnectCustomerMetaToken,
    retestSavedCustomerMetaToken,
    saveCustomerMetaToken,
  } = await import("~/lib/customer-meta.server");
  const env = getEnv(context);
  const { workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (isMember && ownerOnlySourceIntents.has(intent)) {
    return {
      ok: false,
      message: "Only the account owner can manage source access.",
    };
  }

  if (intent === "connect-meta-token") {
    const token = String(formData.get("metaToken") ?? "");
    const result = await saveCustomerMetaToken(env, workspaceUserId, token);

    return {
      ok: result.ok,
      message: result.testResult.summary,
    };
  }

  if (intent === "retest-meta-token") {
    const result = await retestSavedCustomerMetaToken(env, workspaceUserId);

    return {
      ok: result.ok,
      message: result.testResult.summary,
    };
  }

  if (intent === "disconnect-meta-token") {
    await disconnectCustomerMetaToken(env, workspaceUserId);
    return {
      ok: true,
      message: "Backup Meta access disconnected.",
    };
  }

  return {
    ok: false,
    message: "Unknown source access action.",
  };
}
