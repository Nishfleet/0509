import { env } from "cloudflare:workers";

import { captureKeyAllowed } from "./capture-image";

const MISSING = "This capture is not in the bucket.";

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function captureObjectExists(objectKey: string): Promise<boolean> {
  if (!captureKeyAllowed(objectKey)) return false;
  const head = await env.SNAPSHOTS.head(objectKey);
  return head !== null;
}

export async function captureObjectResponse(
  objectKey: string,
  width: number,
  height: number,
): Promise<Response> {
  if (width <= 0 || height <= 0) {
    return text("Width and height are required.", 400);
  }
  if (!captureKeyAllowed(objectKey)) return text(MISSING, 404);
  const object = await env.SNAPSHOTS.get(objectKey);
  if (!object) return text(MISSING, 404);

  const bytes = await object.arrayBuffer();
  return (
    await env.IMAGES.input(new Blob([bytes]).stream())
      .transform({ width, height, fit: "cover" })
      .output({ format: "image/webp" })
  ).response({
    headers: { "cache-control": "public, max-age=300" },
  });
}
