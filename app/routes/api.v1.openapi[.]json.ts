import type { Route } from "./+types/api.v1.openapi[.]json";

import { openApiDocument } from "../lib/agent/openapi";

export function loader({ request }: Route.LoaderArgs) {
  return Response.json(openApiDocument(new URL(request.url).origin), {
    headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
  });
}
