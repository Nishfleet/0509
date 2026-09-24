import type { Route } from "./+types/mcp";

import { agentPropsContext } from "../lib/agent/context.server";
import { mcpResponse } from "../lib/agent/serve.server";

export function loader({ request, context }: Route.LoaderArgs) {
  return mcpResponse(request, context.get(agentPropsContext));
}

export function action({ request, context }: Route.ActionArgs) {
  return mcpResponse(request, context.get(agentPropsContext));
}
