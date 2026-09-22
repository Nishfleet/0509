import type { Route } from "./+types/media.$";

import { captureObjectResponse } from "../lib/capture-image.server";

function dimension(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2000) return 0;
  return parsed;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const key = params["*"];
  if (!key) {
    return new Response("Missing capture key.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const url = new URL(request.url);
  return captureObjectResponse(key, dimension(url.searchParams.get("width")), dimension(url.searchParams.get("height")));
}
