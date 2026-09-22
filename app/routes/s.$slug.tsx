import type { Route } from "./+types/s.$slug";

import { serveCard } from "../lib/card/serve.server";

// The public standing card: 0509.io/s/<slug>. A resource route — no component,
// no session, no cookies. Every refusal is a 404 and the only success is the
// pre-rendered artifact (docs/REBUILD-STANDING-CARD.md, engine 9 P9.1).
export async function loader({ params }: Route.LoaderArgs) {
  return serveCard(params.slug);
}
