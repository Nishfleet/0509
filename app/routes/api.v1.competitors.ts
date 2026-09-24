import type { Route } from "./+types/api.v1.competitors";

import { readAgentCompetitors } from "../lib/agent/read.server";
import { apiResponse } from "../lib/agent/serve.server";

export function loader({ request }: Route.LoaderArgs) {
  return apiResponse(request, readAgentCompetitors);
}
