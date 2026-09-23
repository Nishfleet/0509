import { env } from "cloudflare:workers";

const SHOT_WIDTHS = [76, 104, 152, 208, 720, 1440] as const;

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function serveShot(
  workspaceId: string,
  key: string,
  width: string | null,
): Promise<Response> {
  if (!key.startsWith(`shot/${workspaceId}/`) || key.includes("..")) return notFound();

  const w = Number(width);
  if (!SHOT_WIDTHS.some((allowed) => allowed === w)) return notFound();

  const object = await env.SHOTS.get(key);
  if (object === null) return notFound();

  const result = await env.IMAGES.input(object.body as ReadableStream<Uint8Array>)
    .transform({ width: w, fit: "scale-down" })
    .output({ format: "image/webp" });

  const response = result.response();
  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": result.contentType(),
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
