import type { Route } from "./+types/llms[.]txt";
import { readRegistrySources } from "../lib/data/source.server";
import { llmsTxt } from "../lib/public-routes";

export async function loader({ request }: Route.LoaderArgs) {
  return new Response(llmsTxt(new URL(request.url).origin, await readRegistrySources()), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
