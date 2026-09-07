export {
  SourceAccessRoute as default,
  sourceAccessMeta as meta,
} from "~/routes/app.source-access.ui";
export {
  SourceAccessHydrateFallback as HydrateFallback,
  WorkspaceSettingsErrorBoundary as ErrorBoundary,
} from "~/routes/workspace-settings.shared";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const sourceAccessActionIntents = new Set([
  "connect-meta-token",
  "retest-meta-token",
  "disconnect-meta-token",
]);

function sourceAccessActionMessage(input: {
  ok: boolean;
  status?: string | null;
  errorCode?: string | null;
}) {
  if (input.ok || input.status === "healthy") {
    return "Backup source access is connected and ready.";
  }

  switch (input.errorCode) {
    case "invalid_format":
      return "Paste the full access token and try again.";
    case "missing_connection":
      return "No backup source access is connected yet.";
    case "timeout":
      return "The source access check timed out. Try again in a moment.";
    case "network_error":
    case "invalid_provider_response":
      return "The source access check could not be completed. Try again in a moment.";
    default:
      return "Source access could not be verified. Check the token and try again.";
  }
}

export function handlesSourceAccessIntent(intent: string) {
  return sourceAccessActionIntents.has(intent);
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } =
    await import("~/lib/ad-source.server");
  const { toCustomerDiscoveryStatus, toCustomerMetaConnection } =
    await import("~/lib/discovery-customer-copy");
  const { getEnv } = await import("~/lib/context.server");
  const { getCustomerMetaConnection } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { workspaceUserId, isMember } = await requireWorkspaceSession(
    env,
    request,
  );
  const [connection, discoveryStatus] = await Promise.all([
    isMember
      ? Promise.resolve(null)
      : getCustomerMetaConnection(env, workspaceUserId),
    resolveCommercialAdSourceStatus(env),
  ]);

  return {
    connection: connection ? toCustomerMetaConnection(connection) : null,
    discoveryStatus: toCustomerDiscoveryStatus(discoveryStatus),
    canManageSourceAccess: !isMember,
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
  const { workspaceUserId, isMember } = await requireWorkspaceSession(
    env,
    request,
  );
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (isMember && handlesSourceAccessIntent(intent)) {
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
      message: sourceAccessActionMessage({
        ok: result.ok || result.testResult?.ok === true,
        status: result.testResult?.status,
        errorCode: result.testResult?.errorCode,
      }),
    };
  }

  if (intent === "retest-meta-token") {
    const result = await retestSavedCustomerMetaToken(env, workspaceUserId);

    return {
      ok: result.ok,
      message: sourceAccessActionMessage({
        ok: result.ok || result.testResult?.ok === true,
        status: result.testResult?.status,
        errorCode: result.testResult?.errorCode,
      }),
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
