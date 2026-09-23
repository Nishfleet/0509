import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { SHOT_WIDTHS, serveShot } from "../../../app/lib/shot/serve.server";

const ONE_PIXEL_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const OWN_KEY = "shot/ws-1/p1/after.png";

beforeEach(async () => {
  const listed = await env.SHOTS.list();
  for (const object of listed.objects) await env.SHOTS.delete(object.key);
  await env.SHOTS.put(OWN_KEY, ONE_PIXEL_PNG);
});

describe("serveShot", () => {
  it("serves the workspace's own shot resized to an allowed width", async () => {
    const response = await serveShot("ws-1", OWN_KEY, "104");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.startsWith("image/")).toBe(true);
    expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("serves the workspace's own shot at every allowed width", async () => {
    for (const width of SHOT_WIDTHS) {
      const response = await serveShot("ws-1", OWN_KEY, String(width));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")?.startsWith("image/")).toBe(true);
    }
  });

  it("404s a key under another workspace", async () => {
    const response = await serveShot("ws-1", "shot/ws-2/p1/after.png", "104");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("404s an allowed key at a width that is not in the set", async () => {
    expect((await serveShot("ws-1", OWN_KEY, "300")).status).toBe(404);
  });

  it("404s an allowed key when the width is missing", async () => {
    expect((await serveShot("ws-1", OWN_KEY, null)).status).toBe(404);
  });

  it("404s a key that contains ..", async () => {
    expect((await serveShot("ws-1", "shot/ws-1/../ws-2/p1/after.png", "104")).status).toBe(404);
  });

  it("404s a key that is not in the bucket", async () => {
    expect((await serveShot("ws-1", "shot/ws-1/missing.png", "104")).status).toBe(404);
  });
});
