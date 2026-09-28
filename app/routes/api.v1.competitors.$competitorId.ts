import type { Route } from "./+types/api.v1.competitors.$competitorId";

import { readAgentCompetitor } from "../lib/agent/read.server";
import { competitorResultSchema } from "../lib/agent/schemas";
import { apiResponse } from "../lib/agent/serve.server";

export function loader({ request, params }: Route.LoaderArgs) {
  return apiResponse(request, async (workspaceId) =>
    competitorResultSchema.parse(await readAgentCompetitor(workspaceId, params.competitorId)),
  );
}
