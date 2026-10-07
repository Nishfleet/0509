import type { Route } from "./+types/settings.agents";

import { Link } from "react-router";
import { z } from "zod";

import { PAGE, PageHeading } from "../components/page-heading";
import { AgentKeys, ConnectedApps, ConnectDetails } from "../components/agent-settings";
import { createAgentKey, disconnectApp, readAgentAccess, revokeAgentKey } from "../lib/agent/access.server";
import { oauthHelpersContext } from "../lib/agent/context.server";
import { MCP_PATH } from "../lib/agent/paths";
import { requireFreshSession, sessionContext } from "../lib/require-session.server";

const agentActionForm = z.object({
  intent: z.string(),
  id: z.string().optional(),
});

export function meta() {
  return [{ title: "Agents and API · Five to Nine" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireFreshSession(request);
  const access = await readAgentAccess(context.get(oauthHelpersContext), request, session.user.id);
  const origin = new URL(request.url).origin;
  return { ...access, mcpUrl: `${origin}${MCP_PATH}`, origin, submission: crypto.randomUUID() };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = context.get(sessionContext);
  const form = await request.formData();
  const parsed = agentActionForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { newKey: null, duplicate: false };
  const { intent, id: target } = parsed.data;

  if (intent === "create-key") return await createAgentKey(request, form);
  if (intent === "revoke-key" && target !== undefined) {
    await revokeAgentKey(request, target);
  }
  if (intent === "disconnect-app" && target !== undefined) {
    await disconnectApp(context.get(oauthHelpersContext), session.user.id, target);
  }
  return { newKey: null, duplicate: false };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className={PAGE}>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center font-mono text-meta text-ink-soft uppercase">
        <Link
          to="/app/settings"
          prefetch="intent"
          className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4"
        >
          Settings
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Agents and API</span>
      </nav>
      <PageHeading
        title="Agents and API"
        lede="Let Claude, ChatGPT, Cursor or your own code read your brief, competitors and alerts. Agents can only read, and only your own account."
      />
      <ConnectDetails mcpUrl={loaderData.mcpUrl} origin={loaderData.origin} />
      <ConnectedApps apps={loaderData.apps} />
      <AgentKeys
        keys={loaderData.keys}
        newKey={actionData?.newKey ?? null}
        duplicate={actionData?.duplicate ?? false}
        submission={loaderData.submission}
      />
    </div>
  );
}
