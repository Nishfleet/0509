import { currentHealthResponse } from "../lib/observability/health.server";

export function loader() {
  return currentHealthResponse();
}
