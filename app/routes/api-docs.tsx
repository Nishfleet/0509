import type { Route } from "./+types/api-docs";

import { ApiReference } from "../components/api-reference";
import { openApiDocument } from "../lib/agent/openapi";
import { MCP_PATH } from "../lib/agent/paths";

export function meta() {
  return [
    { title: "API reference · Five to Nine" },
    { name: "description", content: "Read-only REST API for your Five to Nine account." },
  ];
}

export function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  return {
    document: openApiDocument(origin),
    mcpUrl: `${origin}${MCP_PATH}`,
    settingsHref: "/app/settings/agents",
  };
}

export default function ApiDocs({ loaderData }: Route.ComponentProps) {
  return <ApiReference {...loaderData} />;
}
