import { env } from "cloudflare:workers";

import { healthResponse } from "../lib/observability/health.server";

export function loader() {
  return healthResponse(env.DB);
}
