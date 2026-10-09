import type { Route } from "./+types/app.share[.]png";

import { readHomeStandingInputs } from "../lib/home-standing.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { sessionContext } from "../lib/require-session.server";
import { shareCard } from "../lib/share-card";
import { renderShareImage, shareDocument } from "../lib/share-image.server";
import { takeBrowserShareImage } from "../lib/site/browser-budget.server";

function plain(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = context.get(sessionContext);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  const inputs = await readHomeStandingInputs(session.user.id, workspaceId ?? undefined);
  const card = inputs === null ? null : shareCard({ ...inputs, now: new Date() });
  if (card === null) return plain(404, "There is no ranking to share yet.");

  const mayRender =
    workspaceId === null ? undefined : () => takeBrowserShareImage(workspaceId, new Date().toISOString().slice(0, 10));
  const png = await renderShareImage(shareDocument(card, new URL(request.url).origin), mayRender);
  if (png === null) return plain(503, "We could not make the picture. Try again in a minute.", { "retry-after": "60" });

  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=3600",
      "content-disposition": 'inline; filename="five-to-nine-ranking.png"',
    },
  });
}
