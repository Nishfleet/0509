import type { Route } from "./+types/api.v1.alerts";

import { readAgentAlerts } from "../lib/agent/read.server";
import { apiResponse } from "../lib/agent/serve.server";

export function loader({ request }: Route.LoaderArgs) {
  return apiResponse(request, readAgentAlerts);
}
