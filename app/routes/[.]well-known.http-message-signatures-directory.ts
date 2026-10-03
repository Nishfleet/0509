import { DIRECTORY_CONTENT_TYPE, directoryBody } from "../lib/fetch/web-bot-auth.server";

export function loader() {
  const body = directoryBody();
  if (body === null) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: { "content-type": DIRECTORY_CONTENT_TYPE, "cache-control": "public, max-age=3600" },
  });
}
