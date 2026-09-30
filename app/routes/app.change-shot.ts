import type { Route } from "./+types/app.change-shot";

import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { landingWorkspaceId } from "../lib/env.server";
import { requireSession } from "../lib/require-session.server";
import { readChangeShot } from "../lib/site-changes.server";

function notFound(): Response {
  return new Response("That screenshot isn't here.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
  });
}

function image(object: R2ObjectBody, cache: "public" | "private"): Response {
  const visibility = cache === "public" ? "public" : "private";
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/png",
      "cache-control": `${visibility}, max-age=31536000, immutable`,
      "x-content-type-options": "nosniff",
      etag: object.httpEtag,
    },
  });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const side = params.side;
  if (side !== "before" && side !== "after") return notFound();
  const publishedId = landingWorkspaceId();
  if (publishedId !== null) {
    const published = await readChangeShot(publishedId, params.signalId, side);
    if (published !== null) return image(published, "public");
  }
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  const object = workspaceId === null ? null : await readChangeShot(workspaceId, params.signalId, side);
  if (object === null) return notFound();
  return image(object, "private");
}
