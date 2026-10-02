import type { Route } from "./+types/app.logo";

import { readEntityDomain } from "../lib/data/entity.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { backfillLogo } from "../lib/identity/card.server";
import { readEntityLogo } from "../lib/identity/logo-store.server";
import { requireSession } from "../lib/require-session.server";

function notFound(): Response {
  return new Response("That logo isn't here.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
  });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  const kept = workspaceId === null ? null : await readEntityLogo(workspaceId, params.entityId);
  const domain = workspaceId === null || kept !== null ? null : await readEntityDomain(workspaceId, params.entityId);
  const object = kept ?? (domain === null ? null : await backfillLogo(domain));
  if (object === null) return notFound();
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      etag: object.httpEtag,
    },
  });
}
