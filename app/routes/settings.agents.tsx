import type { Route } from "./+types/settings.agents";

import { Link } from "react-router";

import { PAGE, PageHeading } from "../components/page-heading";
import { AgentKeys, ConnectedApps, ConnectDetails } from "../components/agent-settings";
import { createAgentKey, disconnectApp, readAgentAccess, revokeAgentKey } from "../lib/agent/access.server";
import { oauthHelpersContext } from "../lib/agent/context.server";
import { MCP_PATH } from "../lib/agent/paths";
import { requireFreshSession } from "../lib/require-session.server";

const SUBMISSION = /^[0-9a-f-]{36}$/;

export function meta() {
  return [{ title: "Agents and API · Five to Nine" }];
}

export function headers() {
  return { "cache-control": "no-store" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireFreshSession(request);
  const access = await readAgentAccess(context.get(oauthHelpersContext), request, session.user.id);
  const origin = new URL(request.url).origin;
  return { ...access, mcpUrl: `${origin}${MCP_PATH}`, origin, submission: crypto.randomUUID() };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireFreshSession(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const target = form.get("id");

  if (intent === "create-key") {
    const submitted = form.get("name");
    const name = typeof submitted === "string" && submitted.trim() !== "" ? submitted.trim().slice(0, 60) : "My agent";
    const token = form.get("submission");
    const submission = typeof token === "string" && SUBMISSION.test(token) ? token : crypto.randomUUID();
    return { newKey: await createAgentKey(request, name, submission) };
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
      <AgentKeys keys={loaderData.keys} newKey={actionData?.newKey ?? null} submission={loaderData.submission} />
    </main>
  );
}
