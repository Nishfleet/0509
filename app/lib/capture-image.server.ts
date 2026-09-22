import { env } from "cloudflare:workers";

import { captureKeyAllowed } from "./capture-image";

const MISSING = "This capture is not in the bucket.";

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
  if (!captureKeyAllowed(objectKey)) {
    return new Response(MISSING, {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  const object = await env.SNAPSHOTS.get(objectKey);
  if (!object) {
    return new Response(MISSING, {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  if (width > 0 && height > 0) {
    const bytes = await object.arrayBuffer();
    return (
      await env.IMAGES.input(new Blob([bytes]).stream())
        .transform({ width, height, fit: "cover" })
        .output({ format: "image/webp" })
    ).response({
      headers: { "cache-control": "public, max-age=300" },
    });
  }

  const type = object.httpMetadata?.contentType ?? "application/octet-stream";
  return new Response(object.body, {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=300",
    },
  });
}
