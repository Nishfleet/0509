import type { Route } from "./+types/api.v1.standing";

import { readAgentStanding } from "../lib/agent/read.server";
import { standingResultSchema } from "../lib/agent/schemas";
import { apiResponse } from "../lib/agent/serve.server";

export function loader({ request }: Route.LoaderArgs) {
  return apiResponse(request, async (workspaceId) => standingResultSchema.parse(await readAgentStanding(workspaceId)));
}
