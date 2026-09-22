import type { Route } from "./+types/media.$";

import { captureDimensions } from "../lib/capture-image";
import { captureObjectResponse } from "../lib/capture-image.server";

export async function loader({ params, request }: Route.LoaderArgs) {
  const key = params["*"];
  if (!key) {
    return new Response("Missing capture key.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const url = new URL(request.url);
  const size = captureDimensions(url.searchParams.get("width"), url.searchParams.get("height"));
  if (!size) {
    return new Response("Width and height are required.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return captureObjectResponse(key, size.width, size.height);
}
