import { env } from "cloudflare:workers";
import { renderRobots } from "../lib/public-routes";

export function loader() {
  return new Response(renderRobots(env.BETTER_AUTH_URL), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
