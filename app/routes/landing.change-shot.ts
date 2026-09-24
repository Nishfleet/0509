import type { Route } from "./+types/landing.change-shot";

import { landingWorkspaceId } from "../lib/landing-marks.server";
import { readChangeShot } from "../lib/site-changes.server";

function notFound(): Response {
  return new Response("That screenshot isn't here.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function loader({ params }: Route.LoaderArgs) {
  const side = params.side;
  if (side !== "before" && side !== "after") return notFound();
  const workspaceId = landingWorkspaceId();
  if (workspaceId === null) return notFound();
  const object = await readChangeShot(workspaceId, params.signalId, side);
  if (object === null) return notFound();
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      etag: object.httpEtag,
    },
  });
}
