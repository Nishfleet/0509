import type { Route } from "./+types/settings.agents";

import { Link } from "react-router";

import { PAGE, PageHeading } from "../components/page-heading";
import { AgentKeys, ConnectedApps, ConnectDetails } from "../components/agent-settings";
import {
  createAgentKey,
  disconnectApp,
  readAgentAccess,
  revokeAgentKey,
} from "../lib/agent/access.server";
import { oauthHelpersContext } from "../lib/agent/context.server";
import { MCP_PATH } from "../lib/agent/paths";
import { requireSession } from "../lib/require-session.server";

export function headers() {
  return { "cache-control": "no-store" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const access = await readAgentAccess(context.get(oauthHelpersContext), request, session.user.id);
  const origin = new URL(request.url).origin;
  return { ...access, mcpUrl: `${origin}${MCP_PATH}`, origin };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireSession(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const target = form.get("id");

  if (intent === "create-key") {
    const submitted = form.get("name");
    const name = typeof submitted === "string" && submitted.trim() !== "" ? submitted.trim().slice(0, 60) : "My agent";
    return { newKey: await createAgentKey(request, name) };
  }
  if (intent === "revoke-key" && typeof target === "string") {
    await revokeAgentKey(request, target);
  }
  if (intent === "disconnect-app" && typeof target === "string") {
    await disconnectApp(context.get(oauthHelpersContext), session.user.id, target);
  }
  return { newKey: null };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className={PAGE}>
      <nav aria-label="Breadcrumb" className="text-ink-soft mb-4 font-mono text-meta uppercase">
        <Link to="/app/settings" prefetch="intent" className="underline decoration-1 underline-offset-4">
          Settings
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Agents and API</span>
      </nav>
      <PageHeading
        title="Agents and API"
        lede="Let Claude, ChatGPT, Cursor or your own code read your brief, competitors and alerts. Agents can only read, and only your workspace."
      />
      <ConnectDetails mcpUrl={loaderData.mcpUrl} origin={loaderData.origin} />
      <ConnectedApps apps={loaderData.apps} />
      <AgentKeys keys={loaderData.keys} newKey={actionData?.newKey ?? null} />
    </main>
  );
}
