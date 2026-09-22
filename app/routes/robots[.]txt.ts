import { renderRobots } from "../lib/public-routes";

export function loader() {
  return new Response(renderRobots(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
