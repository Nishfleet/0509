import type { Route } from "./+types/app.alerts.shot";

import { loadShot } from "../lib/site/alerts-feed.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

function notFound(): Response {
  return new Response("That screenshot isn't here.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
  });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const side = params.which;
  if (side !== "before" && side !== "after") return notFound();
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) return notFound();
  const object = await loadShot(workspaceId, params.signalId, side);
  if (object === null) return notFound();
  return new Response(object.body, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      etag: object.httpEtag,
    },
  });
}
