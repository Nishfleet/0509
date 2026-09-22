import type { Route } from "./+types/s.$slug";

import { serveCard } from "../lib/card/serve.server";

export async function loader({ params }: Route.LoaderArgs) {
  return serveCard(params.slug);
}
