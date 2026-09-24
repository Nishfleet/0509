import type { Route } from "./+types/app.share[.]png";
import { env } from "cloudflare:workers";

import { readHomeStandingInputs } from "../lib/home-standing.server";
import { requireSession } from "../lib/require-session.server";
import { shareCard } from "../lib/share-card";
import { renderShareImage, shareDocument } from "../lib/share-image.server";

function plain(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const inputs = await readHomeStandingInputs(env.DB, session.user.id);
  const card = inputs === null ? null : shareCard({ ...inputs, now: new Date() });
  if (card === null) return plain(404, "There is no ranking to share yet.");

  const png = await renderShareImage(shareDocument(card, new URL(request.url).origin));
  if (png === null) return plain(503, "We could not make the picture. Try again in a minute.", { "retry-after": "60" });

  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=3600",
      "content-disposition": 'inline; filename="0509-standing.png"',
    },
  });
}
