import type { Route } from "./+types/llms[.]txt";
import { llmsTxt } from "../lib/public-routes";

export function loader({ request }: Route.LoaderArgs) {
  return new Response(llmsTxt(new URL(request.url).origin), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
